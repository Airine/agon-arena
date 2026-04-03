import { NextResponse } from 'next/server';
import { proxyInternalResponse } from '@/lib/internal/server';

export async function GET(request: Request) {
  try {
    const response = await proxyInternalResponse(
      `/alpha-contacts${new URL(request.url).search}`,
      request,
    );
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
      { error: 'Internal alpha pipeline data is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
