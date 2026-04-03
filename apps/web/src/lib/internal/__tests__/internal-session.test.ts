import { describe, expect, it } from 'vitest';
import {
  getInternalSsoEntryUrl,
  hasInternalSession,
  hasInternalSessionCookie,
  readInternalSessionIdentity,
} from '../../internal-session';

function makeCookieStore(values: Record<string, string>) {
  return {
    get(name: string) {
      const value = values[name];
      return value ? { name, value } : undefined;
    },
  };
}

describe('internal-session helpers', () => {
  it('reads forwarded internal identity from request headers', () => {
    const headers = new Headers({
      'x-internal-subject': 'staff-123',
      'x-internal-email': 'ops@singularity-x.ai',
      'x-internal-display-name': 'Ops User',
    });

    expect(readInternalSessionIdentity(headers)).toEqual({
      subject: 'staff-123',
      email: 'ops@singularity-x.ai',
      displayName: 'Ops User',
    });
  });

  it('reads the auth-prefixed internal identity headers when they are provided', () => {
    const headers = new Headers({
      'x-internal-auth-subject': 'staff-123',
      'x-internal-auth-email': 'ops@singularity-x.ai',
      'x-internal-auth-display-name': 'Ops User',
    });

    expect(readInternalSessionIdentity(headers)).toEqual({
      subject: 'staff-123',
      email: 'ops@singularity-x.ai',
      displayName: 'Ops User',
    });
  });

  it('detects fallback internal session cookies', () => {
    expect(
      hasInternalSessionCookie(
        makeCookieStore({
          internal_session: 'cookie-token',
        }),
      ),
    ).toBe(true);
  });

  it('requires either forwarded identity or session cookie', () => {
    expect(
      hasInternalSession(
        new Headers({
          'x-internal-subject': 'staff-123',
          'x-internal-email': 'ops@singularity-x.ai',
        }),
        makeCookieStore({}),
      ),
    ).toBe(true);

    expect(
      hasInternalSession(new Headers(), makeCookieStore({ singularity_sso: '1' })),
    ).toBe(true);

    expect(hasInternalSession(new Headers(), makeCookieStore({}))).toBe(false);
  });

  it('defaults the internal SSO entry URL when env is absent', () => {
    expect(getInternalSsoEntryUrl()).toBe('https://sso.singularity-x.ai');
  });
});
