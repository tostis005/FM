using System.Globalization;
using FarmetricaSync.Core;
using Npgsql;
using NpgsqlTypes;

namespace FarmetricaSync.Data;

/// <summary>
/// A single source JOIN is staged in a connection-private PostgreSQL table.
/// Source extraction takes place outside the target transaction. After
/// validating cardinality, headers and lines are atomically upserted with
/// short lock timeouts. Full reconciliation never guesses logical deletion.
/// </summary>
public static class JoinedDocumentWriter
{
    public static bool Supports(string name) => name is "ventas_completas" or "recepciones_completas";

    private static NpgsqlDbType PgType(string type) => type switch
    {
        "text" => NpgsqlDbType.Text,
        "numeric" => NpgsqlDbType.Numeric,
        "timestamp" => NpgsqlDbType.Timestamp,
        "integer" => NpgsqlDbType.Bigint,
        "bool" => NpgsqlDbType.Boolean,
        _ => throw new ArgumentException("Tipo de campo no permitido")
    };

    private static string SqlType(string type) => type switch
    {
        "text" => "text",
        "numeric" => "numeric(20,6)",
        "timestamp" => "timestamp without time zone",
        "integer" => "bigint",
        "bool" => "boolean",
        _ => throw new ArgumentException("Tipo de campo no permitido")
    };

    private static object? ConvertField(object? raw, string type)
    {
        if (raw is null || raw is DBNull || raw is string s && string.IsNullOrWhiteSpace(s))
            return null;
        return type switch
        {
            "text" => Convert.ToString(raw, CultureInfo.InvariantCulture),
            "numeric" => Convert.ToDecimal(raw, CultureInfo.InvariantCulture),
            "integer" => Convert.ToInt64(raw, CultureInfo.InvariantCulture),
            "bool" => Convert.ToBoolean(raw, CultureInfo.InvariantCulture),
            "timestamp" => raw switch
            {
                DateTime d => DateTime.SpecifyKind(d, DateTimeKind.Unspecified),
                DateTimeOffset d => DateTime.SpecifyKind(d.UtcDateTime, DateTimeKind.Unspecified),
                _ => DateTime.SpecifyKind(Convert.ToDateTime(raw, CultureInfo.InvariantCulture),
                    DateTimeKind.Unspecified)
            },
            _ => throw new ArgumentException("Tipo de campo no permitido")
        };
    }

    private static async Task<long> ScalarAsync(NpgsqlConnection conn,
        string sql, CancellationToken ct, NpgsqlTransaction? tx = null, string? source = null)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx) { CommandTimeout = 180 };
        if (source is not null) cmd.Parameters.AddWithValue("source", source);
        var value = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static async Task<long> ExecuteAsync(NpgsqlConnection conn, string sql,
        CancellationToken ct, NpgsqlTransaction? tx = null, string? source = null)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx) { CommandTimeout = 180 };
        if (source is not null) cmd.Parameters.AddWithValue("source", source);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string ChangePredicate(IEnumerable<string> cols) =>
        string.Join(" OR ", cols.Select(c =>
            $"current.{Validation.Q(c)} IS DISTINCT FROM EXCLUDED.{Validation.Q(c)}"));

    private static string SetValues(IEnumerable<string> cols) =>
        string.Join(", ", cols.Select(c =>
            $"{Validation.Q(c)} = EXCLUDED.{Validation.Q(c)}"));

    public static async Task<SyncWriteResult> WriteAsync(
        NpgsqlConnection conn, string schema, Pharmacy pharmacy, EntityDefinition entity,
        IAsyncEnumerable<IReadOnlyList<Dictionary<string, object?>>> rawBatches,
        Action<SyncWriteProgress>? progress, CancellationToken ct, bool isFull = false)
    {
        if (!Supports(entity.Name)) throw new ArgumentException("Flujo documental desconocido");
        Validation.Id(schema, "Esquema PostgreSQL");
        Validation.Entity(entity);

        bool sales = entity.Name == "ventas_completas";
        string prefix = sales ? "fm_ventas" : "fm_recepciones";
        string header = Validation.Q(schema) + "." + Validation.Q(prefix + "_cabeceras");
        string detail = Validation.Q(schema) + "." + Validation.Q(prefix + "_lineas");
        // No migrations or ALTER TABLE while syncing; the migration is managed
        // by FM, separately from all source reads and report queries.
        foreach (var name in new[] { header, detail })
        {
            await using var exists = new NpgsqlCommand("SELECT to_regclass(@name) IS NOT NULL", conn);
            exists.Parameters.AddWithValue("name", name);
            if (!(bool)(await exists.ExecuteScalarAsync(ct) ?? false))
                throw new InvalidOperationException(
                    $"Falta la tabla {name}. Aplicar la migración 016 antes de activar este flujo.");
        }

        string stage = Validation.Q("fs_doc_" + Guid.NewGuid().ToString("N"));
        var cols = new[] { "farmacia_codigo" }.Concat(entity.Columns.Select(c => c.Name)).ToArray();
        string fields = string.Join(", ", cols.Select(Validation.Q));
        string definitions = "\"farmacia_codigo\" text NOT NULL, " +
            string.Join(", ", entity.Columns.Select(c =>
                Validation.Q(c.Name) + " " + SqlType(c.Type))) +
            ", PRIMARY KEY (\"farmacia_codigo\", \"origen_id\")";
        await ExecuteAsync(conn, $"CREATE TEMP TABLE {stage} ({definitions}) ON COMMIT PRESERVE ROWS", ct);
        long rows = 0, batches = 0;
        progress?.Invoke(new("Extrayendo JOIN a staging privado", 0, 0, 0, 0, 0, 0));
        string copy = $"COPY {stage} ({fields}) FROM STDIN (FORMAT BINARY)";
        await foreach (var batch in rawBatches.WithCancellation(ct))
        {
            if (batch.Count == 0) continue;
            if (batch.Count > 20_000) throw new InvalidOperationException("Lote mayor de 20.000 filas.");
            var keys = new HashSet<string>(StringComparer.Ordinal);
            await using (var writer = await conn.BeginBinaryImportAsync(copy, ct))
            {
                foreach (var row in batch)
                {
                    ct.ThrowIfCancellationRequested();
                    row.TryGetValue("origen_id", out var keyObject);
                    row.TryGetValue("documento_id", out var docObject);
                    row.TryGetValue("fecha", out var dateObject);
                    row.TryGetValue("linea_id", out var lineObject);
                    var key = Convert.ToString(keyObject, CultureInfo.InvariantCulture);
                    var document = Convert.ToString(docObject, CultureInfo.InvariantCulture);
                    var line = Convert.ToString(lineObject, CultureInfo.InvariantCulture);
                    if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(document) || dateObject is null)
                        throw new InvalidOperationException("JOIN: origen_id, documento_id y fecha son obligatorios.");
                    if (!keys.Add(key))
                        throw new InvalidOperationException($"JOIN duplicado: origen_id {key} repetido en un lote.");
                    if (!string.IsNullOrWhiteSpace(line) &&
                        (!row.TryGetValue("articulo_id", out var article) || string.IsNullOrWhiteSpace(Convert.ToString(article)) ||
                         !row.TryGetValue("unidades", out var units) || units is null))
                        throw new InvalidOperationException($"JOIN: línea {line} sin artículo o unidades.");
                    if (string.IsNullOrWhiteSpace(line) &&
                        (row.TryGetValue("articulo_id", out var headerArticle) && headerArticle is not null ||
                         row.TryGetValue("unidades", out var headerUnits) && headerUnits is not null))
                        throw new InvalidOperationException("JOIN: datos de línea sin linea_id.");
                    await writer.StartRowAsync(ct);
                    await writer.WriteAsync(pharmacy.Code, NpgsqlDbType.Text, ct);
                    foreach (var col in entity.Columns)
                    {
                        row.TryGetValue(col.Name, out var raw);
                        var value = ConvertField(raw, col.Type);
                        if (value is null) await writer.WriteNullAsync(ct);
                        else await writer.WriteAsync(value, PgType(col.Type), ct);
                    }
                    rows++;
                }
                await writer.CompleteAsync(ct);
            }
            batches++;
            progress?.Invoke(new("Staging privado preparado", rows, batches, 0, 0, 0, 0));
        }
        if (rows == 0)
        {
            if (isFull) throw new InvalidOperationException(
                "Carga completa de documentos vacía: revisar el SELECT antes de confirmar el cursor.");
            return new(0, 0, 0, 0, 0);
        }

        // Validar el JOIN ENTERO, no solo lotes: duplicar líneas de otros
        // lotes o cambiar totales entre filas de un ticket es un error de origen.
        long duplicateLines = await ScalarAsync(conn, $@"
            SELECT count(*) FROM (
                SELECT farmacia_codigo,documento_id,linea_id
                FROM {stage} WHERE nullif(btrim(linea_id),'') IS NOT NULL
                GROUP BY 1,2,3 HAVING count(*) > 1
            ) invalid", ct);
        if (duplicateLines > 0)
            throw new InvalidOperationException(
                $"JOIN multiplicado: {duplicateLines} claves de línea repetidas. No se ha publicado ningún dato.");

        long badHeaders = await ScalarAsync(conn, $@"
            SELECT count(*) FROM (
                SELECT farmacia_codigo,documento_id
                FROM {stage}
                GROUP BY 1,2
                HAVING count(DISTINCT ROW(fecha,numero_documento,tercero_id,empleado_id,estado,
                    total_documento,descuento_global,descuento_global_tipo,
                    impuestos_documento,modificado_origen,eliminado_logicamente)) > 1
            ) invalid", ct);
        if (badHeaders > 0)
            throw new InvalidOperationException(
                $"JOIN incoherente: {badHeaders} documentos con cabeceras diferentes según la línea.");

        long badEmpty = await ScalarAsync(conn, $@"
            SELECT count(*) FROM {stage}
            WHERE nullif(btrim(documento_id),'') IS NULL OR fecha IS NULL
               OR (nullif(btrim(linea_id),'') IS NOT NULL AND
                   (nullif(btrim(articulo_id),'') IS NULL OR unidades IS NULL))", ct);
        if (badEmpty > 0)
            throw new InvalidOperationException($"JOIN incompleto: {badEmpty} registros sin claves o cantidad.");

        // All staging is private and complete. Only now open a transaction
        // for live tables, where regular SELECTs remain MVCC-nonblocking.
        await using var tx = await conn.BeginTransactionAsync(ct);
        await ExecuteAsync(conn, "SET LOCAL lock_timeout = '5s'", ct, tx);
        await ExecuteAsync(conn, "SET LOCAL statement_timeout = '180s'", ct, tx);
        string source = pharmacy.SystemType.Trim().ToLowerInvariant();
        string headersColumns = sales
            ? "fecha,numero_documento,empleado_id,cliente_origen_id,total_documento,descuento_global,descuento_global_tipo,impuestos,estado,eliminado_logicamente,modificado_origen"
            : "fecha,numero_albaran,numero_pedido,proveedor_origen_id,total_documento,descuento_global,descuento_global_tipo,impuestos,estado,eliminada_logicamente,modificado_origen";
        string[] headerFields = headersColumns.Split(',');
        string[] basicFields = ["farmacia_codigo", "sistema_origen", "documento_id", .. headerFields, "lineas_completas"];
        string headerSelect = sales
            ? @"s.fecha,s.numero_documento,s.empleado_id,s.tercero_id,s.total_documento,
               s.descuento_global,s.descuento_global_tipo,s.impuestos_documento,
               coalesce(nullif(s.estado,''),'desconocido'),coalesce(s.eliminado_logicamente,false),
               s.modificado_origen"
            : @"s.fecha,s.numero_documento,s.numero_pedido,s.tercero_id,s.total_documento,
               s.descuento_global,s.descuento_global_tipo,s.impuestos_documento,
               coalesce(nullif(s.estado,''),'desconocido'),coalesce(s.eliminado_logicamente,false),
               s.modificado_origen";
        string headerCols = string.Join(",",basicFields.Select(Validation.Q));
        string headerUpdates = SetValues(headerFields) +
            ", lineas_completas = current.lineas_completas OR EXCLUDED.lineas_completas, recibido_en = now()";
        string headerChanges = ChangePredicate(headerFields) +
            " OR (NOT current.lineas_completas AND EXCLUDED.lineas_completas)";
        string headerData = $@"SELECT DISTINCT ON (s.farmacia_codigo,s.documento_id)
            s.farmacia_codigo,@source,s.documento_id,{headerSelect},
            EXISTS(SELECT 1 FROM {stage} x WHERE x.farmacia_codigo=s.farmacia_codigo
                AND x.documento_id=s.documento_id AND nullif(btrim(x.linea_id),'') IS NOT NULL)
            FROM {stage} s ORDER BY s.farmacia_codigo,s.documento_id,s.origen_id";
        long newHeaders = await ScalarAsync(conn, $@"
            SELECT count(DISTINCT s.documento_id) FROM {stage} s
            LEFT JOIN {header} h
                ON h.farmacia_codigo=s.farmacia_codigo AND h.sistema_origen=@source
               AND h.documento_id=s.documento_id
            WHERE h.documento_id IS NULL", ct, tx, source);
        long updatedHeaders = await ExecuteAsync(conn, $@"
            INSERT INTO {header} AS current ({headerCols})
            {headerData}
            ON CONFLICT (farmacia_codigo,sistema_origen,documento_id)
            DO UPDATE SET {headerUpdates} WHERE {headerChanges}", ct, tx, source);

        string lineCols = sales
            ? "articulo_origen_id,cantidad,precio_unitario,descuento_linea,descuento_linea_tipo,importe_neto,impuestos,coste_historico,eliminada_logicamente,modificado_origen"
            : "articulo_origen_id,cantidad,precio_unitario_bruto,descuento_comercial,descuento_tipo,bonificacion_unidades,coste_neto,impuestos,eliminada_logicamente,modificado_origen";
        string[] lineFields = lineCols.Split(',');
        string colsForLine = string.Join(",",new[] { "farmacia_codigo","sistema_origen","documento_id","linea_id" }
            .Concat(lineFields).Select(Validation.Q));
        string lineSelect = sales
            ? @"s.articulo_id,s.unidades,s.precio_unitario,s.descuento_linea,
                s.descuento_linea_tipo,s.importe_neto,s.impuesto_linea,s.coste_historico,
                coalesce(s.linea_eliminada,false),s.modificado_origen"
            : @"s.articulo_id,s.unidades,s.precio_unitario,s.descuento_linea,
                s.descuento_linea_tipo,s.bonificacion_unidades,s.importe_neto,s.impuesto_linea,
                coalesce(s.linea_eliminada,false),s.modificado_origen";
        long newLines = await ScalarAsync(conn, $@"
            SELECT count(*) FROM {stage} s
            LEFT JOIN {detail} t
                ON t.farmacia_codigo=s.farmacia_codigo AND t.sistema_origen=@source
               AND t.documento_id=s.documento_id AND t.linea_id=s.linea_id
            WHERE nullif(btrim(s.linea_id),'') IS NOT NULL AND t.linea_id IS NULL", ct, tx, source);
        long updatedLines = await ExecuteAsync(conn, $@"
            INSERT INTO {detail} AS current ({colsForLine})
            SELECT s.farmacia_codigo,@source,s.documento_id,s.linea_id,{lineSelect}
            FROM {stage} s WHERE nullif(btrim(s.linea_id),'') IS NOT NULL
            ON CONFLICT (farmacia_codigo,sistema_origen,documento_id,linea_id)
            DO UPDATE SET {SetValues(lineFields)}, recibido_en=now()
            WHERE {ChangePredicate(lineFields)}", ct, tx, source);
        await tx.CommitAsync(ct);
        long added = newHeaders + newLines;
        long modified = Math.Max(0, updatedHeaders + updatedLines - added);
        progress?.Invoke(new("Documentos y líneas confirmados", rows, batches, added, modified, 0, 0));
        return new SyncWriteResult(rows, added, modified, 0, 0);
    }
}
