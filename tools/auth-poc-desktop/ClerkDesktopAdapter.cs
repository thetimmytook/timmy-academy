using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace AuthPoc.Desktop;

internal interface IDesktopAuthAdapter
{
    Uri Authorize(PkceAttempt attempt, Uri redirect);
    Task<DesktopCredential> ExchangeAsync(string code, string verifier, Uri redirect, CancellationToken cancellation);
    Task<DesktopCredential> RefreshAsync(DesktopCredential credential, CancellationToken cancellation);
    Task RevokeAsync(DesktopCredential credential, CancellationToken cancellation);
    Task<bool> CheckAsync(DesktopCredential credential, CancellationToken cancellation);
}

internal sealed class ClerkDesktopAdapter(AuthConfiguration config, HttpClient http, TimeProvider clock) : IDesktopAuthAdapter
{
    public Uri Authorize(PkceAttempt attempt, Uri redirect)
    {
        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = config.ClientId,
            ["redirect_uri"] = redirect.AbsoluteUri,
            ["scope"] = "email offline_access",
            ["state"] = attempt.State,
            ["code_challenge"] = attempt.Challenge,
            ["code_challenge_method"] = "S256"
        };
        return new Uri(config.Issuer + "/oauth/authorize?" + string.Join('&', query.Select(
            pair => Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(pair.Value))));
    }

    public Task<DesktopCredential> ExchangeAsync(string code, string verifier, Uri redirect, CancellationToken cancellation) =>
        TokenAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["client_id"] = config.ClientId,
            ["code"] = code,
            ["code_verifier"] = verifier,
            ["redirect_uri"] = redirect.AbsoluteUri
        }, null, cancellation);

    public Task<DesktopCredential> RefreshAsync(DesktopCredential credential, CancellationToken cancellation) =>
        TokenAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["client_id"] = config.ClientId,
            ["refresh_token"] = credential.RefreshToken
        }, credential.RefreshToken, cancellation);

    private async Task<DesktopCredential> TokenAsync(Dictionary<string, string> fields, string? previousRefresh, CancellationToken cancellation)
    {
        // Base expiry on request start so network latency cannot extend the credential lifetime.
        var started = clock.GetUtcNow();
        using var response = await PostAsync("/oauth/token", fields, cancellation);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
        var root = json.RootElement;
        var access = JsonFields.Text(root, "access_token");
        if (!JsonFields.Text(root, "token_type").Equals("Bearer", StringComparison.OrdinalIgnoreCase) ||
            access.Length > 4096 || access.Contains('.') || access.Any(char.IsWhiteSpace) ||
            !root.TryGetProperty("expires_in", out var duration) || !duration.TryGetInt64(out var seconds) ||
            seconds <= 0 || seconds > (DateTimeOffset.MaxValue - started).TotalSeconds)
        {
            throw new AuthenticationDenied();
        }

        // RFC 6749 permits omission when the granted scope is unchanged.
        if (root.TryGetProperty("scope", out _) && !JsonFields.Text(root, "scope").Split(' ').Contains("email"))
        {
            throw new AuthenticationDenied();
        }

        var refresh = root.TryGetProperty("refresh_token", out _)
            ? JsonFields.Text(root, "refresh_token")
            : previousRefresh ?? throw new AuthenticationDenied();
        var expiresAt = started.AddSeconds(seconds);
        if (refresh.Length > 8192 || refresh.Any(char.IsWhiteSpace) || expiresAt <= clock.GetUtcNow())
        {
            throw new AuthenticationDenied();
        }

        return new DesktopCredential { AccessToken = access, RefreshToken = refresh, ExpiresAt = expiresAt };
    }

    public async Task RevokeAsync(DesktopCredential credential, CancellationToken cancellation)
    {
        // Identify the public client without a secret, as for token exchange/refresh.
        // Revoke both explicitly; acknowledgement alone does not prove invalidation.
        foreach (var (token, hint) in new[] { (credential.RefreshToken, "refresh_token"), (credential.AccessToken, "access_token") })
        {
            using var response = await PostAsync("/oauth/token/revoke", new Dictionary<string, string>
            {
                ["token"] = token,
                ["token_type_hint"] = hint,
                ["client_id"] = config.ClientId
            }, cancellation);
        }
    }

    public async Task<bool> CheckAsync(DesktopCredential credential, CancellationToken cancellation)
    {
        // Still send an expired token: the harness must verify server-side expiry denial.
        using var request = new HttpRequestMessage(HttpMethod.Get, AuthConfiguration.CheckEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential.AccessToken);
        using var response = await http.SendAsync(request, cancellation);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            return false;
        }

        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new AuthenticationDenied();
        }

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
        return JsonFields.Text(json.RootElement, "status") == "verified";
    }

    private async Task<HttpResponseMessage> PostAsync(string path, Dictionary<string, string> fields, CancellationToken cancellation)
    {
        using var content = new FormUrlEncodedContent(fields);
        var response = await http.PostAsync(config.Issuer + path, content, cancellation);
        if (response.StatusCode != HttpStatusCode.OK)
        {
            using (response)
            {
                if (path == "/oauth/token/revoke")
                {
                    var code = "unclassified";
                    try
                    {
                        using var error = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
                        var candidate = JsonFields.Text(error.RootElement, "error");
                        if (candidate is "invalid_client" or "invalid_request" or "unsupported_token_type" or "unauthorized_client" or "invalid_grant")
                        {
                            code = candidate;
                        }
                    }
                    catch (Exception exception) when (exception is JsonException or AuthenticationDenied)
                    {
                        // Never expose the provider body or arbitrary error text.
                    }

                    throw new RevocationDenied((int)response.StatusCode, code);
                }

                // Distinguish a confirmed invalid grant from a timeout/outage without echoing details.
                if (path == "/oauth/token" && response.StatusCode == HttpStatusCode.BadRequest)
                {
                    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
                    if (JsonFields.Text(json.RootElement, "error") == "invalid_grant")
                    {
                        throw new CredentialRejected();
                    }
                }
            }

            throw new AuthenticationDenied();
        }

        return response;
    }
}
