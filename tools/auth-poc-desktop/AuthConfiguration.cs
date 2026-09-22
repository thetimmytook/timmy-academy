using System.Text.Json;

namespace AuthPoc.Desktop;

internal sealed class AuthConfiguration
{
    public string Issuer { get; }
    public string ClientId { get; }
    public static Uri CheckEndpoint { get; } = new("http://127.0.0.1:8790/api/auth/v1/poc/check");

    public AuthConfiguration(string issuer, string clientId)
    {
        if (!Uri.TryCreate(issuer, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || !uri.Host.EndsWith(".clerk.accounts.dev", StringComparison.Ordinal) ||
            uri.GetLeftPart(UriPartial.Authority) != issuer || uri.UserInfo.Length != 0 ||
            !uri.IsDefaultPort || string.IsNullOrWhiteSpace(clientId) || clientId == "REPLACE" || clientId.Length > 256)
        {
            throw new AuthenticationDenied();
        }

        Issuer = issuer;
        ClientId = clientId;
    }

    public static AuthConfiguration Read(string path)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(path));
        return new AuthConfiguration(JsonFields.Text(json.RootElement, "issuer"),
            JsonFields.Text(json.RootElement, "clientId"));
    }
}

internal sealed class AuthenticationDenied : Exception
{
    public AuthenticationDenied() : base("Authentication operation failed.") { }
}

internal sealed class CredentialRejected : Exception
{
    public CredentialRejected() : base("Provider rejected the credential or authorization code.") { }
}

internal sealed class RevocationDenied(int status, string code) : Exception("Remote revocation was not acknowledged.")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

internal static class JsonFields
{
    public static string Text(JsonElement json, string name)
    {
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty(name, out var value) ||
            value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new AuthenticationDenied();
        }

        return value.GetString()!;
    }
}
