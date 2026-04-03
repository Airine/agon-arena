import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
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
