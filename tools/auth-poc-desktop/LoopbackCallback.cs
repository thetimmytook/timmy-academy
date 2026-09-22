using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.Logging;

namespace AuthPoc.Desktop;

internal sealed class LoopbackCallback : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly TaskCompletionSource<string> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int consumed;
    public Uri RedirectUri { get; private set; } = null!;

    private LoopbackCallback(WebApplication app) => this.app = app;

    public static async Task<LoopbackCallback> StartAsync(PkceAttempt attempt, string issuer, CancellationToken cancellation)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [] });
        // Callback URLs contain authorization codes. No hosting/request logging providers.
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server =>
        {
            server.AddServerHeader = false;
            server.Limits.MaxRequestLineSize = 8192;
            server.Limits.MaxRequestBodySize = 0;
            server.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            server.Listen(IPAddress.Loopback, 0, listen => listen.Protocols = HttpProtocols.Http1);
        });
        var app = builder.Build();
        var callback = new LoopbackCallback(app);
        app.Run(context => callback.HandleAsync(context, attempt, issuer));

        try
        {
            await app.StartAsync(cancellation);
            callback.RedirectUri = new Uri(app.Urls.Single() + "/callback");
            return callback;
        }
        catch
        {
            await app.DisposeAsync();
            throw;
        }
    }

    public Task<string> ReceiveAsync(CancellationToken cancellation) => completion.Task.WaitAsync(cancellation);

    private async Task HandleAsync(HttpContext context, PkceAttempt attempt, string issuer)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.ContentType = "text/plain; charset=utf-8";
        var request = context.Request;
        var query = request.Query;
        string[] allowed = ["state", "code", "error", "error_description", "error_uri", "iss"];

        if (request.Method != "GET" || request.Path != "/callback" ||
            request.Host.Value != RedirectUri.Authority ||
            query.Any(pair => pair.Value.Count != 1 || !allowed.Contains(pair.Key)) ||
            !attempt.MatchesState(query["state"].ToString()) ||
            (query.ContainsKey("iss") && query["iss"].ToString() != issuer) ||
            query.ContainsKey("code") == query.ContainsKey("error") ||
            (query.ContainsKey("code") && string.IsNullOrWhiteSpace(query["code"].ToString())))
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsync("Callback rejected.");
            return;
        }

        if (Interlocked.CompareExchange(ref consumed, 1, 0) != 0)
        {
            context.Response.StatusCode = 410;
            await context.Response.WriteAsync("Callback already used.");
            return;
        }

        await context.Response.WriteAsync("Return received. Close this tab and return to the desktop harness.");
        await context.Response.CompleteAsync();
        if (query.ContainsKey("error"))
        {
            completion.TrySetException(new AuthenticationDenied());
        }
        else
        {
            completion.TrySetResult(query["code"].ToString());
        }
    }

    public async ValueTask DisposeAsync()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await app.StopAsync(timeout.Token);
        await app.DisposeAsync();
    }
}
