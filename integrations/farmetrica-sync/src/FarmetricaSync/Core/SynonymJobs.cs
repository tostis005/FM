using System;

namespace FarmetricaSync.Core;

/// <summary>
/// Añade una fuente semanal de sinónimos a cada farmacia Farmatic, sin cambiar
/// ninguna fuente existente. Los trabajos desactivados se respetan.
/// </summary>
public static class SynonymJobs
{
    public static int EnsureForFarmatic(AppConfig config)
    {
        var entity = config.Entities.Find(e => e.Name.Equals("sinonimos", StringComparison.OrdinalIgnoreCase));
        if (entity is null) throw new InvalidOperationException("Falta la entidad canónica sinonimos.");
        var preset = SqlTemplates.All.Single(t => t.SystemType == "farmatic" && t.Entity == "sinonimos");
        int added = 0;
        foreach (var pharmacy in config.Pharmacies.Where(p => p.SystemType.Equals("farmatic", StringComparison.OrdinalIgnoreCase)))
        {
            if (config.Jobs.Any(j => j.PharmacyId == pharmacy.Id && j.EntityId == entity.Id)) continue;
            var job = new SyncJob
            {
                PharmacyId = pharmacy.Id, EntityId = entity.Id,
                Sql = preset.FullSql, FullSql = preset.FullSql,
                Mode = "snapshot", EveryMinutes = 10080, Enabled = true,
                BatchSize = 5000, ReplayMinutes = 0, SafetyDelayMinutes = 0
            };
            Validation.Query(job);
            config.Jobs.Add(job);
            added++;
        }
        return added;
    }
}
