import { headers as nextHeaders } from 'next/headers';
import type {
  InternalAlphaContactsResponse,
  InternalReleaseGatesResponse,
  InternalSummaryResponse,
} from './contracts';
import { buildApiUrl } from '@/lib/api';

type InternalFetchResult<T> =
  | { kind: 'ok'; status: number; data: T }
  | { kind: 'auth'; status: 401 | 403 }
  | { kind: 'error'; status: number; message: string };

const FORWARDED_HEADER_NAMES = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'x-internal-display-name',
  'x-internal-email',
  'x-internal-subject',
  'x-request-id',
] as const;

function buildForwardHeaders(source: Headers): Headers {
  const forwarded = new Headers();

  for (const headerName of FORWARDED_HEADER_NAMES) {
    const value = source.get(headerName);
    if (value) {
      forwarded.set(headerName, value);
    }
  }

  return forwarded;
}

async function getRequestHeaders(): Promise<Headers> {
  const source = await nextHeaders();
  return buildForwardHeaders(source);
}

export async function requestInternal(
  path: string,
  init: RequestInit = {},
  sourceHeaders?: Headers,
): Promise<Response> {
  const requestHeaders = sourceHeaders ?? (await getRequestHeaders());
  const url = buildApiUrl(`/internal${path}`);

  return fetch(url, {
    ...init,
    headers: requestHeaders,
    cache: 'no-store',
  });
}

async function readJson<T>(response: Response): Promise<InternalFetchResult<T>> {
  if (response.status === 401 || response.status === 403) {
    return { kind: 'auth', status: response.status };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      return {
        kind: 'error',
        status: response.status,
        message: `Internal API request failed with status ${response.status}.`,
      };
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Internal API request failed with status ${response.status}.`;

    return {
      kind: 'error',
      status: response.status,
      message,
    };
  }

  return {
    kind: 'ok',
    status: response.status,
    data: (payload ?? {}) as T,
  };
}

export async function fetchInternalSummary(): Promise<
  InternalFetchResult<InternalSummaryResponse>
> {
  return readJson<InternalSummaryResponse>(await requestInternal('/summary'));
}

export async function fetchInternalAlphaContacts(): Promise<
  InternalFetchResult<InternalAlphaContactsResponse>
> {
  return readJson<InternalAlphaContactsResponse>(
    await requestInternal('/alpha-contacts'),
  );
}

export async function fetchInternalReleaseGates(): Promise<
  InternalFetchResult<InternalReleaseGatesResponse>
> {
  return readJson<InternalReleaseGatesResponse>(
    await requestInternal('/release-gates'),
  );
}

export async function proxyInternalResponse(
  path: string,
  request: Request,
  init: RequestInit = {},
): Promise<Response> {
  const headers = buildForwardHeaders(request.headers);
  return requestInternal(path, { method: request.method, ...init }, headers);
}

export function getInternalSsoEntryUrl(): string {
  return process.env.INTERNAL_SSO_URL ?? 'https://sso.singularity-x.ai';
}
