import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

export const INTERNAL_IDENTITY_HEADER_NAMES = [
  'x-internal-subject',
  'x-internal-email',
  'x-internal-display-name',
] as const;

export const INTERNAL_SESSION_COOKIE_NAMES = [
  'internal_sso',
  'internal_session',
  'singularity_sso',
  'sso_session',
] as const;

export interface InternalSessionIdentity {
  subject: string;
  email: string;
  displayName?: string | null;
}

export function getInternalSsoEntryUrl(): string {
  return process.env.INTERNAL_SSO_URL ?? 'https://sso.singularity-x.ai';
}

export function readInternalSessionIdentity(
  headers: Pick<Headers, 'get'>,
): InternalSessionIdentity | null {
  const subject = headers.get('x-internal-subject');
  const email = headers.get('x-internal-email');

  if (!subject || !email) {
    return null;
  }

  return {
    subject,
    email,
    displayName: headers.get('x-internal-display-name'),
  };
}

export function hasInternalSessionCookie(
  cookies: Pick<ReadonlyRequestCookies, 'get'>,
): boolean {
  return INTERNAL_SESSION_COOKIE_NAMES.some((name) => Boolean(cookies.get(name)?.value));
}

export function hasInternalSession(
  headers: Pick<Headers, 'get'>,
  cookies: Pick<ReadonlyRequestCookies, 'get'>,
): boolean {
  return (
    readInternalSessionIdentity(headers) !== null || hasInternalSessionCookie(cookies)
  );
}
