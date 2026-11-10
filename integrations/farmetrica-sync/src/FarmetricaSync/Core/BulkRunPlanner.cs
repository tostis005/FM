namespace FarmetricaSync.Core;

/// <summary>
/// Selección pura de trabajos para "Ejecutar todas". El ejecutor real sigue
/// usando la misma cola exclusiva e idempotente que el botón individual.
/// </summary>
public static class BulkRunPlanner
{
    public sealed record PlannedJob(Guid JobId, bool NeedsInitialFull);

    public static IReadOnlyList<PlannedJob> Plan(AppConfig config)
    {
        var enabledPharmacies = config.Pharmacies
            .Where(p => p.Enabled)
            .Select(p => p.Id).ToHashSet();
        var entities = config.Entities.Select(e => e.Id).ToHashSet();
        var initialLoads = config.States
            .Where(s => s.LastFullSuccessUtc is not null)
            .Select(s => s.JobId).ToHashSet();

        return config.Jobs
            .Where(j => j.Enabled && enabledPharmacies.Contains(j.PharmacyId)
                && entities.Contains(j.EntityId))
            .Select(j => new PlannedJob(
                j.Id,
                j.Mode == "incremental" && !string.IsNullOrWhiteSpace(j.FullSql)
                    && !initialLoads.Contains(j.Id)))
            .ToArray();
    }
}
