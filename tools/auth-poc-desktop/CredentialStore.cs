using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AuthPoc.Desktop;

// Class, not record: never generate a ToString() that prints credential values.
internal sealed class DesktopCredential
{
    public required string AccessToken { get; init; }
    public required string RefreshToken { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
}

internal sealed class CredentialStore
{
    private readonly string file;
    private readonly byte[] entropy;

    public CredentialStore(AuthConfiguration config, string directory)
    {
        Directory.CreateDirectory(directory);
        entropy = SHA256.HashData(Encoding.UTF8.GetBytes(config.Issuer + "\n" + config.ClientId));
        file = Path.Combine(directory, Convert.ToHexString(entropy) + ".credential");
    }

    public FileStream AcquireLease() => new(file + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);

    public DesktopCredential? Load()
    {
        if (!File.Exists(file))
        {
            return null;
        }

        var plaintext = ProtectedData.Unprotect(File.ReadAllBytes(file), entropy, DataProtectionScope.CurrentUser);
        try
        {
            return JsonSerializer.Deserialize<DesktopCredential>(plaintext) ?? throw new AuthenticationDenied();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    public void Save(DesktopCredential credential)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(credential);
        var temporary = file + ".tmp";
        try
        {
            var encrypted = ProtectedData.Protect(plaintext, entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(temporary, encrypted);
            File.Move(temporary, file, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            File.Delete(temporary);
        }
    }

    public void Clear() => File.Delete(file);
}
