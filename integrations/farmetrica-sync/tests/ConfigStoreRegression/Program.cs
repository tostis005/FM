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
    Console.WriteLine("OK: caída VPN sin reintentos, horario diario, zona farmacia, DST y estado persistido.");
    Console.WriteLine("OK: /login and /config reads do not wait behind history writes; snapshot is atomic.");
}
finally { Directory.Delete(path, recursive:true); }
