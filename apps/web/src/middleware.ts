import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getInternalDevBypassIdentity,
  getInternalSsoEntryUrl,
  hasInternalSession,
} from '@/lib/internal-session';

function buildSsoRedirectUrl(request: NextRequest): URL {
  const redirectUrl = new URL(getInternalSsoEntryUrl());
  redirectUrl.searchParams.set('return_to', request.nextUrl.href);
  return redirectUrl;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/internal') && !pathname.startsWith('/api/internal')) {
    return NextResponse.next();
  }

  const devBypass = getInternalDevBypassIdentity();
  if (devBypass) {
    const headers = new Headers(request.headers);
    headers.set('x-internal-auth-subject', devBypass.subject);
    headers.set('x-internal-auth-email', devBypass.email);
    if (devBypass.displayName) {
      headers.set('x-internal-auth-display-name', devBypass.displayName);
    }
    if (devBypass.secret) {
      headers.set('x-internal-auth-secret', devBypass.secret);
    }

    return NextResponse.next({
      request: {
        headers,
      },
    });
  }

  if (hasInternalSession(request.headers, request.cookies)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/internal')) {
    return NextResponse.json(
      { error: 'Internal SSO required.' },
      { status: 401 },
    );
  }

  return NextResponse.redirect(buildSsoRedirectUrl(request));
}

export const config = {
  matcher: ['/internal/:path*', '/api/internal/:path*'],
};
