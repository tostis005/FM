using System.Data;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using FarmetricaSync.Core;
using FarmetricaSync.Security;
using Microsoft.Data.SqlClient;

namespace FarmetricaSync.Connectors;

/// <summary>
/// Farmatic usa SQL Server; linked y directo comparten el mismo lector.
/// NO incluye SQL de tablas Farmatic porque su esquema se debe comprobar en el cliente.
/// </summary>
public sealed class FarmaticConnector(Secrets secrets) : ISourceConnector
{
    public string SystemType => "farmatic";
    private static readonly Regex TableToken = new(@"\{\{TABLE:([a-zA-Z][a-zA-Z0-9_]*)\.([a-zA-Z][a-zA-Z0-9_]*)\}\}", RegexOptions.Compiled);

    private static string Br(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 128 || id.Contains('\0'))
            throw new ArgumentException("Nombre de SQL Server no válido.");
        return "[" + id.Replace("]", "]]" ) + "]";
    }

    public string ResolveSql(Pharmacy p, string sql)
    {
        if (p.ConnectionMode == "linked")
        {
            _ = Br(p.LinkedServer);
            _ = Br(p.Database);
        }
        else if (p.ConnectionMode == "direct") _ = Br(p.Database);
        else throw new ArgumentException("Modo de conexión desconocido.");

        // Compatibilidad con consultas históricas guardadas antes de corregir AS vWHERE.
        sql = SqlTemplates.RepairFarmaticSalesIncremental(sql);
        var resolved = TableToken.Replace(sql, m =>
        {
            string prefix = p.ConnectionMode == "linked" ? Br(p.LinkedServer) + "." : "";
            return prefix + Br(p.Database) + "." + Br(m.Groups[1].Value) + "." + Br(m.Groups[2].Value);
        });
        if (resolved.Contains("{{", StringComparison.Ordinal)) throw new ArgumentException("Macro SQL no reconocida. Usa {{TABLE:dbo.Tabla}}.");
        return resolved;
    }

    private SqlConnection Connection(Pharmacy p)
    {
        var b = new SqlConnectionStringBuilder
        {
            DataSource = p.Server,
            InitialCatalog = p.ConnectionMode == "linked" ? "master" : p.Database,
            IntegratedSecurity = p.AuthMode == "integrated",
            Encrypt = SqlConnectionEncryptOption.Mandatory,
            TrustServerCertificate = p.TrustServerCertificate,
            ConnectTimeout = 15,
            ApplicationName = "FarmetricaSync",
            Pooling = true
        };
        if (p.AuthMode == "sql")
        {
            b.UserID = p.Username;
            b.Password = secrets.Decrypt(p.PasswordProtected);
        }
        else if (p.AuthMode != "integrated") throw new ArgumentException("Autenticación SQL no reconocida.");
        return new SqlConnection(b.ConnectionString);
    }

    public async Task TestAsync(Pharmacy pharmacy, CancellationToken ct)
    {
        await using var conn = Connection(pharmacy);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand("SELECT 1", conn) { CommandTimeout = 15 };
        await cmd.ExecuteScalarAsync(ct);
        if (pharmacy.ConnectionMode == "linked")
        {
            // Solo se verifica que el nombre está definido localmente.
            // La consulta de entidad es la que confirma permisos en la BD remota.
            await using var link = new SqlCommand("SELECT COUNT(*) FROM sys.servers WHERE name = @alias", conn);
            link.Parameters.Add("@alias", SqlDbType.NVarChar, 128).Value = pharmacy.LinkedServer;
            var count = Convert.ToInt32(await link.ExecuteScalarAsync(ct));
            if (count == 0) throw new InvalidOperationException("Linked Server no encontrado en el SQL Server configurado.");
        }
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> PreviewAsync(
        Pharmacy pharmacy, SyncJob job, EntityDefinition entity,
        DateTime sinceUtc, DateTime untilUtc, int limit, CancellationToken ct)
    {
        if (limit is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(limit));
        Validation.ValidateSelect(job.Sql, job.Mode == "incremental");
        await using var conn = Connection(pharmacy);
        await conn.OpenAsync(ct);
        string sql = ResolveSql(pharmacy, job.Sql);
        await using var cmd = new SqlCommand("SET ROWCOUNT 100; " + sql, conn) { CommandTimeout = 45 };
        if (job.Mode == "incremental")
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(pharmacy.TimeZoneId);
            cmd.Parameters.Add("@desde", SqlDbType.DateTime2).Value = TimeZoneInfo.ConvertTimeFromUtc(sinceUtc, zone);
            cmd.Parameters.Add("@hasta", SqlDbType.DateTime2).Value = TimeZoneInfo.ConvertTimeFromUtc(untilUtc, zone);
        }
        var result = new List<Dictionary<string, object?>>();
        await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.SingleResult, ct);
        var headings = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
        if (headings.Distinct(StringComparer.OrdinalIgnoreCase).Count() != headings.Count)
            throw new InvalidOperationException("La consulta devuelve nombres de columna duplicados.");
        foreach (var col in entity.Columns)
            if (!headings.Contains(col.Name, StringComparer.OrdinalIgnoreCase) &&
                !SqlTemplates.IsLegacyOptional(entity.Name, col.Name))
                throw new InvalidOperationException($"Falta AS {col.Name} en la consulta SQL.");
        while (result.Count < limit && await reader.ReadAsync(ct))
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < headings.Count; ++i)
                row[headings[i]] = await reader.IsDBNullAsync(i, ct) ? null : reader.GetValue(i);
            foreach (var col in entity.Columns.Where(c => SqlTemplates.IsLegacyOptional(entity.Name, c.Name)))
                row.TryAdd(col.Name, null);
            if (!row.TryGetValue("origen_id", out var key) || string.IsNullOrWhiteSpace(Convert.ToString(key)))
                throw new InvalidOperationException("origen_id es nulo; comprueba la clave de cada línea.");
            result.Add(row);
        }
        return result;
    }

    public async IAsyncEnumerable<IReadOnlyList<Dictionary<string, object?>>> ReadBatchesAsync(
        Pharmacy pharmacy, SyncJob job, EntityDefinition entity,
        DateTime sinceUtc, DateTime untilUtc, int batchSize,
        Action<long>? onSourceRows, [EnumeratorCancellation] CancellationToken ct)
    {
        Validation.Query(job);
        if (batchSize is < 100 or > 20_000)
            throw new ArgumentOutOfRangeException(nameof(batchSize), "El lote debe tener entre 100 y 20.000 filas.");
        await using var conn = Connection(pharmacy);
        await conn.OpenAsync(ct);
        string sql = ResolveSql(pharmacy, job.Sql);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 1800 };
        if (job.Mode == "incremental")
        {
            // SQL Server almacena normalmente las fechas sin zona; el watermark es UTC.
            var zone = TimeZoneInfo.FindSystemTimeZoneById(pharmacy.TimeZoneId);
            cmd.Parameters.Add("@desde", SqlDbType.DateTime2).Value = TimeZoneInfo.ConvertTimeFromUtc(sinceUtc, zone);
            cmd.Parameters.Add("@hasta", SqlDbType.DateTime2).Value = TimeZoneInfo.ConvertTimeFromUtc(untilUtc, zone);
        }
        await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.SequentialAccess, ct);
        var ordinals = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < reader.FieldCount; i++)
        {
            if (!ordinals.TryAdd(reader.GetName(i), i))
                throw new InvalidOperationException("La consulta devuelve columnas repetidas.");
        }
        foreach (var column in entity.Columns)
            if (!ordinals.ContainsKey(column.Name) &&
                !SqlTemplates.IsLegacyOptional(entity.Name, column.Name))
                throw new InvalidOperationException($"Falta la columna AS {column.Name} en el SELECT.");

        var batch = new List<Dictionary<string, object?>>(batchSize);
        long sourceRows = 0;
        // Progreso de lectura independiente del COPY y de la confirmación PG.
        onSourceRows?.Invoke(0);
        while (await reader.ReadAsync(ct))
        {
            sourceRows++;
            if (sourceRows == 1 || sourceRows % 250 == 0)
                onSourceRows?.Invoke(sourceRows);
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            // Access columns in ordinal order for SequentialAccess, even if entity order differs.
            foreach (var col in entity.Columns.Where(c => ordinals.ContainsKey(c.Name)).OrderBy(c => ordinals[c.Name]))
            {
                var value = reader.GetValue(ordinals[col.Name]);
                row[col.Name] = value is DBNull ? null : value;
            }
            // Las consultas antiguas siguen siendo válidas. No inventar descuentos faltantes.
            foreach (var col in entity.Columns.Where(c => SqlTemplates.IsLegacyOptional(entity.Name, c.Name)))
                row.TryAdd(col.Name, null);
            if (row["origen_id"] is null || string.IsNullOrWhiteSpace(Convert.ToString(row["origen_id"])))
                throw new InvalidOperationException("La consulta devuelve un origen_id nulo o vacío.");
            batch.Add(row);
            if (batch.Count >= batchSize)
            {
                yield return batch;
                batch = new List<Dictionary<string, object?>>(batchSize);
            }
        }
        onSourceRows?.Invoke(sourceRows);
        if (batch.Count > 0) yield return batch;
    }
}
