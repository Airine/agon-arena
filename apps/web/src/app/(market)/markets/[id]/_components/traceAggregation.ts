import { buildApiUrl } from '../../../../../lib/api';

export interface TraceRow {
  id: string;
  agentId: string;
  turnId: string | null;
  errorType: 'timeout' | 'invalid_action' | 'connection_lost' | 'schema_error';
  details: unknown;
  createdAt: string;
}

type TraceFetch = typeof fetch;

interface FetchAgentTracesOptions {
  arenaId: string;
  agentIds: string[];
  fetchImpl?: TraceFetch;
}

interface FetchAgentTracesResult {
  traces: TraceRow[];
  hasFailures: boolean;
}

export async function fetchAgentTraces({
  arenaId,
  agentIds,
  fetchImpl = fetch,
}: FetchAgentTracesOptions): Promise<FetchAgentTracesResult> {
  if (agentIds.length === 0) {
    return { traces: [], hasFailures: false };
  }

  const results = await Promise.allSettled(
    agentIds.map((agentId) =>
      fetchImpl(buildApiUrl(`/arenas/${arenaId}/agents/${agentId}/traces?limit=50`))
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
        .then((data: { traces: TraceRow[] }) => data.traces ?? []),
    ),
  );

  const traces: TraceRow[] = [];
  let hasFailures = false;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      traces.push(...result.value);
    } else {
      hasFailures = true;
    }
  }

  traces.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { traces, hasFailures };
}
