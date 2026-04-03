import { NextResponse } from 'next/server';
import { proxyInternalResponse } from '@/lib/internal/server';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const body = await request.text();
    const response = await proxyInternalResponse(`/release-gates/${id}`, request, {
      body,
    });
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
      { error: 'Internal release gate update failed.' },
      { status: 503 },
    );
  }
}
