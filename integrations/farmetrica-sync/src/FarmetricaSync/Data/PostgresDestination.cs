using System.Globalization;
using FarmetricaSync.Core;
using FarmetricaSync.Security;
using Npgsql;
using NpgsqlTypes;

namespace FarmetricaSync.Data;

/// <summary>
/// Receives bounded batches without holding the source query in memory.
/// A full snapshot stages all Farmatic batches in connection-private temp tables
/// without a long PostgreSQL transaction. The final publication is atomic per
/// pharmacy. Incrementals remain transactional. No partial visible snapshots or
/// cursor advancement on a failed transaction.
/// </summary>
public sealed record SyncWriteResult(long Rows, long Inserted, long Updated, long Deleted, long Duplicates);

public sealed class PostgresDestination(Secrets secrets, SshForward tunnels)
{
    private sealed class DatabaseSession(NpgsqlConnection connection, SshForward.Session? tunnel) : IAsyncDisposable
    {
        public NpgsqlConnection Connection => connection;
        public async ValueTask DisposeAsync()
        {
            try { await connection.DisposeAsync(); }
            finally { tunnel?.Dispose(); }
        }
    }

    private NpgsqlConnection Connection(Destination dest, int? localPort = null)
    {
        var mode = Enum.TryParse<SslMode>(dest.SslMode, ignoreCase: true, out var ssl) ? ssl : SslMode.VerifyFull;
        if (mode is not (SslMode.VerifyFull or SslMode.VerifyCA or SslMode.Require or SslMode.Disable) ||
            (mode == SslMode.Disable && !dest.SshEnabled))
            throw new ArgumentException("SSL: Disable solo con túnel SSH; sin SSH usa VerifyFull, VerifyCA o Require.");
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = localPort.HasValue ? "127.0.0.1" : dest.Host,
            Port = localPort ?? dest.Port,
            Database = dest.Database,
            Username = dest.Username, Password = secrets.Decrypt(dest.PasswordProtected),
            SslMode = mode, Timeout = 15, CommandTimeout = 1800,
            Pooling = !localPort.HasValue, // never reuse a connection pointing to a closed forwarded port
            ApplicationName = "FarmetricaSync"
        };
        return new NpgsqlConnection(builder.ConnectionString);
    }

    private async Task<DatabaseSession> OpenAsync(Destination dest, CancellationToken ct)
    {
        SshForward.Session? tunnel = null;
        NpgsqlConnection? connection = null;
        try
        {
            if (dest.SshEnabled) tunnel = await tunnels.OpenAsync(dest, ct);
            connection = Connection(dest, tunnel?.LocalPort);
            await connection.OpenAsync(ct);
            return new DatabaseSession(connection, tunnel);
        }
        catch
        {
            if (connection is not null) await connection.DisposeAsync();
            tunnel?.Dispose();
            throw;
        }
    }

    public Task TestSshAsync(Destination dest, CancellationToken ct) => tunnels.TestSshAsync(dest, ct);

    public async Task TestAsync(Destination dest, CancellationToken ct)
    {
        Validation.Id(dest.Schema, "Esquema PostgreSQL");
        await using var session = await OpenAsync(dest, ct);
        await using var cmd = new NpgsqlCommand("SELECT 1", session.Connection);
        await cmd.ExecuteScalarAsync(ct);
    }

    private static string PgType(string type) => type switch
    {
        "text" => "text", "numeric" => "numeric(18,4)", "timestamp" => "timestamp without time zone",
        "bool" => "boolean", "integer" => "bigint", _ => throw new ArgumentException("Tipo de columna no permitido")
    };

    private static NpgsqlDbType NType(string type) => type switch
    {
        "text" => NpgsqlDbType.Text, "numeric" => NpgsqlDbType.Numeric,
        "timestamp" => NpgsqlDbType.Timestamp, "bool" => NpgsqlDbType.Boolean,
        "integer" => NpgsqlDbType.Bigint, _ => throw new ArgumentException("Tipo de columna no permitido")
    };

    private static object? ConvertValue(object? value, string type)
    {
        if (value is null || value is DBNull) return null;
        if (value is string s && string.IsNullOrWhiteSpace(s)) return null;
        return type switch
        {
            "text" => Convert.ToString(value, CultureInfo.InvariantCulture),
            "numeric" => Convert.ToDecimal(value, CultureInfo.InvariantCulture),
            "integer" => Convert.ToInt64(value, CultureInfo.InvariantCulture),
            "bool" => Convert.ToBoolean(value, CultureInfo.InvariantCulture),
            "timestamp" => value switch
            {
                DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Unspecified),
                DateTimeOffset dto => DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Unspecified),
                _ => DateTime.SpecifyKind(Convert.ToDateTime(value, CultureInfo.InvariantCulture), DateTimeKind.Unspecified)
            },
            _ => throw new ArgumentException("Tipo no permitido")
        };
    }

    // Retirar la tabla heredada stock SOLO con solicitud expresa y después de
    // verificar que ningún artículo/farmacia ni cantidad de stock se pierde.
    // DROP RESTRICT no elimina otras tablas ni vistas; falla si existen dependencias.
    public async Task RetireStockAsync(Destination dest, CancellationToken ct)
    {
        Validation.Id(dest.Schema, "Esquema PostgreSQL");
        var stock = Validation.Q(dest.Schema) + "." + Validation.Q("stock");
        var articles = Validation.Q(dest.Schema) + "." + Validation.Q("articulos");
        await using var session = await OpenAsync(dest, ct);
        var conn = session.Connection;
        await using var tx = await conn.BeginTransactionAsync(ct);

        static async Task<bool> ExistsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string name, CancellationToken ct)
        {
            await using var cmd = new NpgsqlCommand("SELECT to_regclass(@qualified) IS NOT NULL", conn, tx);
            cmd.Parameters.AddWithValue("qualified", name);
            return (bool)(await cmd.ExecuteScalarAsync(ct) ?? false);
        }

        if (!await ExistsAsync(conn, tx, stock, ct)) return; // nada que retirar
        if (!await ExistsAsync(conn, tx, articles, ct))
            throw new InvalidOperationException("Primero sincroniza artículos: la tabla farmetrica.articulos todavía no existe.");
        await ExecuteAsync(conn, tx, $"LOCK TABLE {stock} IN ACCESS EXCLUSIVE MODE", ct);

        // Asegurar la nueva estructura antes de leer columnas.
        foreach (var column in new[] { "stock_actual", "stock_minimo", "stock_maximo", "lote_optimo" })
        {
            await using var check = new NpgsqlCommand(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns " +
                "WHERE table_schema = @schema AND table_name = 'articulos' AND column_name = @column)", conn, tx);
            check.Parameters.AddWithValue("schema", dest.Schema);
            check.Parameters.AddWithValue("column", column);
            if (!(bool)(await check.ExecuteScalarAsync(ct) ?? false))
                throw new InvalidOperationException($"Antes de retirar stock sincroniza artículos para crear {column}.");
        }

        // Los IdArticu son la misma clave en stock y artículos. Exigir tanto
        // cobertura de filas como igualdad de las cuatro cantidades almacenadas.
        var lost = await CountAsync(conn, tx, $"""
SELECT COUNT(*) FROM {stock} s
LEFT JOIN {articles} a ON a."farmacia_codigo" = s."farmacia_codigo" AND a."origen_id" = s."origen_id"
WHERE a."origen_id" IS NULL
   OR a."stock_actual" IS DISTINCT FROM s."existencias"
   OR a."stock_minimo" IS DISTINCT FROM s."stock_minimo"
   OR a."stock_maximo" IS DISTINCT FROM s."stock_maximo"
   OR a."lote_optimo" IS DISTINCT FROM s."lote_optimo"
""", ct);
        if (lost > 0)
            throw new InvalidOperationException(
                $"No se ha eliminado stock: {lost} registros aún faltan o difieren en artículos. Ejecuta primero una carga completa de artículos en esas farmacias y vuelve a comprobar.");
        await ExecuteAsync(conn, tx, $"DROP TABLE {stock} RESTRICT", ct);
        await tx.CommitAsync(ct);
    }

    // Migración explícita: mantener las cinco farmacias en un único contrato compras.
    // No CASCADE: si una vista depende de la columna retirada, se informa y aborta.
    // No borra filas de compras ni reinicia cursores.
    public async Task ApplyPurchasesSchemaAsync(Destination dest, EntityDefinition entity, CancellationToken ct)
    {
        if (entity.Name != "compras" || entity.Columns.Any(c => c.Name == "descuento_recepcion"))
            throw new ArgumentException("La migración requiere el contrato unificado de compras.");
        Validation.Entity(entity);
        Validation.Id(dest.Schema, "Esquema PostgreSQL");
        string target = Validation.Q(dest.Schema) + "." + Validation.Q(entity.Name);
        await using var session = await OpenAsync(dest, ct);
        var conn = session.Connection;
        await using var tx = await conn.BeginTransactionAsync(ct);
        await ExecuteAsync(conn, tx, $"CREATE SCHEMA IF NOT EXISTS {Validation.Q(dest.Schema)}", ct);
        var definitions = string.Join(", ", entity.Columns.Select(c => $"{Validation.Q(c.Name)} {PgType(c.Type)}"));
        await ExecuteAsync(conn, tx, $"CREATE TABLE IF NOT EXISTS {target} (\"farmacia_codigo\" text NOT NULL, \"farmacia\" text GENERATED ALWAYS AS (\"farmacia_codigo\") STORED, {definitions}, \"sincronizado_en\" timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY (\"farmacia_codigo\", \"origen_id\"))", ct);
        foreach (var col in entity.Columns)
            await ExecuteAsync(conn, tx, $"ALTER TABLE {target} ADD COLUMN IF NOT EXISTS {Validation.Q(col.Name)} {PgType(col.Type)}", ct);
        await ExecuteAsync(conn, tx, $"ALTER TABLE {target} DROP COLUMN IF EXISTS \"descuento_recepcion\"", ct);
        await tx.CommitAsync(ct);
    }

    // Evitar DDL sobre tablas de movimientos dentro de la transacción larga.
    // ALTER TABLE ADD COLUMN IF NOT EXISTS exige AccessExclusiveLock incluso
    // cuando la columna existe: dentro de un sync de millones de filas bloquearía
    // SELECT y SUM de Farmétrica hasta el COMMIT.
    private static async Task EnsureTableSchemaAsync(
        NpgsqlConnection conn, Destination dest, EntityDefinition entity, string target,
        CancellationToken ct)
    {
        bool exists;
        await using (var check = new NpgsqlCommand("SELECT to_regclass(@qualified) IS NOT NULL", conn))
        {
            check.Parameters.AddWithValue("qualified", target);
            exists = (bool)(await check.ExecuteScalarAsync(ct) ?? false);
        }

        if (!exists)
        {
            await ExecuteOutsideTransactionAsync(conn,
                $"CREATE SCHEMA IF NOT EXISTS {Validation.Q(dest.Schema)}", ct);
            var definitions = string.Join(", ",
                entity.Columns.Select(col => $"{Validation.Q(col.Name)} {PgType(col.Type)}"));
            await ExecuteOutsideTransactionAsync(conn,
                $"CREATE TABLE IF NOT EXISTS {target} (\"farmacia_codigo\" text NOT NULL, " +
                $"\"farmacia\" text GENERATED ALWAYS AS (\"farmacia_codigo\") STORED, {definitions}, " +
                "\"sincronizado_en\" timestamptz NOT NULL DEFAULT NOW(), " +
                "PRIMARY KEY (\"farmacia_codigo\", \"origen_id\"))", ct);
        }

        var present = new HashSet<string>(StringComparer.Ordinal);
        await using (var columns = new NpgsqlCommand(
            "SELECT column_name FROM information_schema.columns " +
            "WHERE table_schema=@schema AND table_name=@table", conn))
        {
            columns.Parameters.AddWithValue("schema", dest.Schema);
            columns.Parameters.AddWithValue("table", entity.Name);
            await using var reader = await columns.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) present.Add(reader.GetString(0));
        }

        // Cada DDL excepcional confirma y libera su bloqueo inmediatamente.
        // En sincronizaciones normales (esquema ya creado), solo hay SELECT
        // de metadatos y NINGÚN bloqueo exclusivo sobre ventas/compras.
        foreach (var col in entity.Columns)
        {
            if (present.Contains(col.Name)) continue;
            await ExecuteOutsideTransactionAsync(conn,
                $"ALTER TABLE {target} ADD COLUMN IF NOT EXISTS {Validation.Q(col.Name)} {PgType(col.Type)}", ct);
        }
        if (!present.Contains("farmacia"))
            await ExecuteOutsideTransactionAsync(conn,
                $"ALTER TABLE {target} ADD COLUMN IF NOT EXISTS \"farmacia\" text " +
                "GENERATED ALWAYS AS (\"farmacia_codigo\") STORED", ct);
    }

    private static async Task ExecuteOutsideTransactionAsync(
        NpgsqlConnection conn, string sql, CancellationToken ct)
    {
        // DDL únicamente: transacción CORTA con lock_timeout.
        // Si otro lector/escritor tiene el objeto ocupado, fallar y reintentar,
        // NO bloquear el sitio web mientras espera un AccessExclusiveLock.
        await using var ddl = await conn.BeginTransactionAsync(ct);
        await using (var limit = new NpgsqlCommand("SET LOCAL lock_timeout = '5s'", conn, ddl))
            await limit.ExecuteNonQueryAsync(ct);
        await using (var cmd = new NpgsqlCommand(sql, conn, ddl) { CommandTimeout = 30 })
            await cmd.ExecuteNonQueryAsync(ct);
        await ddl.CommitAsync(ct);
    }

    public async Task<SyncWriteResult> WriteAsync(Destination dest, Pharmacy pharmacy, EntityDefinition entity,
        string mode, IAsyncEnumerable<IReadOnlyList<Dictionary<string, object?>>> rawBatches,
        Action<SyncWriteProgress>? onProgress, CancellationToken ct)
    {
        Validation.Id(dest.Schema, "Esquema");
        Validation.Entity(entity);
        if (mode is not ("snapshot" or "incremental")) throw new ArgumentException("Modo de carga desconocido.");
        if (JoinedDocumentWriter.Supports(entity.Name))
        {
            // La base solo publica después de leer y validar el JOIN entero.
            // No se crea la tabla heredada de filas de venta para este flujo.
            await using var docSession = await OpenAsync(dest, ct);
            return await JoinedDocumentWriter.WriteAsync(docSession.Connection, dest.Schema,
                pharmacy, entity, rawBatches, onProgress, ct);
        }

        string target = Validation.Q(dest.Schema) + "." + Validation.Q(entity.Name);
        string[] names = ["farmacia_codigo", .. entity.Columns.Select(c => c.Name)];
        string cols = string.Join(", ", names.Select(Validation.Q));
        string updates = string.Join(", ", entity.Columns.Where(c => c.Name != "origen_id")
            .Select(c => $"{Validation.Q(c.Name)} = EXCLUDED.{Validation.Q(c.Name)}"));
        if (updates.Length > 0) updates += ", ";
        updates += "\"sincronizado_en\" = NOW()";

        onProgress?.Invoke(new SyncWriteProgress("Conectando a PostgreSQL", 0, 0, 0, 0, 0, 0));
        await using var session = await OpenAsync(dest, ct);
        var conn = session.Connection;
        onProgress?.Invoke(new SyncWriteProgress("Preparando tablas y transacción", 0, 0, 0, 0, 0, 0));
        // Preparar estructura FUERA de la transacción que copia y sincroniza.
        // Ningún DDL se conserva bloqueando las lecturas durante la carga.
        await EnsureTableSchemaAsync(conn, dest, entity, target, ct);
        // Snapshot: leer Farmatic y llenar tablas temporales de esta conexión SIN
        // abrir la transacción de destino. Un lector de la web no queda afectado
        // durante la preparación de millones de filas. Las tablas temporales
        // se destruyen automáticamente si se corta el túnel/conexión.
        // Incremental: conservar su transacción de datos única de principio a fin.
        NpgsqlTransaction? tx = null;
        try
        {
        if (mode == "incremental")
            tx = await conn.BeginTransactionAsync(ct);
        string stageBatch = Validation.Q("fs_batch_" + Guid.NewGuid().ToString("N"));
        await ExecuteAsync(conn, tx, $"CREATE TEMP TABLE {stageBatch} (LIKE {target} INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS", ct);
        string? stageFull = null;
        if (mode == "snapshot")
        {
            stageFull = Validation.Q("fs_full_" + Guid.NewGuid().ToString("N"));
            // INCLUDING INDEXES copies the target PK to deduplicate across *all* source batches.
            await ExecuteAsync(conn, null, $"CREATE TEMP TABLE {stageFull} (LIKE {target} INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT PRESERVE ROWS", ct);
        }

        long totalRead = 0, inserted = 0, updated = 0, deleted = 0, duplicates = 0;
        long batchIndex = 0;
        onProgress?.Invoke(new SyncWriteProgress("Leyendo registros del origen SQL Server", 0, 0, 0, 0, 0, 0));
        await foreach (var batch in rawBatches.WithCancellation(ct))
        {
            ct.ThrowIfCancellationRequested();
            if (batch.Count == 0) continue;
            if (batch.Count > 20_000)
                throw new InvalidOperationException("El conector ha entregado un lote mayor de 20.000 filas.");
            checked { totalRead += batch.Count; batchIndex++; }
            // Last record wins for duplicate source IDs inside each bounded batch.
            var dedup = new Dictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
            foreach (var row in batch)
            {
                string? key = Convert.ToString(row["origen_id"], CultureInfo.InvariantCulture);
                if (string.IsNullOrWhiteSpace(key))
                    throw new InvalidOperationException("origen_id nulo o vacío en el origen.");
                dedup[key] = row;
            }
            // Los identificadores internos del ERP no se usan como CN. País obligatorio
            // en la farmacia; la regla de prefijos ES es una sugerencia reversible.
            if (entity.Name == "articulos" && entity.Columns.Any(c => c.Name == "segmento_comercial"))
            {
                foreach (var row in dedup.Values)
                {
                    row.TryGetValue("codigo_nacional", out var rawCn);
                    var inferred = ProductClassification.InferFromCn(
                        Convert.ToString(rawCn, CultureInfo.InvariantCulture), pharmacy.CountryCode);
                    row.TryGetValue("segmento_comercial", out var sourceSegment);
                    if (string.IsNullOrWhiteSpace(Convert.ToString(sourceSegment, CultureInfo.InvariantCulture)))
                    {
                        row["segmento_comercial"] = inferred.Segment;
                        row["subcategoria"] = inferred.Subcategory;
                        row["clasificacion_origen"] = inferred.Origin;
                        row["clasificacion_confianza"] = inferred.Confidence;
                    }
                    else
                    {
                        row.TryGetValue("clasificacion_origen", out var sourceOrigin);
                        row.TryGetValue("clasificacion_confianza", out var sourceConfidence);
                        if (string.IsNullOrWhiteSpace(Convert.ToString(sourceOrigin)))
                            row["clasificacion_origen"] = "erp";
                        if (sourceConfidence is null)
                            row["clasificacion_confianza"] = 0.90m;
                    }
                    row["cn_normalizado"] = inferred.NormalizedCn;
                }
            }
            if (mode == "incremental") duplicates += batch.Count - dedup.Count;
            string copy = $"COPY {stageBatch} ({cols}) FROM STDIN (FORMAT BINARY)";
            await using (var writer = await conn.BeginBinaryImportAsync(copy, ct))
            {
                foreach (var row in dedup.Values)
                {
                    await writer.StartRowAsync(ct);
                    await writer.WriteAsync(pharmacy.Code, NpgsqlDbType.Text, ct);
                    foreach (var col in entity.Columns)
                    {
                        var value = ConvertValue(row[col.Name], col.Type);
                        if (value is null) await writer.WriteNullAsync(ct);
                        else await writer.WriteAsync(value, NType(col.Type), ct);
                    }
                }
                await writer.CompleteAsync(ct);
            }
            if (mode == "snapshot")
            {
                // Los lotes se acumulan de forma privada, sin transacción larga.
                // Una interrupción deja intacta la tabla de artículos/ventas real.
                await ExecuteAsync(conn, null,
                    $"INSERT INTO {stageFull} ({cols}, \"sincronizado_en\") SELECT {cols}, NOW() FROM {stageBatch} WHERE true " +
                    $"ON CONFLICT (\"farmacia_codigo\", \"origen_id\") DO UPDATE SET {updates}", ct);
            }
            else
            {
                // Idempotencia con correcciones: un ticket o recepción ya importados
                // pueden cambiar de importe, estado o descuento después de la primera lectura.
                // La clave incluye farmacia; las filas idénticas NO se reescriben.
                string differs = string.Join(" OR ", entity.Columns.Where(c => c.Name != "origen_id")
                    .Select(c => $"current.{Validation.Q(c.Name)} IS DISTINCT FROM incoming.{Validation.Q(c.Name)}"));
                if (string.IsNullOrEmpty(differs)) differs = "false";
                long changedExisting = await CountAsync(conn, tx,
                    $"SELECT COUNT(*) FROM {stageBatch} incoming JOIN {target} current " +
                    "USING (\"farmacia_codigo\", \"origen_id\") WHERE " + differs, ct);
                string conflictDiffers = string.Join(" OR ", entity.Columns.Where(c => c.Name != "origen_id")
                    .Select(c => $"current.{Validation.Q(c.Name)} IS DISTINCT FROM EXCLUDED.{Validation.Q(c.Name)}"));
                if (string.IsNullOrEmpty(conflictDiffers)) conflictDiffers = "false";
                long applied = await ExecuteCountAsync(conn, tx,
                    $"INSERT INTO {target} AS current ({cols}, \"sincronizado_en\") " +
                    $"SELECT {cols}, NOW() FROM {stageBatch} WHERE true " +
                    $"ON CONFLICT (\"farmacia_codigo\", \"origen_id\") DO UPDATE SET {updates} WHERE {conflictDiffers}", ct);
                inserted += applied - changedExisting;
                updated += changedExisting;
                duplicates += dedup.Count - applied;
            }
            await ExecuteAsync(conn, tx, $"TRUNCATE TABLE {stageBatch}", ct);
            onProgress?.Invoke(new SyncWriteProgress("Leyendo y preparando lotes", totalRead, batchIndex, inserted, updated, deleted, duplicates));
        }

        if (mode == "snapshot")
        {
            // La transacción comienza DESPUÉS de recibir el último lote. Solo
            // los cálculos delta y la publicación definitiva se hacen en ella.
            tx = await conn.BeginTransactionAsync(ct);
            await ExecuteAsync(conn, tx, "SET LOCAL lock_timeout = '5s'", ct);
            onProgress?.Invoke(new SyncWriteProgress("Comparando carga completa con PostgreSQL", totalRead, batchIndex, inserted, updated, deleted, duplicates));
            // Validate the *entire* staged dataset before touching a pharmacy's current data.
            long staged = await CountAsync(conn, tx, $"SELECT COUNT(*) FROM {stageFull}", ct);
            // Si FamiliaAux contiene varias asociaciones o IdFamilia se repite
            // por Empresa, un LEFT JOIN puede duplicar IdFamilia. No sobrescribir
            // silenciosamente familias: avisar y dejar PostgreSQL intacto.
            if (entity.Name == "familias" && staged != totalRead)
                throw new InvalidOperationException(
                    $"Familias: {totalRead - staged} filas comparten origen_id en esta farmacia. " +
                    "Revisa la unicidad de IdFamilia en Familia/FamiliaAux y la columna Empresa antes de importar.");
            if (staged == 0)
                throw new InvalidOperationException("Carga completa vacía: se conserva el histórico existente. Revisar el SELECT.");
            long previous = await CountAsync(conn, tx,
                $"SELECT COUNT(*) FROM {target} WHERE \"farmacia_codigo\" = @farmacia", ct, pharmacy.Code);
            if (previous >= 20 && staged < previous / 2)
                throw new InvalidOperationException($"Carga completa bloqueada: antes había {previous} registros y ahora {staged}. Revisar SELECT.");
            // Delta verdadero respecto a la foto final. No reescribimos filas sin cambios.
            string equals = string.Join(" AND ", entity.Columns.Where(c => c.Name != "origen_id")
                .Select(c => $"t.{Validation.Q(c.Name)} IS NOT DISTINCT FROM s.{Validation.Q(c.Name)}"));
            if (string.IsNullOrEmpty(equals)) equals = "true";
            inserted = await CountAsync(conn, tx,
                $"SELECT COUNT(*) FROM {stageFull} s LEFT JOIN {target} t ON t.\"farmacia_codigo\" = s.\"farmacia_codigo\" AND t.\"origen_id\" = s.\"origen_id\" WHERE t.\"origen_id\" IS NULL", ct);
            updated = await CountAsync(conn, tx,
                $"SELECT COUNT(*) FROM {stageFull} s JOIN {target} t USING (\"farmacia_codigo\", \"origen_id\") WHERE NOT ({equals})", ct);
            deleted = await CountAsync(conn, tx,
                $"SELECT COUNT(*) FROM {target} t WHERE t.\"farmacia_codigo\" = @farmacia AND NOT EXISTS (SELECT 1 FROM {stageFull} s WHERE s.\"farmacia_codigo\" = t.\"farmacia_codigo\" AND s.\"origen_id\" = t.\"origen_id\")", ct, pharmacy.Code);
            string changed = string.Join(" OR ", entity.Columns.Where(c => c.Name != "origen_id")
                .Select(c => $"current.{Validation.Q(c.Name)} IS DISTINCT FROM EXCLUDED.{Validation.Q(c.Name)}"));
            if (string.IsNullOrEmpty(changed)) changed = "false";
            await ExecuteAsync(conn, tx,
                $"INSERT INTO {target} AS current ({cols}, \"sincronizado_en\") SELECT {cols}, NOW() FROM {stageFull} WHERE true " +
                $"ON CONFLICT (\"farmacia_codigo\", \"origen_id\") DO UPDATE SET {updates} WHERE {changed}", ct);
            await using (var delete = new NpgsqlCommand(
                $"DELETE FROM {target} t WHERE t.\"farmacia_codigo\" = @farmacia AND NOT EXISTS (SELECT 1 FROM {stageFull} s WHERE s.\"farmacia_codigo\" = t.\"farmacia_codigo\" AND s.\"origen_id\" = t.\"origen_id\")", conn, tx) { CommandTimeout = 1800 })
            {
                delete.Parameters.AddWithValue("farmacia", pharmacy.Code);
                await delete.ExecuteNonQueryAsync(ct);
            }
            duplicates += totalRead - staged;

            // Fotografía actual del stock, con fecha de captura incluso cuando
            // la cantidad no cambió. No se confunde con compras o ventas y no
            // altera el histórico de operaciones de ninguno de esos módulos.
            if (entity.Name == "articulos" && entity.Columns.Any(x => x.Name == "stock_actual"))
            {
                string inventory = Validation.Q(dest.Schema) + "." + Validation.Q("fm_stock_fotografia");
                bool stockTableExists;
                await using (var check = new NpgsqlCommand("SELECT to_regclass(@name) IS NOT NULL", conn, tx))
                {
                    check.Parameters.AddWithValue("name", inventory);
                    stockTableExists = (bool)(await check.ExecuteScalarAsync(ct) ?? false);
                }
                if (stockTableExists)
                {
                    await using (var photo = new NpgsqlCommand($"""
INSERT INTO {inventory} AS existing
 (farmacia_codigo,sistema_origen,articulo_origen_id,unidades,capturado_en,sincronizado_en)
 SELECT farmacia_codigo,@source,origen_id,stock_actual,now(),now()
 FROM {stageFull} WHERE stock_actual IS NOT NULL
 ON CONFLICT (farmacia_codigo,sistema_origen,articulo_origen_id)
 DO UPDATE SET unidades=EXCLUDED.unidades,capturado_en=EXCLUDED.capturado_en,
               sincronizado_en=now()
""", conn, tx) { CommandTimeout = 180 })
                    {
                        photo.Parameters.AddWithValue("source", pharmacy.SystemType.ToLowerInvariant());
                        await photo.ExecuteNonQueryAsync(ct);
                    }
                    await using var clear = new NpgsqlCommand($"""
DELETE FROM {inventory} t
WHERE t.farmacia_codigo=@pharmacy AND t.sistema_origen=@source
  AND NOT EXISTS (SELECT 1 FROM {stageFull} s
                  WHERE s.farmacia_codigo=t.farmacia_codigo
                    AND s.origen_id=t.articulo_origen_id
                    AND s.stock_actual IS NOT NULL)
""", conn, tx) { CommandTimeout = 180 };
                    clear.Parameters.AddWithValue("pharmacy", pharmacy.Code);
                    clear.Parameters.AddWithValue("source", pharmacy.SystemType.ToLowerInvariant());
                    await clear.ExecuteNonQueryAsync(ct);
                }
            }
        }
        onProgress?.Invoke(new SyncWriteProgress("Confirmando transacción PostgreSQL", totalRead, batchIndex, inserted, updated, deleted, duplicates));
        await tx!.CommitAsync(ct);
        onProgress?.Invoke(new SyncWriteProgress("Sincronización confirmada", totalRead, batchIndex, inserted, updated, deleted, duplicates));
        return new SyncWriteResult(totalRead, inserted, updated, deleted, duplicates);
        }
        finally
        {
            if (tx is not null) await tx.DisposeAsync();
        }
    }

    private static async Task<long> ExecuteCountAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx) { CommandTimeout = 1800 };
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<long> CountAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql,
        CancellationToken ct, string? pharmacy = null)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx) { CommandTimeout = 1800 };
        if (pharmacy is not null) cmd.Parameters.AddWithValue("farmacia", pharmacy);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
    }

    private static async Task ExecuteAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx) { CommandTimeout = 1800 };
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
