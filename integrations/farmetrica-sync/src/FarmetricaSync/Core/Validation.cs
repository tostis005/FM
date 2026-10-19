using System.Text.RegularExpressions;

namespace FarmetricaSync.Core;

public static class Validation
{
    private static readonly Regex Identifier = new("^[a-z][a-z0-9_]{0,62}$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    public static void Id(string value, string label)
    {
        if (!Identifier.IsMatch(value ?? "")) throw new ArgumentException($"{label}: usar letras, números y _ (máximo 63 caracteres, empezar por letra).");
    }
    public static string Q(string identifier) { Id(identifier, "Identificador"); return "\"" + identifier.Replace("\"", "\"\"") + "\""; }
    public static void Entity(EntityDefinition def)
    {
        Id(def.Name, "Entidad");
        if (def.Name != def.Name.ToLowerInvariant()) throw new ArgumentException("El nombre de entidad debe estar en minúsculas.");
        if (def.Columns.Count is < 1 or > 60 || !def.Columns.Any(c => c.Name.Equals("origen_id", StringComparison.OrdinalIgnoreCase) && c.Type == "text"))
            throw new ArgumentException("La entidad necesita la columna origen_id de tipo text y un máximo de 60 columnas.");
        if (def.Columns.GroupBy(c => c.Name.ToLowerInvariant()).Any(g => g.Count() > 1)) throw new ArgumentException("Columnas duplicadas.");
        foreach (var col in def.Columns)
        {
            Id(col.Name, "Columna");
            if (col.Name != col.Name.ToLowerInvariant()) throw new ArgumentException("Los nombres de columnas deben estar en minúsculas.");
            if (!new[] { "text", "numeric", "timestamp", "bool", "integer" }.Contains(col.Type)) throw new ArgumentException("Tipo de columna no permitido.");
            if (new[] { "farmacia_codigo", "farmacia", "sincronizado_en" }.Contains(col.Name.ToLowerInvariant())) throw new ArgumentException("Columna reservada.");
        }
    }
    public static void Query(SyncJob job)
    {
        if (job.EveryMinutes is < 5 or > 10080) throw new ArgumentException("Frecuencia: de 5 a 10080 minutos.");
        if (job.RetryMinutes is < 5 or > 1440) throw new ArgumentException("Reintento tras error: de 5 a 1440 minutos.");
        if (job.BatchSize is < 100 or > 20_000) throw new ArgumentException("Tamaño de lote: de 100 a 20.000 filas.");
        if (job.ReplayMinutes is < 0 or > 43200) throw new ArgumentException("Solapamiento: de 0 a 43200 minutos.");
        if (job.SafetyDelayMinutes is < 0 or > 1440) throw new ArgumentException("Demora de seguridad: de 0 a 1440 minutos.");
        if (job.Mode is not ("incremental" or "snapshot")) throw new ArgumentException("Modo no válido.");
        if (job.Enabled && string.IsNullOrWhiteSpace(job.Sql)) throw new ArgumentException("Define la consulta antes de activar el trabajo.");
        ValidateSelect(job.Sql, job.Mode == "incremental");
        ValidateSelect(job.FullSql, false);
    }

    public static void ValidateSelect(string? text, bool incremental)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        string sql = text.Trim();
        if (!Regex.IsMatch(sql, @"^(SELECT|WITH)\b", RegexOptions.IgnoreCase)) throw new ArgumentException("Solo se admiten consultas SELECT o WITH.");
        if (sql.TrimEnd(';').Contains(';')) throw new ArgumentException("Solo se permite una sentencia SQL.");
        if (incremental && (!Regex.IsMatch(sql, @"@desde\b", RegexOptions.IgnoreCase) || !Regex.IsMatch(sql, @"@hasta\b", RegexOptions.IgnoreCase)))
            throw new ArgumentException("La consulta incremental debe utilizar @desde y @hasta.");
    }
}
