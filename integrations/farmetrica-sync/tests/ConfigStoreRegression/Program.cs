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
    Console.WriteLine("OK: /login and /config reads do not wait behind history writes; snapshot is atomic.");
}
finally { Directory.Delete(path, recursive:true); }
