using System.Collections.Concurrent;
using System.Net;
using System.Net.Mail;
using System.Threading.Channels;
using FarmetricaSync.Connectors;
using FarmetricaSync.Data;
using FarmetricaSync.Security;

namespace FarmetricaSync.Core;

public sealed class SyncWorker(
    ConfigStore config, ConnectorCatalog catalog, PostgresDestination destination,
    Secrets secrets, ILogger<SyncWorker> logger) : BackgroundService
{
    private readonly Channel<SyncRequest> _queue = Channel.CreateUnbounded<SyncRequest>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
    private readonly ConcurrentDictionary<Guid, byte> _pending = new();
    private readonly ConcurrentDictionary<Guid, SyncRun> _live = new();
    private static string Diagnostic(Exception exception, string phase)
    {
        // Mostrar el error subyacente de red/SSL/SSH si existe. Nunca datos de conexión.
        var messages = new List<string>();
        for (Exception? current = exception; current is not null && messages.Count < 4; current = current.InnerException)
            if (!messages.Contains(current.Message, StringComparer.Ordinal))
                messages.Add(current.GetType().Name + ": " + current.Message);
        var text = "Etapa: " + phase + ". " + string.Join(" → ", messages);
        text = System.Text.RegularExpressions.Regex.Replace(text,
            @"(?i)(password|pwd)s*=s*[^;s]+", "$1=[oculta]");
        return text.Length > 950 ? text[..950] : text;
    }

    public bool IsPending(Guid jobId) => _pending.ContainsKey(jobId);

    public IReadOnlyList<SyncRun> GetLiveRuns() =>
        _live.Values.OrderByDescending(r => r.StartedUtc).ToList();

    private void UpdateLive(Guid jobId, Func<SyncRun, SyncRun> update)
    {
        if (_live.TryGetValue(jobId, out var current))
            _live.AddOrUpdate(jobId, current, (_, previous) => update(previous));
    }

    public bool Enqueue(Guid jobId, bool full = false)
    {
        if (!_pending.TryAdd(jobId, 0)) return false;
        var cfg = config.Read(c => c);
        var job = cfg.Jobs.FirstOrDefault(j => j.Id == jobId);
        var pharmacy = cfg.Pharmacies.FirstOrDefault(p => p.Id == job?.PharmacyId);
        var entity = cfg.Entities.FirstOrDefault(e => e.Id == job?.EntityId);
        if (job is not null)
            _live[jobId] = new SyncRun {
                Id = Guid.NewGuid(), JobId = jobId, PharmacyId = job.PharmacyId, EntityId = job.EntityId,
                PharmacyCode = pharmacy?.Code ?? "", EntityName = entity?.Name ?? "",
                Mode = full ? "snapshot" : job.Mode, Status = "queued",
                Phase = "En cola", StartedUtc = DateTimeOffset.UtcNow, Provisional = true
            };
        if (_queue.Writer.TryWrite(new SyncRequest(jobId, full))) return true;
        _pending.TryRemove(jobId, out _);
        _live.TryRemove(jobId, out _);
        return false;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Una cola de ejecución evita que dos ciclos del mismo proceso se solapen.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                EnqueueScheduled();
                while (_queue.Reader.TryRead(out var item))
                {
                    var id = item.JobId;
                    try { await ExecuteJobAsync(id, item.Full, stoppingToken); }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                    catch (Exception ex) { logger.LogError(ex, "Error no controlado en job {JobId}", id); }
                    finally { _pending.TryRemove(id, out _); _live.TryRemove(id, out _); }
                }
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error del planificador");
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }
    }

    private void EnqueueScheduled()
    {
        var now = DateTimeOffset.UtcNow;
        var cfg = config.Read(c => c);
        foreach (var job in cfg.Jobs.Where(j => j.Enabled))
        {
            var p = cfg.Pharmacies.FirstOrDefault(x => x.Id == job.PharmacyId);
            if (p?.Enabled != true) continue;
            var state = cfg.States.FirstOrDefault(s => s.JobId == job.Id);
            // Si existe una consulta de carga completa, ésta debe ejecutarse una vez antes
            // del primer ciclo incremental. Se evita así importar parcialmente el histórico.
            if (job.Mode == "incremental" && !string.IsNullOrWhiteSpace(job.FullSql)
                && state?.LastFullSuccessUtc is null) continue;
            // Éxito y error comparten el MISMO calendario programado.
            // Una VPN caída no genera nuevos intentos cada cinco minutos.
            if (SyncSchedule.IsDue(job, state, p, now)) Enqueue(job.Id);
        }
    }

    private async Task ExecuteJobAsync(Guid jobId, bool full, CancellationToken ct)
    {
        var cfg = config.Read(c => c);
        var job = cfg.Jobs.FirstOrDefault(j => j.Id == jobId);
        if (job is null || !job.Enabled) return;
        var pharmacy = cfg.Pharmacies.FirstOrDefault(p => p.Id == job.PharmacyId);
        var entity = cfg.Entities.FirstOrDefault(e => e.Id == job.EntityId);
        if (pharmacy is null || entity is null || !pharmacy.Enabled) return;
        var last = cfg.States.FirstOrDefault(x => x.JobId == jobId);
        var started = DateTimeOffset.UtcNow;
        var effectiveMode = full ? "snapshot" : job.Mode;
        var liveId = _live.TryGetValue(jobId, out var queuedRun) ? queuedRun.Id : Guid.NewGuid();
        _live[jobId] = new SyncRun {
            Id = liveId, JobId = jobId, PharmacyId = pharmacy.Id, EntityId = entity.Id,
            PharmacyCode = pharmacy.Code, EntityName = entity.Name, StartedUtc = started,
            Mode = effectiveMode, Status = "running", Phase = "Validando consulta",
            LastProgressUtc = started, Provisional = true
        };
        // Una carga completa usa su propia consulta. No modifica la programación incremental.
        var executionJob = full ? new SyncJob
        {
            PharmacyId = job.PharmacyId, EntityId = job.EntityId, Mode = "snapshot",
            Sql = job.Mode == "snapshot" ? job.Sql : job.FullSql,
            EveryMinutes = job.EveryMinutes, RetryMinutes = job.RetryMinutes, DailyAtLocal = job.DailyAtLocal, BatchSize = job.BatchSize, InitialFromUtc = job.InitialFromUtc, Enabled = job.Enabled, ReplayMinutes = job.ReplayMinutes, SafetyDelayMinutes = job.SafetyDelayMinutes
        } : job;
        // Las lecturas incrementales terminan en el límite seguro, no en la hora actual.
        // El cursor confirmado representa ese límite; relectura inclusiva e idempotente.
        var upperBound = started.UtcDateTime.AddMinutes(-job.SafetyDelayMinutes);
        var since = last?.WatermarkUtc?.UtcDateTime.AddMinutes(-job.ReplayMinutes) ?? job.InitialFromUtc.ToUniversalTime();
        if (since < job.InitialFromUtc.ToUniversalTime()) since = job.InitialFromUtc.ToUniversalTime();
        // Evitar intervalos invertidos por reloj.
        if (since > upperBound) since = upperBound;
        config.Change(c =>
        {
            var state = GetState(c, jobId);
            state.LastAttemptUtc = started;
            state.LastStatus = "running";
            state.LastError = "";
        });

        string status = "ok", error = "";
        long count = 0;
        var changes = new SyncWriteResult(0, 0, 0, 0, 0);
        long lastReportedRows = 0, lastReportedBatches = 0;
        string lastProgressPhase = "Validando consulta";
        try
        {
            SqlTemplates.ValidateKnownSourceColumns(pharmacy.SystemType, entity.Name, effectiveMode, executionJob.Sql);
            Validation.Query(executionJob);
            if (full && string.IsNullOrWhiteSpace(executionJob.Sql))
                throw new InvalidOperationException("Configura la consulta de carga completa antes de ejecutarla.");
            Validation.Entity(entity);
            if (string.IsNullOrEmpty(cfg.Destination.Host) || string.IsNullOrEmpty(cfg.Destination.Database))
                throw new InvalidOperationException("Configuración PostgreSQL pendiente.");
            UpdateLive(jobId, current => current with { Phase = "Esperando respuesta de Farmatic" });
            var batches = catalog.For(pharmacy.SystemType).ReadBatchesAsync(
                pharmacy, executionJob, entity, since, upperBound, job.BatchSize,
                rows =>
                {
                    lastReportedRows = Math.Max(lastReportedRows, rows);
                    lastProgressPhase = "Leyendo datos desde Farmatic";
                    UpdateLive(jobId, current => current with {
                        Rows = Math.Max(current.Rows, rows),
                        Phase = "Leyendo datos desde Farmatic",
                        LastProgressUtc = DateTimeOffset.UtcNow, Provisional = true
                    });
                }, ct);
            changes = await destination.WriteAsync(cfg.Destination, pharmacy, entity, effectiveMode, batches,
                p =>
                {
                    // Datos provisionales: PostgreSQL aún no ha confirmado la transacción.
                    lastReportedRows = Math.Max(lastReportedRows, p.Rows);
                    lastReportedBatches = p.Batches;
                    lastProgressPhase = p.Phase;
                    UpdateLive(jobId, existing => existing with {
                        Rows = Math.Max(existing.Rows, p.Rows), Batches = p.Batches, Inserted = p.Inserted,
                        Updated = p.Updated, Deleted = p.Deleted, Duplicates = p.Duplicates,
                        Phase = p.Phase, LastProgressUtc = DateTimeOffset.UtcNow,
                        Provisional = p.Phase != "Sincronización confirmada"
                    });
                }, ct);
            count = changes.Rows;
            UpdateLive(jobId, existing => existing with { Phase = "Finalizando historial y cursor", Provisional = false });
            logger.LogInformation("Sync {JobId} OK: {Count} filas", jobId, count);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            status = "error";
            error = Diagnostic(ex, lastProgressPhase);
            UpdateLive(jobId, existing => existing with {
                Status = "error", Phase = "Error (transacción revertida)",
                Rows = lastReportedRows, Batches = lastReportedBatches,
                LastProgressUtc = DateTimeOffset.UtcNow, Error = error, Provisional = true
            });
            logger.LogError(ex, "Sync {JobId} falló", jobId);
        }
        var completed = DateTimeOffset.UtcNow;
        config.Change(c =>
        {
            var state = GetState(c, jobId);
            state.LastStatus = status;
            state.LastCompletedUtc = completed;
            state.LastError = error;
            state.LastRows = count;
            state.LastInserted = changes.Inserted;
            state.LastUpdated = changes.Updated;
            state.LastDeleted = changes.Deleted;
            if (status == "ok")
            {
                state.LastSuccessUtc = completed;
                if (full)
                {
                    state.LastFullSuccessUtc = completed;
                    // Tras completar el snapshot, el incremental continúa desde el inicio
                    // de la extracción completa con solapamiento, para no perder cambios.
                    if (job.Mode == "incremental" && (state.WatermarkUtc is null || state.WatermarkUtc < upperBound))
                        state.WatermarkUtc = upperBound;
                }
                else if (job.Mode == "incremental") state.WatermarkUtc = upperBound;
            }
            c.Runs.Insert(0, new SyncRun
            {
                JobId = jobId, PharmacyId = pharmacy.Id, EntityId = entity.Id, StartedUtc = started, FinishedUtc = completed,
                Phase = status == "ok" ? "Finalizada" : "Error (sin confirmar)",
                Status = status, Mode = effectiveMode,
                Rows = status == "ok" ? count : lastReportedRows,
                Batches = lastReportedBatches,
                LastProgressUtc = completed, Provisional = status != "ok",
                Inserted = changes.Inserted,
                Updated = changes.Updated, Deleted = changes.Deleted, Duplicates = changes.Duplicates,
                PharmacyCode = pharmacy.Code, EntityName = entity.Name,
                FromUtc = effectiveMode == "incremental" ? new DateTimeOffset(since, TimeSpan.Zero) : null,
                UntilUtc = effectiveMode == "incremental" ? new DateTimeOffset(upperBound, TimeSpan.Zero) : null,
                Error = error
            });
            if (c.Runs.Count > 10000) c.Runs.RemoveRange(10000, c.Runs.Count - 10000);
        });
        if (status == "error") await MaybeAlertAsync(cfg.Mail, pharmacy, entity, jobId, error, job.AlertRecipients, ct);
        else if (last?.LastStatus == "error" && cfg.Mail.NotifyRecovery)
            await SendMailAsync(cfg.Mail, pharmacy, entity, "Recuperado", "La sincronización vuelve a funcionar.", job.AlertRecipients, ct);
    }

    private readonly record struct SyncRequest(Guid JobId, bool Full);

    private static SyncState GetState(AppConfig c, Guid id)
    {
        var state = c.States.FirstOrDefault(s => s.JobId == id);
        if (state is not null) return state;
        state = new SyncState { JobId = id };
        c.States.Add(state);
        return state;
    }

    private async Task MaybeAlertAsync(MailSettings mail, Pharmacy pharmacy, EntityDefinition entity,
        Guid jobId, string error, string recipients, CancellationToken ct)
    {
        if (!mail.Enabled || string.IsNullOrWhiteSpace(string.IsNullOrWhiteSpace(recipients) ? mail.To : recipients) || string.IsNullOrWhiteSpace(mail.Host)) return;
        var state = config.Read(c => c.States.FirstOrDefault(s => s.JobId == jobId));
        if (state?.LastAlertUtc is not null && DateTimeOffset.UtcNow - state.LastAlertUtc < TimeSpan.FromHours(1)) return;
        if (await SendMailAsync(mail, pharmacy, entity, "Error", error, recipients, ct))
            config.Change(c => GetState(c, jobId).LastAlertUtc = DateTimeOffset.UtcNow);
    }

    public async Task<bool> SendMailAsync(MailSettings mail, Pharmacy pharmacy, EntityDefinition entity,
        string label, string detail, string recipients, CancellationToken ct)
    {
        if (!mail.Enabled || string.IsNullOrWhiteSpace(mail.Host)) return false;
        try
        {
            using var client = new SmtpClient(mail.Host, mail.Port) { EnableSsl = true, Timeout = 15000 };
            if (!string.IsNullOrWhiteSpace(mail.Username))
                client.Credentials = new NetworkCredential(mail.Username, secrets.Decrypt(mail.PasswordProtected));
            using var message = new MailMessage { From = new MailAddress(mail.From),
                Subject = $"[Farmétrica Sync] {label}: {pharmacy.Code} / {entity.Name}",
                Body = $"Farmacia: {pharmacy.Name} ({pharmacy.Code})\nEntidad: {entity.Name}\nFecha UTC: {DateTimeOffset.UtcNow:O}\n\n{detail}" };
            var all = string.IsNullOrWhiteSpace(recipients) ? mail.To : recipients;
            foreach (var address in all.Split([',',';','\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                message.To.Add(new MailAddress(address));
            if (message.To.Count == 0) throw new InvalidOperationException("No hay destinatarios SMTP.");
            await client.SendMailAsync(message, ct);
            return true;
        }
        catch (Exception ex) { logger.LogWarning(ex, "No se pudo enviar el aviso SMTP"); return false; }

    }
}
