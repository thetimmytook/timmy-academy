// Only Clerk's own OAuth authorization endpoint can resume a desktop login.
// Never turn the query string into a general-purpose external redirect.
export function oauthContinuation(
  search: string,
  frontendApi: string,
  accountPortalUrl: string,
): string | null {
  const values = new URLSearchParams(search).getAll('redirect_url');

  if (values.length !== 1 || !frontendApi) {
    return null;
  }

  try {
    const target = new URL(values[0]!);
    const origin = new URL('https://' + frontendApi).origin;
    const portal = new URL(accountPortalUrl);
    const isAuthorization =
      target.origin === origin && target.pathname === '/oauth/authorize-with-immediate-redirect';
    const isConsent =
      portal.protocol === 'https:' &&
      target.origin === portal.origin &&
      target.pathname === '/oauth-consent';

    return (isAuthorization || isConsent) && !target.username && !target.password && !target.hash
      ? target.href
      : null;
  } catch {
    return null;
  }
}
