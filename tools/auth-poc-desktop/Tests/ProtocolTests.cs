using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Xunit;

namespace AuthPoc.Desktop.Tests;

public sealed class ProtocolTests
{
    private static readonly AuthConfiguration Config = new("https://fixture.clerk.accounts.dev", "client_fixture");
    private static readonly Uri Redirect = new("http://127.0.0.1:54321/callback");
    private static readonly DateTimeOffset Now = new(2026, 9, 22, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("http://fixture.clerk.accounts.dev")]
    [InlineData("https://clerk.accounts.dev.attacker.example")]
    [InlineData("https://fixture.clerk.accounts.dev/path")]
    [InlineData("https://fixture.clerk.accounts.dev?query=value")]
    [InlineData("https://user@fixture.clerk.accounts.dev")]
    [InlineData("https://fixture.clerk.accounts.dev:444")]
    public void RejectsNonTestOrAmbiguousIssuers(string issuer) =>
        Assert.Throws<AuthenticationDenied>(() => new AuthConfiguration(issuer, "client_fixture"));

    [Fact]
    public void UsesRfc7636S256VectorAndFreshIndependentState()
    {
        Assert.Equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            PkceAttempt.ChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
        var first = new PkceAttempt();
        var second = new PkceAttempt();
        Assert.Equal(43, first.Verifier.Length);
        Assert.NotEqual(first.Verifier, first.State);
        Assert.NotEqual(first.Verifier, second.Verifier);
        Assert.NotEqual(first.State, second.State);
    }

    [Fact]
    public void BrowserUrlContainsOnlyChallengeAndStateNeverVerifierOrToken()
    {
        using var http = new HttpClient(new StubHandler(_ => throw new InvalidOperationException()));
        var adapter = new ClerkDesktopAdapter(Config, http, TimeProvider.System);
        var attempt = new PkceAttempt();
        var url = adapter.Authorize(attempt, Redirect);
        var query = QueryHelpers.ParseQuery(url.Query);
        Assert.Equal(Config.Issuer + "/oauth/authorize", url.GetLeftPart(UriPartial.Path));
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.Equal(attempt.Challenge, query["code_challenge"]);
        Assert.Equal(attempt.State, query["state"]);
        Assert.Equal("email offline_access", query["scope"]);
        Assert.Equal(Redirect.AbsoluteUri, query["redirect_uri"]);
        Assert.DoesNotContain(attempt.Verifier, url.AbsoluteUri);
        Assert.False(query.ContainsKey("access_token"));
        Assert.False(query.ContainsKey("client_secret"));
    }

    [Fact]
    public async Task ExchangeSendsVerifierAndCodeInPostBodyAndParsesOnlyNeededFields()
    {
        var attempt = new PkceAttempt();
        using var http = new HttpClient(new StubHandler(async request =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal(Config.Issuer + "/oauth/token", request.RequestUri!.AbsoluteUri);
            Assert.Null(request.Headers.Authorization);
            var body = QueryHelpers.ParseQuery(await request.Content!.ReadAsStringAsync());
            Assert.Equal(attempt.Verifier, body["code_verifier"]);
            Assert.Equal("private-code", body["code"]);
            Assert.Equal(Config.ClientId, body["client_id"]);
            Assert.Equal(Redirect.AbsoluteUri, body["redirect_uri"]);
            Assert.False(body.ContainsKey("client_secret"));
            return TokenResponse();
        }));
        var token = await new ClerkDesktopAdapter(Config, http, new FixedClock()).ExchangeAsync(
            "private-code", attempt.Verifier, Redirect, CancellationToken.None);
        Assert.Equal(Now.AddSeconds(3600), token.ExpiresAt);
        Assert.Equal("opaque-access", token.AccessToken);
        Assert.DoesNotContain("opaque-access", token.ToString());
    }

    [Theory]
    [InlineData("access_token", null)]
    [InlineData("access_token", "jwt.with.dots")]
    [InlineData("access_token", "invalid\r\ntoken")]
    [InlineData("token_type", "MAC")]
    [InlineData("refresh_token", null)]
    [InlineData("scope", "profile")]
    [InlineData("expires_in", "3600")]
    [InlineData("expires_in", -1)]
    [InlineData("expires_in", 0)]
    [InlineData("expires_in", long.MaxValue)]
    public async Task RejectsDamagedTokenResponses(string field, object? value)
    {
        using var http = new HttpClient(new StubHandler(_ => Task.FromResult(TokenResponse(field, value))));
        var adapter = new ClerkDesktopAdapter(Config, http, new FixedClock());
        await Assert.ThrowsAnyAsync<Exception>(() => adapter.ExchangeAsync("code", "verifier", Redirect, CancellationToken.None));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task RefreshSupportsRotatedOrOmittedRefreshToken(bool rotates)
    {
        using var http = new HttpClient(new StubHandler(async request =>
        {
            var body = QueryHelpers.ParseQuery(await request.Content!.ReadAsStringAsync());
            Assert.Equal("refresh_token", body["grant_type"]);
            Assert.Equal("previous-refresh", body["refresh_token"]);
            Assert.False(body.ContainsKey("code_verifier"));
            return TokenResponse(omitRefresh: !rotates);
        }));
        var token = await new ClerkDesktopAdapter(Config, http, new FixedClock()).RefreshAsync(Credential(), CancellationToken.None);
        Assert.Equal(rotates ? "opaque-refresh" : "previous-refresh", token.RefreshToken);
    }

    [Fact]
    public async Task DistinguishesConfirmedInvalidGrantWithoutDisclosingProviderDescription()
    {
        using var http = new HttpClient(new StubHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("{\"error\":\"invalid_grant\",\"error_description\":\"private-provider-data\"}")
        })));
        var adapter = new ClerkDesktopAdapter(Config, http, new FixedClock());
        var error = await Assert.ThrowsAsync<CredentialRejected>(() => adapter.RefreshAsync(Credential(), CancellationToken.None));
        Assert.DoesNotContain("private-provider-data", error.ToString());
    }

    [Fact]
    public async Task RevokePostsBothCredentialsWithoutSecretOrQueryString()
    {
        var hints = new List<string>();
        using var http = new HttpClient(new StubHandler(async request =>
        {
            Assert.Equal(Config.Issuer + "/oauth/token/revoke", request.RequestUri!.AbsoluteUri);
            Assert.Null(request.Headers.Authorization);
            var body = QueryHelpers.ParseQuery(await request.Content!.ReadAsStringAsync());
            Assert.Equal(3, body.Count);
            Assert.Equal(Config.ClientId, body["client_id"]);
            hints.Add(body["token_type_hint"].ToString());
            Assert.Equal(hints.Count == 1 ? "previous-refresh" : "opaque-access", body["token"]);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }));
        await new ClerkDesktopAdapter(Config, http, new FixedClock()).RevokeAsync(Credential(), CancellationToken.None);
        Assert.Equal(["refresh_token", "access_token"], hints);
    }

    [Fact]
    public async Task DoesNotTreatRevocationFailureAsSuccessfulLogout()
    {
        using var http = new HttpClient(new StubHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized))));
        await Assert.ThrowsAsync<RevocationDenied>(() => new ClerkDesktopAdapter(Config, http, new FixedClock())
            .RevokeAsync(Credential(), CancellationToken.None));
    }

    [Fact]
    public async Task SendsEvenExpiredAccessCredentialOnlyInWorkerAuthorizationHeader()
    {
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal(AuthConfiguration.CheckEndpoint, request.RequestUri);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal("opaque-access", request.Headers.Authorization?.Parameter);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
        }));
        Assert.False(await new ClerkDesktopAdapter(Config, http, new FixedClock()).CheckAsync(Credential(), CancellationToken.None));
    }

    [Theory]
    [InlineData("invalid_request", "invalid_request")]
    [InlineData("private-provider-value", "unclassified")]
    public async Task RevocationDiagnosticsExposeOnlyStatusAndAllowlistedError(string providerCode, string expectedCode)
    {
        using var http = new HttpClient(new StubHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { error = providerCode, error_description = "private-description" }))
        })));
        var error = await Assert.ThrowsAsync<RevocationDenied>(() => new ClerkDesktopAdapter(Config, http, new FixedClock())
            .RevokeAsync(Credential(), CancellationToken.None));
        Assert.Equal(400, error.Status);
        Assert.Equal(expectedCode, error.Code);
        Assert.DoesNotContain("private-", error.ToString());
    }

    private static DesktopCredential Credential() => new()
    {
        AccessToken = "opaque-access",
        RefreshToken = "previous-refresh",
        ExpiresAt = Now.AddSeconds(-1)
    };

    private static HttpResponseMessage TokenResponse(string? field = null, object? value = null, bool omitRefresh = false)
    {
        var fields = new Dictionary<string, object?>
        {
            ["access_token"] = "opaque-access",
            ["refresh_token"] = "opaque-refresh",
            ["token_type"] = "Bearer",
            ["expires_in"] = 3600,
            ["scope"] = "email offline_access",
            ["unused_provider_field"] = new { arbitrary = true }
        };
        if (field is not null) fields[field] = value;
        if (omitRefresh) fields.Remove("refresh_token");
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(fields)) };
    }

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => respond(request);
    }
}
