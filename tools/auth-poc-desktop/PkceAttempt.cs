using System.Security.Cryptography;
using System.Text;

namespace AuthPoc.Desktop;

internal sealed class PkceAttempt
{
    public string Verifier { get; } = Base64Url(RandomNumberGenerator.GetBytes(32));
    public string State { get; } = Base64Url(RandomNumberGenerator.GetBytes(32));
    public string Challenge => ChallengeFor(Verifier);

    public static string ChallengeFor(string verifier) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    public bool MatchesState(string state) => CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(State), Encoding.UTF8.GetBytes(state));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
