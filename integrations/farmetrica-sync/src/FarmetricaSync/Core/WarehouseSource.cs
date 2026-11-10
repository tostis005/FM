using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FarmetricaSync.Core;

/// <summary>
/// Añade Almacén como origen Farmatic directo y copia los trabajos reales de Avadía.
/// No copia nunca checkpoints, historial ni identificadores de otros orígenes.
/// </summary>
public static class WarehouseSource
{
    public const string Code = "ALMACEN";
    public const string Database = "Almacen";

    public readonly record struct Result(bool Changed, bool Created, int JobsAdded);

    public static Result EnsureFromAvadia(AppConfig config)
    {
        var direct = config.Pharmacies.Where(p =>
            p.SystemType.Equals("farmatic", StringComparison.OrdinalIgnoreCase) &&
            p.ConnectionMode.Equals("direct", StringComparison.OrdinalIgnoreCase) &&
            !p.Code.Equals(Code, StringComparison.OrdinalIgnoreCase) &&
            !Fold(p.Name).Equals("almacen", StringComparison.Ordinal)).ToList();
        var named = direct.Where(p =>
            Fold(p.Code).Contains("avadia", StringComparison.Ordinal) ||
            Fold(p.Name).Contains("avadia", StringComparison.Ordinal)).ToList();
        // Si el nombre local es distinto, solo aceptar el único origen directo
        // con base Farmatic; nunca seleccionar entre varias conexiones.
        Pharmacy? avadia = named.Count == 1 ? named[0] :
            named.Count == 0 && direct.Count == 1 &&
            direct[0].Database.Equals("Farmatic", StringComparison.OrdinalIgnoreCase)
                ? direct[0] : null;
        if (avadia is null) return default;

        var targets = config.Pharmacies.Where(p =>
            p.Code.Equals(Code, StringComparison.OrdinalIgnoreCase) ||
            Fold(p.Name).Equals("almacen", StringComparison.Ordinal)).ToList();
        if (targets.Count > 1) return default;
        var warehouse = targets.SingleOrDefault();
        bool created = false;
        if (warehouse is null)
        {
            warehouse = new Pharmacy
            {
                Id = Guid.NewGuid(),
                Code = Code,
                Name = "Almacén",
                SystemType = avadia.SystemType,
                CountryCode = avadia.CountryCode,
                ConnectionMode = "direct",
                Server = avadia.Server,
                Database = Database,
                LinkedServer = "",
                AuthMode = avadia.AuthMode,
                Username = avadia.Username,
                // Credencial ya cifrada para este equipo; nunca registrar/descifrar.
                PasswordProtected = avadia.PasswordProtected,
                TimeZoneId = avadia.TimeZoneId,
                TrustServerCertificate = avadia.TrustServerCertificate,
                Enabled = avadia.Enabled
            };
            config.Pharmacies.Add(warehouse);
            created = true;
        }
        else if (!warehouse.SystemType.Equals("farmatic", StringComparison.OrdinalIgnoreCase) ||
                 !warehouse.ConnectionMode.Equals("direct", StringComparison.OrdinalIgnoreCase) ||
                 !warehouse.Database.Equals(Database, StringComparison.OrdinalIgnoreCase))
        {
            // No sobrescribir un origen existente con otra conexión.
            return default;
        }

        int added = 0;
        foreach (var original in config.Jobs.Where(j => j.PharmacyId == avadia.Id).ToList())
        {
            if (config.Jobs.Any(j => j.PharmacyId == warehouse.Id && j.EntityId == original.EntityId))
                continue;
            // La serialización conserva cualquier parámetro nuevo de SyncJob.
            var copy = JsonSerializer.Deserialize<SyncJob>(JsonSerializer.Serialize(original))
                ?? throw new InvalidOperationException("No se pudo clonar la consulta de Avadía.");
            copy.Id = Guid.NewGuid();
            copy.PharmacyId = warehouse.Id;
            copy.Sql = RedirectDatabase(copy.Sql, avadia.Database);
            copy.FullSql = RedirectDatabase(copy.FullSql, avadia.Database);
            Validation.Query(copy);
            config.Jobs.Add(copy);
            added++;
        }
        return new Result(created || added > 0, created, added);
    }

    // {{TABLE:dbo.Tabla}} se resuelve automáticamente con el catálogo de
    // cada origen; las consultas antiguas con Farmatic.dbo se ajustan aquí.
    public static string RedirectDatabase(string sql, string sourceDatabase)
    {
        if (string.IsNullOrWhiteSpace(sql) || string.IsNullOrWhiteSpace(sourceDatabase))
            return sql;
        string db = Regex.Escape(sourceDatabase.Trim());
        string pattern = @"(?<![A-Za-z0-9_\]])(?:\[" + db + @"\]|" + db +
            @")\s*\.\s*(?=(?:\[dbo\]|dbo)\s*\.)";
        return Regex.Replace(sql, pattern, "[" + Database + "].",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static string Fold(string? value)
    {
        var result = new StringBuilder();
        foreach (char ch in (value ?? "").Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                result.Append(char.ToLowerInvariant(ch));
        return result.ToString().Normalize(NormalizationForm.FormC);
    }
}
