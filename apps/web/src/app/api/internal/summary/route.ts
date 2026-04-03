import { NextResponse } from 'next/server';
import { proxyInternalResponse } from '@/lib/internal/server';

export async function GET(request: Request) {
  try {
    const response = await proxyInternalResponse('/summary', request);
    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal summary is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
