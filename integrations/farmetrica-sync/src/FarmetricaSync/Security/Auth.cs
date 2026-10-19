using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;

namespace FarmetricaSync.Security;

public static class Passwords
{
    private const int Iterations = 250_000;
    public static (string Salt, string Hash) Create(string password)
    {
        byte[] salt = RandomNumberGenerator.GetBytes(32);
        byte[] hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return (Convert.ToBase64String(salt), Convert.ToBase64String(hash));
    }

    public static bool Verify(string password, string? saltBase64, string? hashBase64)
    {
        if (string.IsNullOrEmpty(saltBase64) || string.IsNullOrEmpty(hashBase64)) return false;
        try
        {
            byte[] salt = Convert.FromBase64String(saltBase64);
            byte[] expected = Convert.FromBase64String(hashBase64);
            byte[] actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }
}

public sealed class Secrets(IDataProtectionProvider provider)
{
    private readonly IDataProtector _p = provider.CreateProtector("FarmetricaSync.Secrets.v1");
    public string Encrypt(string plain) => _p.Protect(plain);
    public string Decrypt(string cipher) => string.IsNullOrEmpty(cipher) ? "" : _p.Unprotect(cipher);
}
