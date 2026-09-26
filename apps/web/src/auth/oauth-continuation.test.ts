import { expect, it } from 'vitest';

import { oauthContinuation } from './oauth-continuation';

const redirectPrefix = '?redirect_url=';
const portal = 'https://fixture.accounts.dev/user';
const host = 'fixture.clerk.accounts.dev';
const valid = 'https://' + host + '/oauth/authorize-with-immediate-redirect?state=fixture';

it.each([
  ['fixture.clerk.accounts.dev', portal, 'https://fixture.accounts.dev/oauth-consent'],
  [
    'clerk.example.com',
    'https://accounts.example.com/user',
    'https://accounts.example.com/oauth-consent',
  ],
])('accepts the SDK-configured Account Portal for %s', (frontendApi, profile, consent) => {
  const target = consent + '?client_id=fixture&state=fixture&code_challenge=fixture';
  expect(oauthContinuation(redirectPrefix + encodeURIComponent(target), frontendApi, profile)).toBe(
    target,
  );
});

it.each([
  'https://other.accounts.dev/oauth-consent',
  'https://fixture.accounts.dev.untrusted.example/oauth-consent',
  portal,
  'https://fixture.accounts.dev:8443/oauth-consent',
  'https://user:password@fixture.accounts.dev/oauth-consent',
  'https://fixture.accounts.dev/oauth-consent#fragment',
])('rejects an untrusted Account Portal destination: %s', target => {
  expect(oauthContinuation(redirectPrefix + encodeURIComponent(target), host, portal)).toBeNull();
});

it('accepts only the current Clerk instance authorization continuation', () => {
  expect(oauthContinuation(redirectPrefix + encodeURIComponent(valid), host, portal)).toBe(valid);
});

it.each([
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Rejection test; no HTTP request is sent.
  'http://' + host + '/oauth/authorize-with-immediate-redirect',
  valid.replace(host, host + '.untrusted.example'),
  valid.replace(host, 'other.clerk.accounts.dev'),
  valid.replace(host, host + ':8443'),
  valid.replace('https://', 'https://user:password@'),
  valid + '#fragment',
  'https://' + host + '/sign-in',
  '//' + host + '/oauth/authorize-with-immediate-redirect',
  'javascript:alert(1)',
  '/bench/me',
])('rejects an untrusted continuation: %s', target => {
  expect(oauthContinuation(redirectPrefix + encodeURIComponent(target), host, portal)).toBeNull();
});

it('rejects missing or ambiguous continuation and missing instance', () => {
  expect(oauthContinuation('', host, portal)).toBeNull();
  const query = 'redirect_url=' + encodeURIComponent(valid);
  expect(oauthContinuation('?' + query + '&' + query, host, portal)).toBeNull();
  expect(oauthContinuation('?' + query, '', portal)).toBeNull();
});
