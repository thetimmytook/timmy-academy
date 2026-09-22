using System.Diagnostics;

namespace AuthPoc.Desktop;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length != 1 || !OperatingSystem.IsWindows())
        {
            Console.WriteLine("Windows only. Supply the local desktop configuration file path.");
            return 1;
        }

        try
        {
            var config = AuthConfiguration.Read(args[0]);
            var store = new CredentialStore(config, Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TimmyAcademy", "AuthPoc"));
            using var lease = store.AcquireLease();
            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
            {
                Timeout = TimeSpan.FromSeconds(15),
                MaxResponseContentBufferSize = 65536
            };
            IDesktopAuthAdapter adapter = new ClerkDesktopAdapter(config, http, TimeProvider.System);
            await RunAsync(adapter, store, config.Issuer);
            return 0;
        }
        catch
        {
            Console.WriteLine("Harness unavailable. Check local configuration, secure storage and other running instances.");
            return 1;
        }
    }

    private static async Task RunAsync(IDesktopAuthAdapter adapter, CredentialStore store, string issuer)
    {
        Console.WriteLine("Local auth PoC. No benchmark data is read or published.");
        Console.WriteLine("login | probe-pkce | probe-replay | status | check | refresh | revoke | logout | forget | quit");
        while (true)
        {
            Console.Write("> ");
            var command = Console.ReadLine()?.Trim().ToLowerInvariant();
            if (command is null or "quit")
            {
                return;
            }

            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
            try
            {
                await ExecuteAsync(command, adapter, store, issuer, timeout.Token);
            }
            catch (CredentialRejected)
            {
                Console.WriteLine("Provider rejected the credential or authorization code (invalid_grant).");
            }
            catch (RevocationDenied denied)
            {
                Console.WriteLine($"Revocation not acknowledged: HTTP {denied.Status}, {denied.Code}. Local credential was not cleared.");
            }
            catch
            {
                // No provider body, request URL, exception, identity or credential is logged.
                Console.WriteLine("Operation failed or timed out. Remote state is unconfirmed; stored credentials were retained if available.");
            }
        }
    }

    internal static async Task ExecuteAsync(string command, IDesktopAuthAdapter adapter, CredentialStore store, string issuer, CancellationToken cancellation)
    {
        var credential = store.Load();
        switch (command)
        {
            case "login":
            case "probe-pkce":
            case "probe-replay":
                if (credential is not null)
                {
                    Console.WriteLine("A credential already exists. Log out before starting a new grant.");
                    return;
                }

                await LoginAsync(command, adapter, store, issuer, cancellation);
                break;
            case "status":
                Console.WriteLine(credential is null ? "No desktop credential." :
                    credential.ExpiresAt <= DateTimeOffset.UtcNow ? "Desktop access credential expired." : "Desktop access credential has not expired locally.");
                break;
            case "check" when credential is not null:
                Console.WriteLine(await adapter.CheckAsync(credential, cancellation) ? "Worker: verified." : "Worker: denied.");
                break;
            case "refresh" when credential is not null:
                await SaveOrRevokeAsync(await adapter.RefreshAsync(credential, cancellation), adapter, store, cancellation);
                Console.WriteLine("Refreshed credential stored securely.");
                break;
            case "revoke" when credential is not null:
                await adapter.RevokeAsync(credential, cancellation);
                Console.WriteLine("Revocation acknowledged. Credential retained for negative check/refresh tests; this is not local logout.");
                break;
            case "logout" when credential is not null:
                await adapter.RevokeAsync(credential, cancellation);
                store.Clear();
                Console.WriteLine("Revocation acknowledged; local desktop credential removed. Check browser session separately.");
                break;
            case "forget":
                Console.WriteLine("Local removal does not revoke the remote grant. Type FORGET to remove the stored credential.");
                if (Console.ReadLine() == "FORGET")
                {
                    store.Clear();
                    Console.WriteLine("Local credential removed; remote grant unchanged.");
                }
                break;
            default:
                Console.WriteLine("Unknown command or no stored desktop credential.");
                break;
        }
    }

    private static async Task LoginAsync(string mode, IDesktopAuthAdapter adapter, CredentialStore store, string issuer, CancellationToken cancellation)
    {
        var attempt = new PkceAttempt();
        await using var callback = await LoopbackCallback.StartAsync(attempt, issuer, cancellation);
        // Explicit system-browser launch is the only interactive external process.
        using var browser = Process.Start(new ProcessStartInfo(adapter.Authorize(attempt, callback.RedirectUri).AbsoluteUri)
        {
            UseShellExecute = true
        });
        var code = await callback.ReceiveAsync(cancellation);
        var verifier = mode == "probe-pkce" ? new PkceAttempt().Verifier : attempt.Verifier;
        DesktopCredential received;
        try
        {
            received = await adapter.ExchangeAsync(code, verifier, callback.RedirectUri, cancellation);
        }
        catch (CredentialRejected) when (mode == "probe-pkce")
        {
            Console.WriteLine("PKCE probe: wrong verifier rejected (invalid_grant). No credential stored.");
            return;
        }

        if (mode == "probe-pkce")
        {
            Console.WriteLine("FAIL: provider issued a credential for a wrong verifier. Attempting remote revocation.");
            await adapter.RevokeAsync(received, cancellation);
            return;
        }

        await SaveOrRevokeAsync(received, adapter, store, cancellation);
        Console.WriteLine("Desktop credential stored securely. Run check to verify the Worker mapping.");
        if (mode == "probe-replay")
        {
            DesktopCredential replay;
            try
            {
                replay = await adapter.ExchangeAsync(code, verifier, callback.RedirectUri, cancellation);
            }
            catch (CredentialRejected)
            {
                Console.WriteLine("Replay probe: used authorization code rejected (invalid_grant).");
                return;
            }

            Console.WriteLine("FAIL: provider accepted a used authorization code. Attempting remote revocation.");
            await adapter.RevokeAsync(replay, cancellation);
            await adapter.RevokeAsync(received, cancellation);
            store.Clear();
        }
    }

    private static async Task SaveOrRevokeAsync(DesktopCredential received, IDesktopAuthAdapter adapter, CredentialStore store, CancellationToken cancellation)
    {
        try
        {
            store.Save(received);
        }
        catch
        {
            // Best effort cleanup on persistence failure; no plaintext fallback, including refresh.
            await adapter.RevokeAsync(received, cancellation);
            throw;
        }
    }
}
