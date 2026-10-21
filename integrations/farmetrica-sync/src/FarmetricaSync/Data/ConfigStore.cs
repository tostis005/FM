using System.Text.Json;
using FarmetricaSync.Core;

namespace FarmetricaSync.Data;

public sealed class ConfigStore
{
    private readonly object _gate = new();
    private readonly string _path;
    private AppConfig _config;
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };

    public ConfigStore(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        _path = Path.Combine(dataDir, "sync-config.json");
        _config = File.Exists(_path)
            ? JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(_path), Json) ?? new()
            : new();
        // Tras reiniciar el servicio ya no hay transacción activa: marcar ejecuciones interrumpidas
        // sin tocar WatermarkUtc ni LastSuccessUtc; podrán reintentarse sin perder el cursor.
        foreach (var state in _config.States.Where(x => x.LastStatus == "running"))
        {
            state.LastStatus = "error";
            state.LastError = "Interrumpida por reinicio del servicio. El punto incremental no avanzó.";
            var job = _config.Jobs.FirstOrDefault(j => j.Id == state.JobId);
            var pharmacy = _config.Pharmacies.FirstOrDefault(p => p.Id == job?.PharmacyId);
            var entity = _config.Entities.FirstOrDefault(e => e.Id == job?.EntityId);
            if (job is not null)
                _config.Runs.Insert(0, new SyncRun {
                    JobId = job.Id, PharmacyId = job.PharmacyId, EntityId = job.EntityId,
                    PharmacyCode = pharmacy?.Code ?? "", EntityName = entity?.Name ?? "",
                    StartedUtc = state.LastAttemptUtc ?? DateTimeOffset.UtcNow,
                    FinishedUtc = DateTimeOffset.UtcNow, Mode = job.Mode,
                    Status = "error", Phase = "Interrumpida por reinicio",
                    Error = state.LastError
                });
        }
        // Migration of known broken built-in templates only, without changing
        // pharmacies, custom SQL, job mode, existing checkpoints or completed runs.
        foreach (var job in _config.Jobs)
        {
            var pharmacy = _config.Pharmacies.FirstOrDefault(p => p.Id == job.PharmacyId);
            var entity = _config.Entities.FirstOrDefault(e => e.Id == job.EntityId);
            if (pharmacy?.SystemType == "farmatic" && entity?.Name == "ventas")
                job.Sql = SqlTemplates.RepairFarmaticSalesIncremental(job.Sql);
            if (pharmacy is not null && entity is not null)
                job.Sql = SqlTemplates.NormalizeForMode(pharmacy.SystemType, entity.Name, job.Mode, job.Sql);
        }
        // Retirar los flujos antiguos de ventas y compras (líneas/cabeceras parciales).
        // Mantener Runs para auditoría y no borrar datos ni tablas en PostgreSQL.
        var retiredIds = _config.Entities
            .Where(e => e.Name.Equals("stock", StringComparison.OrdinalIgnoreCase) ||
                        e.Name.Equals("ventas", StringComparison.OrdinalIgnoreCase) ||
                        e.Name.Equals("compras", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.Id).ToHashSet();
        bool retiredEntities = retiredIds.Count > 0;
        if (retiredEntities)
        {
            var obsoleteJobIds = _config.Jobs.Where(j => retiredIds.Contains(j.EntityId))
                .Select(j => j.Id).ToHashSet();
            _config.Jobs.RemoveAll(j => obsoleteJobIds.Contains(j.Id));
            _config.States.RemoveAll(st => obsoleteJobIds.Contains(st.JobId));
            _config.Entities.RemoveAll(e => retiredIds.Contains(e.Id));
        }
        // Conservar IDs, cursores y modos de trabajo. Migrar exclusivamente
        // SELECT ventas_completas idénticos al estándar antiguo, para incluir
        // TipoLinea y permitir líneas C sin Codigo. SQL personalizado intacto.
        foreach (var salesJob in _config.Jobs.Where(j =>
            _config.Entities.Any(e => e.Id == j.EntityId &&
                e.Name.Equals("ventas_completas", StringComparison.OrdinalIgnoreCase))))
        {
            salesJob.Sql = SqlTemplates.UpgradeStandardSalesDocumentsSql(salesJob.Sql);
            salesJob.FullSql = SqlTemplates.UpgradeStandardSalesDocumentsSql(salesJob.FullSql);
        }

        foreach (var articleJob in _config.Jobs.Where(j =>
            _config.Entities.Any(e => e.Id == j.EntityId &&
                e.Name.Equals("articulos", StringComparison.OrdinalIgnoreCase))))
        {
            articleJob.Sql = SqlTemplates.UpgradeStandardArticleSql(articleJob.Sql);
            articleJob.FullSql = SqlTemplates.UpgradeStandardArticleSql(articleJob.FullSql);
        }

        // Conservar los IDs, cursores y consultas de los flujos documentales vigentes.
        foreach (var canonical in CanonicalEntities.Create())
        {
            if (canonical.Name is "ventas" or "compras") continue;
            var existing = _config.Entities.FirstOrDefault(x => x.Name.Equals(canonical.Name, StringComparison.OrdinalIgnoreCase));
            if (existing is null) { _config.Entities.Add(canonical); continue; }
            foreach (var column in canonical.Columns)
                if (!existing.Columns.Any(c => c.Name.Equals(column.Name, StringComparison.OrdinalIgnoreCase)))
                    existing.Columns.Add(new EntityColumn { Name = column.Name, Type = column.Type });
        }
        if (retiredEntities)
        {
            // Persistir la limpieza una única vez, sin guardar credenciales en logs.
            string tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_config, Json));
            File.Move(tmp, _path, overwrite: true);
        }
    }

    // Lecturas lock-free de un snapshot que nunca se modifica tras publicarlo.
    // Evita que /login, /config, /runs y /health esperen detrás de serializaciones
    // del historial durante cargas o reintentos. Los selectores son SOLO LECTURA.
    // Change sigue siendo el único punto autorizado para mutaciones.
    public T Read<T>(Func<AppConfig, T> selector) =>
        selector(Volatile.Read(ref _config));

    public void Change(Action<AppConfig> change)
    {
        lock (_gate)
        {
            var next = Clone(_config);
            change(next);
            string tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(next, Json));
            File.Move(tmp, _path, overwrite: true);
            // Publicación atómica: nunca se expone un snapshot intermedio.
            Volatile.Write(ref _config, next);
        }
    }

    private static AppConfig Clone(AppConfig config) => JsonSerializer.Deserialize<AppConfig>(JsonSerializer.Serialize(config, Json), Json) ?? new();
}
