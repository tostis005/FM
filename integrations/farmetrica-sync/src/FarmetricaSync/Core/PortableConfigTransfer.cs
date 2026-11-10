using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FarmetricaSync.Core;

/// <summary>
/// Exportación portable de la configuración. Nunca guarda secretos descifrados
/// en disco: el JSON con credenciales solo existe en memoria durante el cifrado.
/// Las claves DPAPI de Windows y la contraseña del panel NO se trasladan.
/// </summary>
public static class PortableConfigTransfer
{
    private const int Iterations = 350_000;
    private const int MaxBytes = 16 * 1024 * 1024;
    private const int SaltSize = 16;
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("FMSYNC01");
    private static readonly JsonSerializerOptions Json = new() {
        PropertyNameCaseInsensitive = true
    };

    private sealed record PortablePayload(int Version, DateTimeOffset CreatedUtc, AppConfig Config);

    public static byte[] Export(AppConfig source, string password, Func<string, string> unprotect)
    {
        CheckPassword(password);
        var backup = Clone(source);
        UnusedAmpSource.Remove(backup);
        backup.AdminHash = null;
        backup.AdminSalt = null;
        backup.MonitorInstanceId = Guid.Empty;
        backup.Runs = []; // Auditoría histórica permanece en el equipo antiguo.
        TransformSecrets(backup, unprotect);
        byte[] plain = JsonSerializer.SerializeToUtf8Bytes(
            new PortablePayload(1, DateTimeOffset.UtcNow, backup), Json);
        try
        {
            if (plain.Length > MaxBytes - 128)
                throw new ArgumentException("La configuración supera el límite de copia (16 MB).");
            byte[] salt = RandomNumberGenerator.GetBytes(SaltSize);
            byte[] nonce = RandomNumberGenerator.GetBytes(NonceSize);
            byte[] tag = new byte[TagSize];
            byte[] cipher = new byte[plain.Length];
            byte[] key = Rfc2898DeriveBytes.Pbkdf2(
                password, salt, Iterations, HashAlgorithmName.SHA256, 32);
            try
            {
                using var aes = new AesGcm(key, TagSize);
                // Autenticar también la cabecera de formato.
                aes.Encrypt(nonce, plain, cipher, tag, Magic);
                byte[] file = new byte[Magic.Length + SaltSize + NonceSize + TagSize + cipher.Length];
                int offset = 0;
                Copy(Magic); Copy(salt); Copy(nonce); Copy(tag); Copy(cipher);
                return file;
                void Copy(byte[] src) { Buffer.BlockCopy(src, 0, file, offset, src.Length); offset += src.Length; }
            }
            finally { CryptographicOperations.ZeroMemory(key); }
        }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }

    public static AppConfig Import(byte[] file, string password, Func<string, string> protect)
    {
        CheckPassword(password);
        if (file.Length < Magic.Length + SaltSize + NonceSize + TagSize + 2 ||
            file.Length > MaxBytes || !file.AsSpan(0, Magic.Length).SequenceEqual(Magic))
            throw new ArgumentException("El fichero no es una copia portable válida de Farmétrica Sync.");
        int offset = Magic.Length;
        var salt = file.AsSpan(offset, SaltSize); offset += SaltSize;
        var nonce = file.AsSpan(offset, NonceSize); offset += NonceSize;
        var tag = file.AsSpan(offset, TagSize); offset += TagSize;
        var cipher = file.AsSpan(offset);
        byte[] plain = new byte[cipher.Length];
        byte[] key = Rfc2898DeriveBytes.Pbkdf2(
            password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        try
        {
            try
            {
                using var aes = new AesGcm(key, TagSize);
                aes.Decrypt(nonce, cipher, tag, plain, Magic);
            }
            catch (CryptographicException)
            {
                throw new ArgumentException("Contraseña de traslado incorrecta o fichero dañado.");
            }
            PortablePayload? payload;
            try { payload = JsonSerializer.Deserialize<PortablePayload>(plain, Json); }
            catch (JsonException) { throw new ArgumentException("La copia tiene datos inválidos."); }
            if (payload is null || payload.Version != 1 || payload.Config is null)
                throw new ArgumentException("Versión o contenido de copia no compatible.");
            Validate(payload.Config);
            TransformSecrets(payload.Config, protect);
            return payload.Config;
        }
        finally {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    /// <summary>
    /// Sustitución íntegra y atómica vía ConfigStore.Change. Conserva credenciales
    /// del administrador local; los cursores de sincronización sí se trasladan.
    /// </summary>
    public static void RestoreInto(AppConfig current, AppConfig incoming)
    {
        Validate(incoming);
        current.Destination = incoming.Destination;
        current.Mail = incoming.Mail;
        current.Pharmacies = incoming.Pharmacies;
        current.Entities = incoming.Entities;
        current.Jobs = incoming.Jobs;
        current.States = incoming.States;
        current.Runs = [];
        current.MonitorInstanceId = Guid.NewGuid();
        UnusedAmpSource.Remove(current);
        SynonymJobs.EnsureForFarmatic(current);
        WarehouseSource.EnsureFromAvadia(current);
        foreach (var state in current.States)
        {
            // No reanudar sesiones activas de otro servidor ni repetir errores,
            // pero conservar marcas confirmadas para una continuidad idempotente.
            state.LastStatus = "pending";
            state.LastAttemptUtc = null;
            state.LastCompletedUtc = null;
            state.LastAlertUtc = null;
            state.LastError = "";
        }
    }

    private static void TransformSecrets(AppConfig config, Func<string, string> transform)
    {
        static string Convert(string cipher, Func<string,string> action) =>
            string.IsNullOrEmpty(cipher) ? "" : action(cipher);
        config.Destination.PasswordProtected = Convert(config.Destination.PasswordProtected, transform);
        config.Destination.SshPasswordProtected = Convert(config.Destination.SshPasswordProtected, transform);
        config.Destination.SshKeyPassphraseProtected = Convert(config.Destination.SshKeyPassphraseProtected, transform);
        config.Mail.PasswordProtected = Convert(config.Mail.PasswordProtected, transform);
        foreach (var p in config.Pharmacies)
            p.PasswordProtected = Convert(p.PasswordProtected, transform);
    }

    private static AppConfig Clone(AppConfig config) =>
        JsonSerializer.Deserialize<AppConfig>(JsonSerializer.Serialize(config, Json), Json)
        ?? throw new ArgumentException("No se puede copiar la configuración.");

    private static void CheckPassword(string? value)
    {
        if (value is null || value.Length is < 12 or > 256)
            throw new ArgumentException("La contraseña de traslado debe tener entre 12 y 256 caracteres.");
    }

    private static void Validate(AppConfig c)
    {
        if (c.Pharmacies is null || c.Entities is null || c.Jobs is null || c.States is null ||
            c.Destination is null || c.Mail is null ||
            c.Pharmacies.Count > 500 || c.Entities.Count > 150 ||
            c.Jobs.Count > 20_000 || c.States.Count > 20_000)
            throw new ArgumentException("La copia contiene una configuración incompatible.");
        if (c.Pharmacies.Any(p => p is null || p.Id == Guid.Empty ||
                string.IsNullOrWhiteSpace(p.Code) || p.Code.Length > 16) ||
            c.Pharmacies.GroupBy(p => p.Id).Any(g => g.Count() > 1) ||
            c.Pharmacies.GroupBy(p => p.Code.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1) ||
            c.Entities.Any(e => e is null || e.Id == Guid.Empty || string.IsNullOrWhiteSpace(e.Name)) ||
            c.Entities.GroupBy(e => e.Id).Any(g => g.Count() > 1) ||
            c.Jobs.Any(j => j is null || j.Id == Guid.Empty ||
                !c.Pharmacies.Any(p => p.Id == j.PharmacyId) ||
                !c.Entities.Any(e => e.Id == j.EntityId)) ||
            c.Jobs.GroupBy(j => j.Id).Any(g => g.Count() > 1) ||
            c.States.Any(s => s is null || !c.Jobs.Any(j => j.Id == s.JobId)) ||
            c.States.GroupBy(s => s.JobId).Any(g => g.Count() > 1))
            throw new ArgumentException("La copia contiene orígenes, entidades o consultas con referencias inválidas.");
    }
}
