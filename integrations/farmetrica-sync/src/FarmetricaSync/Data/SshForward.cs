using System.Net;
using System.Net.Sockets;
using FarmetricaSync.Core;
using FarmetricaSync.Security;
using Renci.SshNet;

namespace FarmetricaSync.Data;

/// <summary>
/// Un túnel por ejecución PostgreSQL. Abre SSH desde la cuenta del servicio Windows,
/// verifica la huella SHA256 fijada previamente por el administrador, y expone
/// únicamente una conexión local 127.0.0.1 a PostgreSQL.
/// </summary>
public sealed class SshForward(Secrets secrets)
{
    public sealed class Session(SshClient client, ForwardedPortLocal? port) : IDisposable
    {
        public int LocalPort => (int)(port?.BoundPort ?? 0);
        public void Dispose()
        {
            try { port?.Stop(); } catch { /* SSH can already be disconnected */ }
            port?.Dispose();
            client.Dispose();
        }
    }

    public static void Validate(Destination destination)
    {
        if (!destination.SshEnabled) return;
        if (string.IsNullOrWhiteSpace(destination.SshHost) ||
            string.IsNullOrWhiteSpace(destination.SshUsername) ||
            destination.SshPort is < 1 or > 65535)
            throw new ArgumentException("Completa servidor, puerto y usuario SSH.");
        if (destination.SshAuthMode is not ("password" or "privateKey"))
            throw new ArgumentException("Autenticación SSH no válida.");
        if (destination.SshAuthMode == "password" && string.IsNullOrWhiteSpace(destination.SshPasswordProtected))
            throw new ArgumentException("Indica la contraseña SSH.");
        if (destination.SshAuthMode == "privateKey" &&
            (string.IsNullOrWhiteSpace(destination.SshPrivateKeyPath) ||
             !File.Exists(destination.SshPrivateKeyPath)))
            throw new ArgumentException("La clave privada SSH no existe o no es accesible desde el servicio Windows.");
        var fingerprint = destination.SshHostKeySha256.Trim();
        if (fingerprint.StartsWith("SHA256:", StringComparison.OrdinalIgnoreCase))
            fingerprint = fingerprint[7..];
        // SSH.NET uses SHA256 as unpadded base64: 43 chars for 32 bytes.
        if (fingerprint.Length != 43 ||
            !System.Text.RegularExpressions.Regex.IsMatch(fingerprint, "^[A-Za-z0-9+/]{43}$"))
            throw new ArgumentException("Indica la huella SHA256 del servidor SSH (ej. SHA256:...); compruébala fuera de banda.");
        if (destination.SslMode == "Disable" && !destination.SshEnabled)
            throw new ArgumentException("No se puede desactivar SSL sin túnel SSH.");
    }

    private SshClient CreateClient(Destination destination)
    {
        Validate(destination);
        AuthenticationMethod authentication;
        if (destination.SshAuthMode == "privateKey")
        {
            var pass = secrets.Decrypt(destination.SshKeyPassphraseProtected);
            PrivateKeyFile key = string.IsNullOrEmpty(pass)
                ? new PrivateKeyFile(destination.SshPrivateKeyPath)
                : new PrivateKeyFile(destination.SshPrivateKeyPath, pass);
            authentication = new PrivateKeyAuthenticationMethod(destination.SshUsername, key);
        }
        else
        {
            authentication = new PasswordAuthenticationMethod(destination.SshUsername,
                secrets.Decrypt(destination.SshPasswordProtected));
        }

        var info = new Renci.SshNet.ConnectionInfo(destination.SshHost.Trim(), destination.SshPort,
            destination.SshUsername.Trim(), authentication) { Timeout = TimeSpan.FromSeconds(20) };
        var client = new SshClient(info) { KeepAliveInterval = TimeSpan.FromSeconds(20) };
        string expected = destination.SshHostKeySha256.Trim();
        if (expected.StartsWith("SHA256:", StringComparison.OrdinalIgnoreCase)) expected = expected[7..];
        client.HostKeyReceived += (_, evt) =>
        {
            // Fail closed: never silently accept first-use or mismatched keys.
            evt.CanTrust = string.Equals(expected, evt.FingerPrintSHA256, StringComparison.Ordinal);
        };
        return client;
    }

    public async Task TestSshAsync(Destination destination, CancellationToken ct)
    {
        using var client = CreateClient(destination);
        await client.ConnectAsync(ct);
        if (!client.IsConnected) throw new InvalidOperationException("El servidor SSH no ha aceptado la conexión.");
    }

    public async Task<Session> OpenAsync(Destination destination, CancellationToken ct)
    {
        var client = CreateClient(destination);
        ForwardedPortLocal? forward = null;
        try
        {
            await client.ConnectAsync(ct);
            if (!client.IsConnected) throw new InvalidOperationException("No se pudo establecer el túnel SSH.");

            // SSH.NET requires a concrete local port. Reserve a loopback port briefly
            // and retry collisions; never bind to all network interfaces.
            for (int attempt = 0; attempt < 8; attempt++)
            {
                var listener = new TcpListener(IPAddress.Loopback, 0);
                listener.Start();
                int available = ((IPEndPoint)listener.LocalEndpoint).Port;
                listener.Stop();
                forward = new ForwardedPortLocal("127.0.0.1", (uint)available,
                    destination.Host.Trim(), (uint)destination.Port);
                client.AddForwardedPort(forward);
                try
                {
                    forward.Start();
                    return new Session(client, forward);
                }
                catch (SocketException) when (attempt < 7)
                {
                    client.RemoveForwardedPort(forward);
                    forward.Dispose();
                    forward = null;
                }
            }
            throw new InvalidOperationException("No se pudo asignar un puerto local al túnel.");
        }
        catch
        {
            try { forward?.Dispose(); } catch { }
            client.Dispose();
            throw;
        }
    }
}
