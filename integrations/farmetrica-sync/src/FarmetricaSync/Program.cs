using System.Security.Claims;
using System.Text.RegularExpressions;
using FarmetricaSync.Connectors;
using FarmetricaSync.Core;
using FarmetricaSync.Data;
using FarmetricaSync.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(options => options.ServiceName = "FarmetricaSync");
// El panel contiene credenciales y consultas SQL: denegar cualquier escucha remota,
 // incluso si se sobreescribe Urls desde appsettings o variables de entorno.
string listeningUrls = builder.Configuration["Urls"] ?? "http://127.0.0.1:5080";
if (string.IsNullOrWhiteSpace(listeningUrls))
    throw new InvalidOperationException("Falta una dirección de escucha local válida.");
foreach (string endpoint in listeningUrls.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
{
    if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var parsed) ||
        (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        throw new InvalidOperationException("URL de acceso al panel no válida.");
    bool loopback = parsed.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
        (System.Net.IPAddress.TryParse(parsed.Host, out var ip) && System.Net.IPAddress.IsLoopback(ip));
    if (!loopback)
        throw new InvalidOperationException(
            "Farmétrica Sync solo permite el panel en localhost/127.0.0.1/::1. Usa acceso local o túnel SSH, nunca una interfaz pública.");
}
builder.WebHost.UseUrls(listeningUrls);

string dataDir = Environment.GetEnvironmentVariable("FARMETRICA_SYNC_DATA") ??
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FarmetricaSync");
Directory.CreateDirectory(dataDir);
var keys = Path.Combine(dataDir, "keys");
Directory.CreateDirectory(keys);
var dp = builder.Services.AddDataProtection()
    .SetApplicationName("FarmetricaSync")
    .PersistKeysToFileSystem(new DirectoryInfo(keys));
if (OperatingSystem.IsWindows()) dp.ProtectKeysWithDpapi(protectToLocalMachine: true);

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "fs.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // loopback HTTP solamente
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();
builder.Services.AddSingleton(new ConfigStore(dataDir));
builder.Services.AddSingleton<Secrets>();
builder.Services.AddSingleton<ISourceConnector, FarmaticConnector>();
builder.Services.AddSingleton<ConnectorCatalog>();
builder.Services.AddSingleton<SshForward>();
builder.Services.AddSingleton<PostgresDestination>();
builder.Services.AddSingleton<SyncWorker>();
builder.Services.AddHostedService<SyncWorker>(sp => sp.GetRequiredService<SyncWorker>());

var app = builder.Build();

// El panel NO debe escucharse en interfaces públicas sin TLS/proxy/autenticación adicional.
app.UseDefaultFiles();
app.UseStaticFiles();
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api") &&
        (HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsPut(ctx.Request.Method) || HttpMethods.IsDelete(ctx.Request.Method)))
    {
        if (ctx.Request.Headers["X-Farmetrica-Request"] != "1")
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsJsonAsync(new { error = "Falta la cabecera de seguridad de la aplicación." });
            return;
        }
    }
    try { await next(ctx); }
    catch (ArgumentException ex)
    {
        if (!ctx.Response.HasStarted)
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
        }
    }
    catch (InvalidOperationException ex)
    {
        if (!ctx.Response.HasStarted)
        {
            ctx.Response.StatusCode = 409;
            await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Error en API");
        if (!ctx.Response.HasStarted)
        {
            ctx.Response.StatusCode = 500;
            await ctx.Response.WriteAsJsonAsync(new { error = "Error interno. Consultar el registro del servicio." });
        }
    }
});
app.UseAuthentication();
app.UseAuthorization();

// Liveness independiente de cualquier bloqueo PostgreSQL o del histórico.
app.MapGet("/api/ping", () => Results.Ok(new {
    ok = true, version = "0.16.0", atUtc = DateTimeOffset.UtcNow
}));

// El bootstrap solo se admite desde loopback, con una única contraseña admin.
app.MapGet("/api/bootstrap-status", (ConfigStore store) => new
{
    initialized = store.Read(c => c.AdminHash is not null),
    version = "0.16.0"
});
app.MapPost("/api/bootstrap", (PasswordRequest r, HttpContext ctx, ConfigStore store) =>
{
    if (!System.Net.IPAddress.IsLoopback(ctx.Connection.RemoteIpAddress ?? System.Net.IPAddress.None))
        return Results.Forbid();
    if (r.Password is null || r.Password.Length is < 12 or > 200)
        return Results.BadRequest(new { error = "La contraseña debe tener entre 12 y 200 caracteres." });
    if (store.Read(c => c.AdminHash is not null)) return Results.Conflict(new { error = "Administrador configurado." });
    var (salt, hash) = Passwords.Create(r.Password);
    store.Change(c =>
    {
        if (c.AdminHash is not null) throw new InvalidOperationException("El administrador ya está configurado.");
        c.AdminSalt = salt;
        c.AdminHash = hash;
    });
    return Results.Ok(new { ok = true });
});
app.MapPost("/api/login", async (PasswordRequest r, HttpContext ctx, ConfigStore store) =>
{
    // La derivación de contraseña no debe ejecutarse durante un bloqueo de
    // serialización del historial. Leer solo salt/hash y verificar aparte.
    var credentials = store.Read(c => (c.AdminSalt, c.AdminHash));
    bool valid = await Task.Run(() => Passwords.Verify(r.Password ?? "",
        credentials.AdminSalt, credentials.AdminHash), ctx.RequestAborted);
    if (!valid)
    {
        await Task.Delay(500); // retardo básico; el panel no es público
        return Results.Json(new { error = "Contraseña incorrecta." }, statusCode: 401);
    }
    var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], CookieAuthenticationDefaults.AuthenticationScheme));
    await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
    return Results.Ok(new { ok = true });
});

var api = app.MapGroup("/api").RequireAuthorization();
api.MapPost("/logout", async (HttpContext ctx) => { await ctx.SignOutAsync(); return Results.Ok(new { ok = true }); });
api.MapGet("/config", (ConfigStore store, SyncWorker worker) =>
{
    var c = store.Read(x => x);
    return Results.Ok(new
    {
        destination = new { c.Destination.Host, c.Destination.Port, c.Destination.Database, c.Destination.Username,
            c.Destination.Schema, c.Destination.SslMode,
            c.Destination.SshEnabled, c.Destination.SshHost, c.Destination.SshPort,
            c.Destination.SshUsername, c.Destination.SshAuthMode,
            c.Destination.SshPrivateKeyPath, c.Destination.SshHostKeySha256,
            passwordPresent = c.Destination.PasswordProtected.Length > 0,
            sshPasswordPresent = c.Destination.SshPasswordProtected.Length > 0,
            sshKeyPassphrasePresent = c.Destination.SshKeyPassphraseProtected.Length > 0 },
        mail = new { c.Mail.Enabled, c.Mail.Host, c.Mail.Port, c.Mail.Username, c.Mail.From,
            c.Mail.To, c.Mail.NotifyRecovery, passwordPresent = c.Mail.PasswordProtected.Length > 0 },
        pharmacies = c.Pharmacies.Select(p => new { p.Id, p.Code, p.Name, p.SystemType, p.CountryCode, p.ConnectionMode,
            p.Server, p.Database, p.LinkedServer, p.AuthMode, p.Username, p.TimeZoneId, p.TrustServerCertificate, p.Enabled,
            passwordPresent = p.PasswordProtected.Length > 0 }),
        entities = c.Entities,
        templates = SqlTemplates.All.Where(t => t.Entity is not ("ventas" or "compras")),
        jobs = c.Jobs,
        states = c.States,
        // Runs ya se guarda de más reciente a más antigua: ordenar solo una
        // ventana de 100 en vez de todos los 10.000 históricos cada 3 segundos.
        runs = worker.GetLiveRuns().Concat(c.Runs.Where(r =>
             !string.Equals(r.EntityName, "ventas", StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(r.EntityName, "compras", StringComparison.OrdinalIgnoreCase)).Take(100))
            .OrderByDescending(r => r.StartedUtc).Take(100)
    });
});
api.MapGet("/runs", (Guid? pharmacyId, Guid? entityId, string? status, int? skip, int? take, ConfigStore store, SyncWorker worker) =>
{
    int offset = Math.Max(0, skip ?? 0), size = Math.Clamp(take ?? 100, 1, 500);
    return store.Read(c =>
    {
        var jobs = c.Jobs.ToDictionary(j => j.Id);
        IEnumerable<SyncRun> runs = worker.GetLiveRuns().Concat(c.Runs.Where(r =>
             !string.Equals(r.EntityName, "ventas", StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(r.EntityName, "compras", StringComparison.OrdinalIgnoreCase)))
             .OrderByDescending(r => r.StartedUtc);
        if (pharmacyId.HasValue) runs = runs.Where(r => r.PharmacyId == pharmacyId.Value || (jobs.TryGetValue(r.JobId, out var j) && j.PharmacyId == pharmacyId.Value));
        if (entityId.HasValue) runs = runs.Where(r => r.EntityId == entityId.Value || (jobs.TryGetValue(r.JobId, out var j) && j.EntityId == entityId.Value));
        if (!string.IsNullOrWhiteSpace(status)) runs = runs.Where(r => r.Status == status);
        return Results.Ok(new { total = runs.Count(), runs = runs.Skip(offset).Take(size).ToList(), states = c.States });
    });
});
api.MapPost("/mail/test", async (ConfigStore store, SyncWorker worker, CancellationToken ct) =>
{
    var c = store.Read(x => x);
    if (!c.Mail.Enabled) return Results.BadRequest(new { error = "Activa las alertas antes de probar SMTP." });
    var testPharmacy = new Pharmacy { Code = "SERVICIO", Name = "Prueba de configuración" };
    var testEntity = new EntityDefinition { Name = "smtp" };
    bool sent = await worker.SendMailAsync(c.Mail, testPharmacy, testEntity, "Prueba SMTP",
        "Este mensaje comprueba el envío de avisos desde Farmétrica Sync.", "", ct);
    return sent ? Results.Ok(new { ok = true }) : Results.Problem("No se pudo enviar el correo: revisar el registro del servicio.");
});
api.MapPost("/mail/test-draft", async (MailRequest r, ConfigStore store, Secrets secrets, SyncWorker worker, CancellationToken ct) =>
{
    var saved = store.Read(c => c.Mail);
    if (string.IsNullOrWhiteSpace(r.Host) || string.IsNullOrWhiteSpace(r.From) || string.IsNullOrWhiteSpace(r.To))
        return Results.BadRequest(new { error = "Configura servidor, remitente y destinatarios SMTP." });
    if (r.Port is < 1 or > 65535) return Results.BadRequest(new { error = "Puerto SMTP no válido." });
    var mail = new MailSettings { Enabled = true, Host = r.Host, Port = r.Port, Username = r.Username,
        From = r.From, To = r.To, NotifyRecovery = r.NotifyRecovery,
        PasswordProtected = string.IsNullOrEmpty(r.Password) ? saved.PasswordProtected : secrets.Encrypt(r.Password) };
    bool sent = await worker.SendMailAsync(mail, new Pharmacy { Code = "SERVICIO", Name = "Prueba SMTP" },
        new EntityDefinition { Name = "smtp" }, "Prueba SMTP", "Envío sin guardar la configuración.", "", ct);
    return sent ? Results.Ok(new { ok = true }) : Results.Problem("Falló el envío. Revisar el registro del servicio.");
});
api.MapGet("/health", () => Results.Ok(new { ok = true, timeUtc = DateTimeOffset.UtcNow }));

api.MapPut("/destination", (DestinationRequest r, ConfigStore store, Secrets secrets) =>
{
    var previous = store.Read(c => c.Destination);
    var draft = BuildDestination(r, previous, secrets);
    if (string.IsNullOrWhiteSpace(draft.PasswordProtected))
        return Results.BadRequest(new { error = "Indica la contraseña PostgreSQL." });
    store.Change(c => c.Destination = draft);
    return Results.Ok(new { ok = true });
});
api.MapPost("/destination/test-ssh-draft", async (DestinationProbeRequest r, ConfigStore store,
    Secrets secrets, PostgresDestination dest, CancellationToken ct) =>
{
    var draft = BuildDestination(r.Destination, store.Read(c => c.Destination), secrets);
    if (!draft.SshEnabled) return Results.BadRequest(new { error = "Activa primero el túnel SSH." });
    await dest.TestSshAsync(draft, ct);
    return Results.Ok(new { ok = true, message = "Servidor SSH y huella digital verificados (sin guardar). No se ha intentado acceder a PostgreSQL." });
});
api.MapPost("/destination/test-draft", async (DestinationProbeRequest r, ConfigStore store,
    Secrets secrets, PostgresDestination dest, CancellationToken ct) =>
{
    var draft = BuildDestination(r.Destination, store.Read(c => c.Destination), secrets);
    if (string.IsNullOrWhiteSpace(draft.PasswordProtected))
        return Results.BadRequest(new { error = "Indica la contraseña PostgreSQL." });
    await dest.TestAsync(draft, ct);
    return Results.Ok(new { ok = true, message = draft.SshEnabled
        ? "SSH y conexión PostgreSQL verificados (sin guardar)."
        : "Conexión PostgreSQL comprobada (sin guardar)." });
});
api.MapPost("/destination/test", async (ConfigStore store, PostgresDestination dest, CancellationToken ct) =>
{
    await dest.TestAsync(store.Read(c => c.Destination), ct);
    return Results.Ok(new { ok = true, message = "Conexión PostgreSQL verificada." });
});
static Destination BuildDestination(DestinationRequest r, Destination previous, Secrets secrets)
{
    Validation.Id(r.Schema, "Esquema");
    if (string.IsNullOrWhiteSpace(r.Host) || string.IsNullOrWhiteSpace(r.Database) ||
        string.IsNullOrWhiteSpace(r.Username) || r.Port is < 1 or > 65535)
        throw new ArgumentException("Completa servidor, puerto, base de datos y usuario.");
    if (r.SslMode is not ("VerifyFull" or "VerifyCA" or "Require" or "Disable"))
        throw new ArgumentException("Modo SSL no permitido.");
    if (!r.SshEnabled && r.SslMode == "Disable")
        throw new ArgumentException("Sin SSH debes habilitar SSL con PostgreSQL.");
    var dest = new Destination
    {
        Host = r.Host.Trim(), Port = r.Port,
        Database = r.Database.Trim(), Username = r.Username.Trim(),
        Schema = r.Schema.Trim(), SslMode = r.SslMode,
        PasswordProtected = string.IsNullOrEmpty(r.Password) ? previous.PasswordProtected : secrets.Encrypt(r.Password),
        SshEnabled = r.SshEnabled, SshHost = r.SshHost?.Trim() ?? "",
        SshPort = r.SshPort, SshUsername = r.SshUsername?.Trim() ?? "",
        SshAuthMode = r.SshAuthMode ?? "password",
        SshPrivateKeyPath = r.SshPrivateKeyPath?.Trim() ?? "",
        SshHostKeySha256 = r.SshHostKeySha256?.Trim() ?? "",
        SshPasswordProtected = string.IsNullOrEmpty(r.SshPassword)
            ? previous.SshPasswordProtected : secrets.Encrypt(r.SshPassword),
        SshKeyPassphraseProtected = string.IsNullOrEmpty(r.SshKeyPassphrase)
            ? previous.SshKeyPassphraseProtected : secrets.Encrypt(r.SshKeyPassphrase)
    };
    SshForward.Validate(dest);
    return dest;
}
api.MapPut("/mail", (MailRequest r, ConfigStore store, Secrets secrets) =>
{
    if (r.Enabled && (string.IsNullOrWhiteSpace(r.Host) || string.IsNullOrWhiteSpace(r.From) || string.IsNullOrWhiteSpace(r.To)))
        return Results.BadRequest(new { error = "Configura servidor SMTP, origen y destinatario." });
    if (r.Port is < 1 or > 65535) return Results.BadRequest(new { error = "Puerto SMTP no válido." });
    store.Change(c =>
    {
        c.Mail.Enabled = r.Enabled;
        c.Mail.Host = r.Host.Trim();
        c.Mail.Port = r.Port;
        c.Mail.Username = r.Username.Trim();
        c.Mail.From = r.From.Trim();
        c.Mail.To = r.To.Trim();
        c.Mail.NotifyRecovery = r.NotifyRecovery;
        if (!string.IsNullOrEmpty(r.Password)) c.Mail.PasswordProtected = secrets.Encrypt(r.Password);
    });
    return Results.Ok(new { ok = true });
});

static void ValidatePharmacy(PharmacyRequest r)
{
    if (!Regex.IsMatch(r.Code ?? "", "^[a-zA-Z0-9_-]{1,40}$") || string.IsNullOrWhiteSpace(r.Name))
        throw new ArgumentException("Código (hasta 40 letras/números/_/-) y nombre son obligatorios.");
    if (!Regex.IsMatch(r.CountryCode ?? "", "^[A-Z]{2}$", RegexOptions.IgnoreCase))
        throw new ArgumentException("El país debe ser un código ISO de dos letras.");
    if (r.SystemType != "farmatic") throw new ArgumentException("Por ahora solo está disponible Farmatic.");
    if (r.ConnectionMode is not ("linked" or "direct")) throw new ArgumentException("Tipo de conexión no válido.");
    if (r.AuthMode is not ("integrated" or "sql")) throw new ArgumentException("Autenticación no válida.");
    if (string.IsNullOrWhiteSpace(r.Server) || string.IsNullOrWhiteSpace(r.Database)) throw new ArgumentException("Servidor y base de datos son obligatorios.");
    if (r.ConnectionMode == "linked" && string.IsNullOrWhiteSpace(r.LinkedServer)) throw new ArgumentException("Indica el nombre del Linked Server.");
    if (r.AuthMode == "sql" && string.IsNullOrWhiteSpace(r.Username)) throw new ArgumentException("Indica el usuario SQL.");
    try { _ = TimeZoneInfo.FindSystemTimeZoneById(r.TimeZoneId); }
    catch (TimeZoneNotFoundException) { throw new ArgumentException("Zona horaria no encontrada en este Windows Server."); }
    catch (InvalidTimeZoneException) { throw new ArgumentException("Zona horaria configurada no válida."); }
}
static Pharmacy Apply(Pharmacy p, PharmacyRequest r, Secrets secrets)
{
    p.Code = r.Code.Trim(); p.Name = r.Name.Trim(); p.SystemType = r.SystemType;
    p.CountryCode = r.CountryCode.Trim().ToUpperInvariant();
    p.ConnectionMode = r.ConnectionMode; p.Server = r.Server.Trim(); p.Database = r.Database.Trim();
    p.LinkedServer = r.LinkedServer.Trim(); p.AuthMode = r.AuthMode; p.Username = r.Username.Trim();
    p.TimeZoneId = r.TimeZoneId; p.TrustServerCertificate = r.TrustServerCertificate; p.Enabled = r.Enabled;
    if (!string.IsNullOrEmpty(r.Password)) p.PasswordProtected = secrets.Encrypt(r.Password);
    return p;
}
api.MapPost("/pharmacies", (PharmacyRequest r, ConfigStore store, Secrets secrets) =>
{
    ValidatePharmacy(r);
    var p = Apply(new Pharmacy(), r, secrets);
    store.Change(c =>
    {
        if (c.Pharmacies.Any(x => x.Code.Equals(p.Code, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("Ya existe una farmacia con ese código.");
        c.Pharmacies.Add(p);
    });
    return Results.Ok(new { p.Id });
});
api.MapPut("/pharmacies/{id:guid}", (Guid id, PharmacyRequest r, ConfigStore store, Secrets secrets) =>
{
    ValidatePharmacy(r);
    store.Change(c =>
    {
        var existing = c.Pharmacies.SingleOrDefault(p => p.Id == id) ?? throw new ArgumentException("Farmacia no encontrada.");
        if (existing.Code != r.Code) throw new ArgumentException("El código de farmacia es inmutable: para cambiarlo hay que migrar antes las filas de destino.");
        Apply(existing, r, secrets);
    });
    return Results.Ok(new { ok = true });
});
api.MapDelete("/pharmacies/{id:guid}", (Guid id, ConfigStore store) =>
{
    store.Change(c =>
    {
        if (c.Jobs.Any(j => j.PharmacyId == id)) throw new ArgumentException("Elimina primero sus consultas.");
        c.Pharmacies.RemoveAll(p => p.Id == id);
    });
    return Results.Ok(new { ok = true });
});
api.MapPost("/pharmacies/test-draft", async (PharmacyProbeRequest r, ConfigStore store, Secrets secrets, ConnectorCatalog catalog, CancellationToken ct) =>
{
    ValidatePharmacy(r.Pharmacy);
    var old = r.ExistingPharmacyId.HasValue
        ? store.Read(c => c.Pharmacies.SingleOrDefault(p => p.Id == r.ExistingPharmacyId.Value)) : null;
    var draft = Apply(new Pharmacy(), r.Pharmacy, secrets);
    if (r.Pharmacy.AuthMode == "sql" && string.IsNullOrWhiteSpace(r.Pharmacy.Password))
    {
        if (old is null || old.AuthMode != "sql" || string.IsNullOrWhiteSpace(old.PasswordProtected))
            return Results.BadRequest(new { error = "Indica la contraseña SQL." });
        draft.PasswordProtected = old.PasswordProtected;
    }
    await catalog.For(draft.SystemType).TestAsync(draft, ct);
    return Results.Ok(new { ok = true, message = "Conexión comprobada sin guardar. Para validar las tablas, utiliza la vista previa de consultas." });
});
api.MapPost("/pharmacies/{id:guid}/test", async (Guid id, ConfigStore store, ConnectorCatalog catalog, CancellationToken ct) =>
{
    var p = store.Read(c => c.Pharmacies.SingleOrDefault(p => p.Id == id)) ?? throw new ArgumentException("Farmacia no encontrada.");
    await catalog.For(p.SystemType).TestAsync(p, ct);
    return Results.Ok(new { ok = true, message = "SQL Server accesible. La consulta de entidad confirmará el acceso a las tablas remotas." });
});

api.MapPost("/entities", (EntityDefinition entity, ConfigStore store) =>
{
    entity.Id = Guid.NewGuid();
    entity.Name = entity.Name.Trim().ToLowerInvariant();
    if (entity.Name == "stock")
        throw new ArgumentException("El stock se sincroniza dentro de artículos. No se admite crear una entidad stock independiente.");
    Validation.Entity(entity);
    store.Change(c =>
    {
        if (c.Entities.Any(e => e.Name == entity.Name)) throw new ArgumentException("Entidad duplicada.");
        c.Entities.Add(entity);
    });
    return Results.Ok(new { entity.Id });
});
api.MapPut("/entities/{id:guid}", (Guid id, EntityDefinition entity, ConfigStore store) =>
{
    Validation.Entity(entity);
    store.Change(c =>
    {
        var prev = c.Entities.SingleOrDefault(e => e.Id == id) ?? throw new ArgumentException("Entidad no encontrada.");
        if (prev.Name != entity.Name) throw new ArgumentException("No se puede renombrar una tabla existente desde el sincronizador.");
        foreach (var oldCol in prev.Columns)
            if (!entity.Columns.Any(x => x.Name == oldCol.Name && x.Type == oldCol.Type))
                throw new ArgumentException("Solo se pueden añadir columnas; eliminar o cambiar tipos requiere migración SQL explícita.");
        prev.Description = entity.Description;
        prev.Columns = entity.Columns;
    });
    return Results.Ok(new { ok = true });
});
api.MapDelete("/entities/{id:guid}", (Guid id, ConfigStore store) =>
{
    store.Change(c =>
    {
        if (c.Jobs.Any(j => j.EntityId == id)) throw new ArgumentException("Elimina primero sus consultas.");
        c.Entities.RemoveAll(e => e.Id == id);
    });
    return Results.Ok(new { ok = true });
});

static SyncJob ApplyJob(SyncJob job, JobRequest r, AppConfig config)
{
    job.PharmacyId = r.PharmacyId; job.EntityId = r.EntityId;
    var pharmacy = config.Pharmacies.FirstOrDefault(p => p.Id == r.PharmacyId);
    var entity = config.Entities.FirstOrDefault(e => e.Id == r.EntityId);
    if (pharmacy is null || entity is null) throw new ArgumentException("Farmacia o entidad no encontrada.");
    job.Sql = SqlTemplates.NormalizeForMode(pharmacy.SystemType, entity.Name, r.Mode, r.Sql ?? "");
    job.FullSql = r.FullSql ?? ""; job.Mode = r.Mode;
    SqlTemplates.ValidateKnownSourceColumns(pharmacy.SystemType, entity.Name, job.Mode, job.Sql);
    job.EveryMinutes = r.EveryMinutes; job.RetryMinutes = r.RetryMinutes;
    job.DailyAtLocal = string.IsNullOrWhiteSpace(r.DailyAtLocal) ? null : r.DailyAtLocal.Trim();
    job.BatchSize = r.BatchSize; job.InitialFromUtc = r.InitialFromUtc.ToUniversalTime();
    job.Enabled = r.Enabled;
    job.ReplayMinutes = r.ReplayMinutes; job.SafetyDelayMinutes = r.SafetyDelayMinutes; job.AlertRecipients = r.AlertRecipients?.Trim() ?? "";
    Validation.Query(job);
    return job;
}
static void ValidateRefs(AppConfig c, SyncJob j)
{
    if (!c.Pharmacies.Any(p => p.Id == j.PharmacyId) || !c.Entities.Any(e => e.Id == j.EntityId))
        throw new ArgumentException("Farmacia o entidad no encontrada.");
    if (c.Jobs.Any(other => other.Id != j.Id && other.PharmacyId == j.PharmacyId && other.EntityId == j.EntityId))
        throw new ArgumentException("Ya existe una consulta para esta farmacia y entidad.");
}
api.MapPost("/jobs/preview", async (JobPreviewRequest r, ConfigStore store, ConnectorCatalog catalog, CancellationToken ct) =>
{
    var c = store.Read(x => x);
    var p = c.Pharmacies.SingleOrDefault(p => p.Id == r.PharmacyId)
        ?? throw new ArgumentException("Guarda primero la farmacia para comprobar la consulta.");
    var entity = c.Entities.SingleOrDefault(e => e.Id == r.EntityId)
        ?? throw new ArgumentException("Entidad no encontrada.");
    if (r.Mode is not ("incremental" or "snapshot"))
        throw new ArgumentException("Modo de consulta desconocido.");
    var sql = SqlTemplates.NormalizeForMode(p.SystemType, entity.Name, r.Mode, r.Sql);
    SqlTemplates.ValidateKnownSourceColumns(p.SystemType, entity.Name, r.Mode, sql);
    Validation.ValidateSelect(sql, r.Mode == "incremental");
    if (string.IsNullOrWhiteSpace(sql)) throw new ArgumentException("Indica primero la consulta SQL.");
    if (r.UntilUtc <= r.FromUtc) throw new ArgumentException("La fecha final debe ser mayor que la inicial.");
    var job = new SyncJob { Mode = r.Mode, Sql = sql };
    var rows = await catalog.For(p.SystemType).PreviewAsync(p, job, entity,
        r.FromUtc.ToUniversalTime(), r.UntilUtc.ToUniversalTime(), 100, ct);
    foreach (var row in rows) row["farmacia"] = p.Code; // solo la vista previa; el destino la genera automáticamente
    return Results.Ok(new { pharmacy = p.Code, entity = entity.Name,
        columns = entity.Columns.Select(c => c.Name).Append("farmacia"), rows, count = rows.Count,
        note = "Vista previa de hasta 100 filas. No se ha guardado la consulta ni escrito nada en PostgreSQL." });
});
// La actualización de plantilla nunca recrea trabajos ni toca estados/cursors.
static bool IsFarmaticArticles(AppConfig c, SyncJob job) =>
    c.Entities.Any(e => e.Id == job.EntityId && e.Name == "articulos") &&
    c.Pharmacies.Any(p => p.Id == job.PharmacyId && p.SystemType == "farmatic");

static void ApplyUnifiedArticlesTemplate(SyncJob job)
{
    if (job.Mode != "snapshot")
        throw new ArgumentException("Artículos incluye existencias cambiantes y requiere carga completa periódica. Configura modo snapshot antes de actualizar el SELECT.");
    var t = SqlTemplates.All.Single(t => t.SystemType == "farmatic" && t.Entity == "articulos");
    job.Sql = t.FullSql;
    job.FullSql = t.FullSql;
    Validation.Query(job);
}

static bool IsFarmaticPurchases(AppConfig c, SyncJob job) =>
    c.Entities.Any(e => e.Id == job.EntityId && e.Name == "compras") &&
    c.Pharmacies.Any(p => p.Id == job.PharmacyId && p.SystemType == "farmatic");

static void ApplyUnifiedPurchasesTemplate(SyncJob job)
{
    var t = SqlTemplates.All.Single(t => t.SystemType == "farmatic" && t.Entity == "compras");
    job.Sql = job.Mode == "snapshot" ? t.FullSql : t.Sql;
    job.FullSql = t.FullSql;
    Validation.Query(job);
}

api.MapPost("/jobs/{id:guid}/update-schema", (Guid id, ConfigStore store, SyncWorker worker) =>
{
    if (worker.IsPending(id)) return Results.Conflict(new { error = "Espera a que termine la sincronización antes de actualizar su SELECT." });
    string pharmacyCode = "";
    store.Change(c =>
    {
        var job = c.Jobs.SingleOrDefault(j => j.Id == id) ?? throw new ArgumentException("Consulta no encontrada.");
        if (IsFarmaticPurchases(c, job)) ApplyUnifiedPurchasesTemplate(job);
        else if (IsFarmaticArticles(c, job)) ApplyUnifiedArticlesTemplate(job);
        else throw new ArgumentException("Actualización desde esquema disponible para compras y artículos Farmatic.");
        pharmacyCode = c.Pharmacies.Single(p => p.Id == job.PharmacyId).Code;
    });
    return Results.Ok(new { ok = true, pharmacy = pharmacyCode, message = "Ambas consultas unificadas y guardadas, sin cambiar ID, política, periodicidad ni cursor." });
});

api.MapPost("/jobs/compras/update-schema-all", (ConfigStore store, SyncWorker worker) =>
{
    var config = store.Read(c => c);
    var candidates = config.Jobs.Where(j => IsFarmaticPurchases(config, j)).ToList();
    if (candidates.Any(j => worker.IsPending(j.Id)))
        return Results.Conflict(new { error = "Hay compras ejecutándose o en cola. Espera a que terminen antes de actualizar los cinco SELECT." });
    int updated = 0;
    store.Change(c =>
    {
        foreach (var job in c.Jobs.Where(j => IsFarmaticPurchases(c, j)))
        {
            ApplyUnifiedPurchasesTemplate(job);
            updated++;
        }
    });
    return Results.Ok(new { ok = true, updated, message = $"Actualizados y guardados los SELECT comunes de {updated} orígenes. Se conservan historial y cursores." });
});

api.MapPost("/jobs/articulos/update-schema-all", (ConfigStore store, SyncWorker worker) =>
{
    var config = store.Read(c => c);
    var candidates = config.Jobs.Where(j => IsFarmaticArticles(config, j)).ToList();
    if (candidates.Any(j => worker.IsPending(j.Id)))
        return Results.Conflict(new { error = "Hay artículos sincronizándose o en cola. Espera a que terminen." });
    if (candidates.Any(j => j.Mode != "snapshot"))
        return Results.Conflict(new { error = "Las existencias son cambiantes; configura las consultas de artículos como cargas completas (snapshot)." });
    int updated = 0;
    store.Change(c =>
    {
        foreach (var job in c.Jobs.Where(j => IsFarmaticArticles(c, j)))
        {
            ApplyUnifiedArticlesTemplate(job);
            updated++;
        }
    });
    return Results.Ok(new { ok = true, updated,
        message = $"Actualizados los {updated} SELECT de artículos con existencias. Carga completa periódica; historiales y configuración conservados." });
});

api.MapPost("/entities/stock/retire-postgresql", async (ConfigStore store,
    SyncWorker worker, PostgresDestination destination, CancellationToken ct) =>
{
    var config = store.Read(c => c);
    if (config.Jobs.Where(j => config.Entities.Any(e => e.Id == j.EntityId && e.Name == "articulos"))
        .Any(j => worker.IsPending(j.Id)))
        return Results.Conflict(new { error = "Espera a que terminen las cargas de artículos antes de retirar la tabla stock." });
    await destination.RetireStockAsync(config.Destination, ct);
    return Results.Ok(new { ok = true,
        message = "Tabla farmetrica.stock retirada tras comprobar que todos sus registros y valores están en farmetrica.articulos." });
});

// Acción independiente y explícita: añade campos del contrato y DROP solo
// de descuento_recepcion, sin CASCADE y sin borrar registros de compras.
api.MapPost("/entities/compras/migrate-postgresql", async (ConfigStore store,
    SyncWorker worker, PostgresDestination destination, CancellationToken ct) =>
{
    var config = store.Read(c => c);
    var entity = config.Entities.FirstOrDefault(e => e.Name == "compras")
        ?? throw new ArgumentException("No existe la entidad compras.");
    if (config.Jobs.Where(j => j.EntityId == entity.Id).Any(j => worker.IsPending(j.Id)))
        return Results.Conflict(new { error = "Hay una carga de compras en ejecución o en cola. Espera a que termine." });
    await destination.ApplyPurchasesSchemaAsync(config.Destination, entity, ct);
    // Persistir la migración lógica tras confirmar la migración de PostgreSQL.
    store.Change(c => c.Entities.Single(e => e.Name == "compras").Columns
        .RemoveAll(col => col.Name == "descuento_recepcion"));
    return Results.Ok(new { ok = true, message = "Tabla compras actualizada en PostgreSQL: campos comunes añadidos y descuento_recepcion eliminado. Filas existentes conservadas." });
});

api.MapPost("/jobs/compras/retry-failed", (ConfigStore store, SyncWorker worker) =>
{
    var c = store.Read(x => x);
    var jobs = c.Jobs.Where(j => j.Enabled && IsFarmaticPurchases(c, j) &&
        c.Pharmacies.Any(p => p.Id == j.PharmacyId && p.Enabled) &&
        c.States.Any(s => s.JobId == j.Id && s.LastStatus == "error")).ToList();
    int queued = 0;
    foreach (var job in jobs)
    {
        var state = c.States.First(s => s.JobId == job.Id);
        bool needsFull = job.Mode == "incremental" && !string.IsNullOrWhiteSpace(job.FullSql)
            && state.LastFullSuccessUtc is null;
        if (worker.Enqueue(job.Id, full: needsFull)) queued++;
    }
    return Results.Ok(new { queued, message = $"{queued} ejecuciones fallidas añadidas a la cola. Si faltaba la carga inicial, se hará completa." });
});

// Alta segura de un origen de familias por farmacia Farmatic existente.
// Los trabajos se crean desactivados para que el usuario pruebe el SELECT y
// decida cuándo iniciar la primera carga. Repetir la acción no duplica trabajos.
api.MapPost("/jobs/familias/create-missing", (ConfigStore store) =>
{
    int created = 0, pharmacies = 0;
    store.Change(c =>
    {
        var family = c.Entities.SingleOrDefault(e => e.Name == "familias")
            ?? throw new InvalidOperationException("No existe la entidad familias.");
        var template = SqlTemplates.All.Single(t => t.SystemType == "farmatic" && t.Entity == "familias");
        foreach (var pharmacy in c.Pharmacies.Where(p => p.SystemType == "farmatic"))
        {
            pharmacies++;
            if (c.Jobs.Any(j => j.PharmacyId == pharmacy.Id && j.EntityId == family.Id))
                continue;
            var job = new SyncJob
            {
                PharmacyId = pharmacy.Id, EntityId = family.Id,
                Mode = "snapshot", Sql = template.FullSql, FullSql = template.FullSql,
                EveryMinutes = template.SuggestedEveryMinutes,
                BatchSize = 1000, Enabled = false
            };
            Validation.Query(job);
            c.Jobs.Add(job);
            created++;
        }
    });
    return Results.Ok(new { created, pharmacies,
        message = $"Creadas {created} consultas de familias desactivadas entre {pharmacies} farmacias. Comprueba la vista previa y activa las que quieras sincronizar." });
});

// Catálogo de vendedores por farmacia. Sin fechas técnicas en Farmatic,
// por lo que solamente se crea fotografía completa (desactivada inicialmente).
// IDVENDEDOR se identifica dentro de farmacia, nunca por NOMBRE.
api.MapPost("/jobs/vendedores/create-missing", (ConfigStore store) =>
{
    int created = 0, pharmacies = 0;
    store.Change(c =>
    {
        var sellers = c.Entities.SingleOrDefault(e => e.Name == "vendedores")
            ?? throw new InvalidOperationException("No existe la entidad vendedores.");
        var template = SqlTemplates.All.Single(t => t.SystemType == "farmatic" && t.Entity == "vendedores");
        foreach (var pharmacy in c.Pharmacies.Where(p =>
                     p.SystemType.Equals("farmatic", StringComparison.OrdinalIgnoreCase)))
        {
            pharmacies++;
            if (c.Jobs.Any(j => j.PharmacyId == pharmacy.Id && j.EntityId == sellers.Id))
                continue;
            var job = new SyncJob
            {
                PharmacyId = pharmacy.Id, EntityId = sellers.Id,
                Mode = "snapshot", Sql = template.FullSql, FullSql = template.FullSql,
                EveryMinutes = template.SuggestedEveryMinutes,
                BatchSize = 1000, Enabled = false
            };
            Validation.Query(job);
            c.Jobs.Add(job);
            created++;
        }
    });
    return Results.Ok(new { created, pharmacies,
        message = $"Preparadas {created} fuentes de vendedores desactivadas entre {pharmacies} farmacias. Previsualiza y activa las correctas." });
});

api.MapPost("/jobs", (JobRequest r, ConfigStore store) =>
{
    Guid createdId = Guid.Empty;
    store.Change(c =>
    {
        var job = ApplyJob(new SyncJob(), r, c);
        ValidateRefs(c, job);
        c.Jobs.Add(job);
        createdId = job.Id;
    });
    return Results.Ok(new { id = createdId, note = "Consulta guardada. Para ventas y recepciones incrementales valida primero la carga completa." });
});
api.MapPut("/jobs/{id:guid}", (Guid id, JobRequest r, ConfigStore store) =>
{
    store.Change(c =>
    {
        var job = c.Jobs.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Consulta no encontrada.");
        if (job.PharmacyId != r.PharmacyId || job.EntityId != r.EntityId || job.Mode != r.Mode)
            throw new ArgumentException("No se puede cambiar farmacia, entidad o modo de una consulta con estado. Crea una nueva consulta.");
        ApplyJob(job, r, c);
        ValidateRefs(c, job);
    });
    return Results.Ok(new { ok = true });
});
api.MapDelete("/jobs/{id:guid}", (Guid id, ConfigStore store) =>
{
    store.Change(c => { c.Jobs.RemoveAll(j => j.Id == id); c.States.RemoveAll(s => s.JobId == id); });
    return Results.Ok(new { ok = true });
});
api.MapPost("/jobs/{id:guid}/run-full", (Guid id, ConfigStore store, SyncWorker worker) =>
{
    var job = store.Read(c => c.Jobs.FirstOrDefault(j => j.Id == id));
    if (job is null || !job.Enabled)
        return Results.BadRequest(new { error = "Activa primero la consulta." });
    var query = job.Mode == "snapshot" ? job.Sql : job.FullSql;
    if (string.IsNullOrWhiteSpace(query))
        return Results.BadRequest(new { error = "Define primero la consulta de carga completa." });
    Validation.ValidateSelect(query, false);
    return Results.Accepted(value: new { queued = worker.Enqueue(id, full: true) });
});
api.MapPost("/jobs/{id:guid}/run", (Guid id, ConfigStore store, SyncWorker worker) =>
{
    var ready = store.Read(c =>
    {
        var j = c.Jobs.FirstOrDefault(x => x.Id == id && x.Enabled);
        if (j is null) return (exists: false, initialDone: false);
        var done = j.Mode != "incremental" || string.IsNullOrWhiteSpace(j.FullSql)
            || c.States.Any(s => s.JobId == id && s.LastFullSuccessUtc is not null);
        return (exists: true, initialDone: done);
    });
    if (!ready.exists) return Results.BadRequest(new { error = "Activa primero la consulta." });
    if (!ready.initialDone) return Results.BadRequest(new { error = "Ejecuta primero la carga completa inicial." });
    return Results.Accepted(value: new { queued = worker.Enqueue(id) });
});

// Recarga de pestañas con URL propia sin perder la sección activa.
app.MapFallbackToFile("index.html");
app.Run();
