namespace FarmetricaSync.Core;

/// <summary>
/// Retira únicamente el origen obsoleto cuyo código exacto sea AMP.
/// Sus consultas y cursores locales también desaparecen. El histórico se
/// conserva para auditoría; no se borran movimientos en PostgreSQL.
/// </summary>
public static class UnusedAmpSource
{
    public static bool Remove(AppConfig config)
    {
        var ids = config.Pharmacies
            .Where(p => string.Equals(p.Code.Trim(), "AMP", StringComparison.OrdinalIgnoreCase))
            .Select(p => p.Id).ToHashSet();
        if (ids.Count == 0) return false;
        var jobIds = config.Jobs.Where(j => ids.Contains(j.PharmacyId))
            .Select(j => j.Id).ToHashSet();
        config.Pharmacies.RemoveAll(p => ids.Contains(p.Id));
        config.Jobs.RemoveAll(j => jobIds.Contains(j.Id));
        config.States.RemoveAll(s => jobIds.Contains(s.JobId));
        return true;
    }
}
