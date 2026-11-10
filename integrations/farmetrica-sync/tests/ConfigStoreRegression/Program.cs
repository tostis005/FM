using FarmetricaSync.Core;
using FarmetricaSync.Data;

string path = Path.Combine(Path.GetTempPath(), "farmetrica-sync-config-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(path);
try
{
    var store = new ConfigStore(path);
    var vendors = store.Read(c => c.Entities.SingleOrDefault(e => e.Name=="vendedores"));
    if (vendors is null || !vendors.Columns.Any(c => c.Name=="origen_id" && c.Type=="text") ||
        !vendors.Columns.Any(c => c.Name=="color_ventas" && c.Type=="integer"))
        throw new Exception("Nueva instalación debe incluir vendedores con el contrato correcto.");

    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    using var release = new ManualResetEventSlim();
    var writer = Task.Run(() => store.Change(c =>
    {
        entered.TrySetResult();
        release.Wait(TimeSpan.FromSeconds(10));
        c.Jobs.Add(new SyncJob { Enabled = true });
    }));
    try
    {
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        // Must complete while the writer holds its exclusive mutation gate.
        // Legacy Read(lock+Clone) would time out and block /login and /config.
        int count = await Task.Run(() => store.Read(c => c.Jobs.Count))
            .WaitAsync(TimeSpan.FromSeconds(2));
        if (count != 0) throw new Exception("Read observed uncommitted state.");
    }
    finally { release.Set(); }
    await writer.WaitAsync(TimeSpan.FromSeconds(5));
    if (store.Read(c => c.Jobs.Count) != 1)
        throw new Exception("Reader did not see published updated configuration.");
    // On-disk state must be complete and usable after restart.
    var reloaded = new ConfigStore(path);
    if (reloaded.Read(c => c.Entities.Count(e=>e.Name=="vendedores")) != 1)
        throw new Exception("Reinicio no debe duplicar vendedores.");
    // Simula una configuración antigua que no conocía la entidad; al actualizar
    // se incorpora sin eliminar Jobs, IDs ni checkpoints existentes.
    reloaded.Change(c => c.Entities.RemoveAll(e=>e.Name=="vendedores"));
    var upgraded = new ConfigStore(path);
    if (upgraded.Read(c=>c.Entities.Count(e=>e.Name=="vendedores"))!=1 ||
        upgraded.Read(c=>c.Jobs.Count)!=1)
        throw new Exception("La actualización debe ser aditiva, sin modificar trabajos anteriores.");

    if (reloaded.Read(c => c.Jobs.Count) != 1)
        throw new Exception("Configuration was not durably persisted.");
    // Las VPN caídas NO generan reintentos especiales cada 5 minutos.
    var start = new DateTimeOffset(2026,10,19,10,0,0,TimeSpan.Zero);
    var interval = new SyncJob { EveryMinutes=60, RetryMinutes=5 };
    var failed = new SyncState {
        LastAttemptUtc=start, LastCompletedUtc=start.AddMinutes(10), LastStatus="error"
    };
    var local = new Pharmacy { TimeZoneId="UTC" };
    if (SyncSchedule.IsDue(interval,failed,local,start.AddMinutes(12)) ||
        SyncSchedule.IsDue(interval,failed,local,start.AddMinutes(69)) ||
        !SyncSchedule.IsDue(interval,failed,local,start.AddMinutes(70)))
        throw new Exception("Error VPN: respetar exactamente la hora desde el fin del último intento.");
    failed.LastStatus="ok";failed.LastSuccessUtc=start.AddMinutes(10);
    if (SyncSchedule.IsDue(interval,failed,local,start.AddMinutes(11)))
        throw new Exception("La periodicidad correcta no debe depender del estado.");
    // Las configuraciones antiguas sin LastCompletedUtc usan LastAttemptUtc,
    // nunca RetryMinutes. Esto evita reintentos rápidos tras actualizar.
    failed.LastCompletedUtc=null;failed.LastStatus="error";
    if (SyncSchedule.IsDue(interval,failed,local,start.AddMinutes(6)) ||
        !SyncSchedule.IsDue(interval,failed,local,start.AddMinutes(60)))
        throw new Exception("Retrocompatibilidad de errores sin LastCompletedUtc.");
    var daily=new SyncJob {EveryMinutes=1440,DailyAtLocal="08:30",RetryMinutes=5};
    var before=new DateTimeOffset(2026,10,19,8,29,0,TimeSpan.Zero);
    var slot=before.AddMinutes(1);
    if (SyncSchedule.IsDue(daily,null,local,before) ||
        !SyncSchedule.IsDue(daily,null,local,slot))
        throw new Exception("La hora diaria debe cumplirse en la zona de la farmacia.");
    var todayFailed=new SyncState{LastAttemptUtc=slot,LastCompletedUtc=slot.AddMinutes(2),LastStatus="error"};
    if (SyncSchedule.IsDue(daily,todayFailed,local,slot.AddHours(1)) ||
        SyncSchedule.IsDue(daily,todayFailed,local,slot.AddDays(1).AddMinutes(-1)) ||
        !SyncSchedule.IsDue(daily,todayFailed,local,slot.AddDays(1)))
        throw new Exception("Un fallo a las 08:30 no permite un segundo intento hasta el día siguiente.");
    var crossing = new SyncState {
        LastAttemptUtc=slot.AddMinutes(-5),LastCompletedUtc=slot.AddHours(1),LastStatus="error"
    };
    if (SyncSchedule.IsDue(daily,crossing,local,slot.AddHours(1).AddMinutes(1)))
        throw new Exception("Una carga larga que atraviesa la hora fija no debe reintentarse inmediatamente.");
    // Hora de Madrid, incluso si el sincronizador Windows está en otra zona.
    var madrid=new Pharmacy{TimeZoneId="Europe/Madrid"};
    var spring=new SyncJob{EveryMinutes=1440,DailyAtLocal="02:30"};
    var dstStart = new DateTimeOffset(2026,3,29,1,0,0,TimeSpan.Zero);
    if (SyncSchedule.NextDueUtc(spring,null,madrid,dstStart)!=dstStart)
        throw new Exception("Hora inexistente de primavera: primer instante local válido.");
    var dstEnd = new DateTimeOffset(2026,10,25,0,30,0,TimeSpan.Zero);
    if (SyncSchedule.NextDueUtc(spring,null,madrid,dstEnd)!=dstEnd)
        throw new Exception("Hora ambigua de otoño: usar la primera ocurrencia UTC.");
    store.Change(c => c.States.Add(new SyncState {
        JobId=Guid.NewGuid(),LastAttemptUtc=start,LastCompletedUtc=start.AddMinutes(10),
        LastStatus="error"
    }));
    var saved=new ConfigStore(path);
    if (!saved.Read(c=>c.States.Any(x=>x.LastCompletedUtc==start.AddMinutes(10))))
        throw new Exception("La finalización del intento debe sobrevivir al reinicio del servicio.");
    if (saved.Read(c=>c.MonitorInstanceId) != Guid.Empty)
        throw new Exception("Una configuración antigua debe poder adquirir un identificador de monitor al arrancar.");
    saved.Change(c => c.MonitorInstanceId = Guid.NewGuid());
    if (new ConfigStore(path).Read(c=>c.MonitorInstanceId) == Guid.Empty)
        throw new Exception("El identificador de monitor debe persistir tras reinicio.");
    // Los flujos antiguos dejan de ejecutarse, sin perder datos ni historial.
    var oldSales = new EntityDefinition { Name = "ventas" };
    var oldPurchases = new EntityDefinition { Name = "compras" };
    var docSales = saved.Read(c => c.Entities.Single(e => e.Name == "ventas_completas"));
    var docPurchases = saved.Read(c => c.Entities.Single(e => e.Name == "recepciones_completas"));
    var salesJob = new SyncJob { EntityId = oldSales.Id, Enabled = true };
    var purchaseJob = new SyncJob { EntityId = oldPurchases.Id, Enabled = true };
    var documentJob = new SyncJob { EntityId = docSales.Id, Enabled = true, EveryMinutes = 60 };
    var watermark = start.AddDays(-2);
    saved.Change(c => {
        c.Entities.Add(oldSales); c.Entities.Add(oldPurchases);
        c.Jobs.Add(salesJob); c.Jobs.Add(purchaseJob); c.Jobs.Add(documentJob);
        c.States.Add(new SyncState { JobId = salesJob.Id, WatermarkUtc = watermark });
        c.States.Add(new SyncState { JobId = documentJob.Id, WatermarkUtc = watermark });
        c.Runs.Add(new SyncRun { JobId = salesJob.Id, EntityId = oldSales.Id, EntityName = "ventas" });
    });
    var cleaned = new ConfigStore(path);
    if (cleaned.Read(c => c.Entities.Any(e => e.Name is "ventas" or "compras")) ||
        cleaned.Read(c => c.Jobs.Any(j => j.Id == salesJob.Id || j.Id == purchaseJob.Id)) ||
        cleaned.Read(c => c.States.Any(st => st.JobId == salesJob.Id)) ||
        cleaned.Read(c => c.Entities.All(e => e.Id != docPurchases.Id)) ||
        cleaned.Read(c => !c.Jobs.Any(j => j.Id == documentJob.Id) ||
            !c.States.Any(st => st.JobId == documentJob.Id && st.WatermarkUtc == watermark)) ||
        cleaned.Read(c => !c.Runs.Any(r => r.JobId == salesJob.Id)))
        throw new Exception("La limpieza de ventas/compras antiguas debe conservar documentos e histórico.");
    if (new ConfigStore(path).Read(c => c.Entities.Any(e => e.Name is "ventas" or "compras")))
        throw new Exception("Las fuentes antiguas no deben recrearse.");

    // Incorporación en reinicio desde un origen Navadía con conexión directa.
    string warehousePath = Path.Combine(path, "warehouse-clone");
    var seedWarehouse = new ConfigStore(warehousePath);
    Guid avadiaId = Guid.NewGuid();
    Guid articlesId = seedWarehouse.Read(c => c.Entities.Single(e => e.Name == "articulos").Id);
    seedWarehouse.Change(c =>
    {
        c.Pharmacies.Add(new Pharmacy
        {
            Id = avadiaId, Code = "AVD", Name = "Farmacia Navadía",
            ConnectionMode = "direct", Server = "SQL-CENTRAL", Database = "Farmatic",
            AuthMode = "sql", Username = "lector", PasswordProtected = "cifrada",
            TimeZoneId = "Europe/Madrid", TrustServerCertificate = true, Enabled = true
        });
        c.Jobs.Add(new SyncJob
        {
            PharmacyId = avadiaId, EntityId = articlesId, Mode = "snapshot",
            Sql = "SELECT IdArticu AS origen_id FROM [Farmatic].[dbo].[Articu]",
            FullSql = "SELECT IdArticu AS origen_id FROM Farmatic.dbo.Articu",
            EveryMinutes = 720, BatchSize = 1200, ReplayMinutes = 250,
            SafetyDelayMinutes = 3, AlertRecipients = "alertas@example.invalid",
            Enabled = true
        });
    });
    var loadedWarehouse = new ConfigStore(warehousePath);
    var snapshot = loadedWarehouse.Read(c => c);
    var source = snapshot.Pharmacies.Single(p => p.Id == avadiaId);
    var target = snapshot.Pharmacies.Single(p => p.Code == "ALMACEN");
    if (target.Name != "Almacén" || target.Database != "Almacen" ||
        target.ConnectionMode != "direct" || target.LinkedServer != "" ||
        target.Server != source.Server || target.Username != source.Username ||
        target.PasswordProtected != source.PasswordProtected ||
        target.TimeZoneId != source.TimeZoneId ||
        target.TrustServerCertificate != source.TrustServerCertificate)
        throw new Exception("Almacén debe compartir servidor y conexión directa con Navadía.");
    var sourceJob = snapshot.Jobs.Single(j => j.PharmacyId == avadiaId && j.EntityId == articlesId);
    var targetJob = snapshot.Jobs.Single(j => j.PharmacyId == target.Id && j.EntityId == articlesId);
    if (targetJob.Id == sourceJob.Id || targetJob.Mode != sourceJob.Mode ||
        targetJob.Enabled != sourceJob.Enabled ||
        targetJob.EveryMinutes != sourceJob.EveryMinutes ||
        targetJob.BatchSize != sourceJob.BatchSize ||
        targetJob.ReplayMinutes != sourceJob.ReplayMinutes ||
        targetJob.SafetyDelayMinutes != sourceJob.SafetyDelayMinutes ||
        targetJob.AlertRecipients != sourceJob.AlertRecipients ||
        !targetJob.Sql.Contains("[Almacen].[dbo].[Articu]") ||
        !targetJob.FullSql.Contains("[Almacen].dbo.Articu") ||
        sourceJob.Sql.Contains("[Almacen]"))
        throw new Exception("La clonación no debe perder planificación ni leer Farmatic.");
    var synonymId = snapshot.Entities.Single(e => e.Name == "sinonimos").Id;
    if (!snapshot.Jobs.Any(j => j.PharmacyId == target.Id && j.EntityId == synonymId) ||
        snapshot.States.Any(s => s.JobId == targetJob.Id))
        throw new Exception("Se deben copiar sinónimos sin heredar estados de Avadía.");
    int jobCount = snapshot.Jobs.Count(j => j.PharmacyId == target.Id);
    loadedWarehouse.Change(c => c.Jobs.Single(j => j.Id == targetJob.Id).EveryMinutes = 360);
    var restarted = new ConfigStore(warehousePath);
    if (restarted.Read(c => c.Pharmacies.Count(p => p.Code == "ALMACEN")) != 1 ||
        restarted.Read(c => c.Jobs.Count(j => j.PharmacyId == target.Id)) != jobCount ||
        restarted.Read(c => c.Jobs.Single(j => j.Id == targetJob.Id).EveryMinutes) != 360)
        throw new Exception("El reinicio no debe duplicar ni sobrescribir el almacén.");
    if (WarehouseSource.RedirectDatabase("SELECT * FROM {{TABLE:dbo.Sinonimo}}", "Farmatic") !=
        "SELECT * FROM {{TABLE:dbo.Sinonimo}}")
        throw new Exception("No modificar las macros SQL comunes.");
    var fallbackConfig = new AppConfig();
    fallbackConfig.Pharmacies.Add(new Pharmacy
    {
        Code = "F001", Name = "Farmacia Central", ConnectionMode = "direct", Database = "Farmatic"
    });
    if (!WarehouseSource.EnsureFromAvadia(fallbackConfig).Created ||
        fallbackConfig.Pharmacies.Count(p => p.Code == "ALMACEN") != 1)
        throw new Exception("Un único origen directo Farmatic también debe reconocerse sin nombre Avadía.");
    var ambiguousConfig = new AppConfig();
    ambiguousConfig.Pharmacies.Add(new Pharmacy { Code = "F001", ConnectionMode = "direct", Database = "Farmatic" });
    ambiguousConfig.Pharmacies.Add(new Pharmacy { Code = "F002", ConnectionMode = "direct", Database = "Farmatic" });
    if (WarehouseSource.EnsureFromAvadia(ambiguousConfig).Changed ||
        ambiguousConfig.Pharmacies.Count != 2)
        throw new Exception("No adivinar cuál es Avadía cuando hay dos orígenes directos.");
    Console.WriteLine("OK: almacén directo, fuentes reales, sinónimos, SQL y configuración idempotente.");
    Console.WriteLine("OK: caída VPN sin reintentos, horario diario, zona farmacia, DST y estado persistido.");
    Console.WriteLine("OK: /login and /config reads do not wait behind history writes; snapshot is atomic.");
}
finally { Directory.Delete(path, recursive:true); }
