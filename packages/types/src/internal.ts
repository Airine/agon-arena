export const INTERNAL_PHASE_1_PAGE_ROUTES = [
  '/internal',
  '/internal/alpha',
  '/internal/release-gate',
] as const;

export type InternalPhase1PageRoute = typeof INTERNAL_PHASE_1_PAGE_ROUTES[number];

export const INTERNAL_PHASE_1_REQUIRED_API_ROUTE_KEYS = [
  'summary',
  'alphaContacts',
  'alphaContactDetail',
  'releaseGates',
  'releaseGateDetail',
] as const;

export type InternalPhase1RequiredApiRouteKey = typeof INTERNAL_PHASE_1_REQUIRED_API_ROUTE_KEYS[number];

export const INTERNAL_PHASE_1_OPTIONAL_API_ROUTE_KEYS = [
  'funnel',
] as const;

export type InternalPhase1OptionalApiRouteKey = typeof INTERNAL_PHASE_1_OPTIONAL_API_ROUTE_KEYS[number];

export const INTERNAL_SUMMARY_FUNNEL_STAGES = [
  'wallet_connected',
  'session_created',
  'arena_joined',
  'first_turn_received',
  'first_action_submitted',
  'arena_finished',
] as const;

export type InternalSummaryFunnelStage = typeof INTERNAL_SUMMARY_FUNNEL_STAGES[number];

export const INTERNAL_ALPHA_CONTACT_STATUSES = [
  'new',
  'contacted',
  'installing',
  'smoke_passed',
  'competing',
  'first_action_submitted',
  'completed_arena',
  'blocked',
  'paused',
  'lost',
] as const;

export type InternalAlphaContactStatus = typeof INTERNAL_ALPHA_CONTACT_STATUSES[number];

export const INTERNAL_RELEASE_GATE_STATUSES = [
  'unknown',
  'blocked',
  'at_risk',
  'ready',
] as const;

export type InternalReleaseGateStatus = typeof INTERNAL_RELEASE_GATE_STATUSES[number];

export type InternalDataStatus = 'ok' | 'degraded' | 'unavailable';

export interface InternalAuthContext {
  subject: string;
  email: string;
  displayName?: string;
}

export interface InternalDataSourceState {
  key: 'funnel' | 'alpha_contacts' | 'release_gates' | 'runtime_health';
  status: InternalDataStatus;
  detail?: string;
  checkedAt?: string;
}

export interface InternalMetricWindow {
  current: number;
  previous: number | null;
  delta: number | null;
}

export interface InternalSummaryActivationOverview {
  newAgents: InternalMetricWindow;
  firstActionSubmitted: InternalMetricWindow;
  completedArenas: InternalMetricWindow;
  largestActivationBlockerLabel: string | null;
}

export interface InternalSummaryFunnelStageStat {
  stage: InternalSummaryFunnelStage;
  count: number;
  conversionFromPrevious: number | null;
}

export interface InternalAlphaBlockerQueueItem {
  id: string;
  displayName: string;
  ownerEmail: string | null;
  status: InternalAlphaContactStatus;
  currentBlocker: string | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
}

export interface InternalReleaseGate {
  id: string;
  gateKey: string;
  status: InternalReleaseGateStatus;
  note: string | null;
  evidenceUrl: string | null;
  updatedBySubject: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
}

export interface InternalSummaryReleaseGateOverview {
  verdict: InternalReleaseGateStatus;
  unmetConditions: string[];
  gates: InternalReleaseGate[];
}

export interface InternalSummaryResponse {
  asOf: string;
  activationOverview: InternalSummaryActivationOverview;
  funnel: {
    stages: InternalSummaryFunnelStageStat[];
    largestDropOffStage: InternalSummaryFunnelStage | null;
  };
  blockerQueue: InternalAlphaBlockerQueueItem[];
  releaseGate: InternalSummaryReleaseGateOverview;
  dataSources: InternalDataSourceState[];
}

export interface InternalAlphaContactListQuery {
  ownerSubject?: string;
  status?: InternalAlphaContactStatus | 'all';
  search?: string;
  overdueOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface InternalAlphaContactListItem {
  id: string;
  displayName: string;
  source: string;
  ownerSubject: string | null;
  ownerEmail: string | null;
  status: InternalAlphaContactStatus;
  currentBlocker: string | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  tags: string[];
}

export interface InternalPaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface InternalAlphaContactTimelineEntry {
  id: string;
  happenedAt: string;
  type: 'status_change' | 'note' | 'follow_up' | 'funnel_progress' | 'runtime_issue';
  actorSubject?: string | null;
  actorEmail?: string | null;
  summary: string;
}

export interface InternalAlphaContactLatestFunnel {
  stage: InternalSummaryFunnelStage | null;
  occurredAt: string | null;
}

export interface InternalAlphaContactRuntimeIssue {
  key: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  occurredAt: string;
}

export interface InternalAlphaContactDetail extends InternalAlphaContactListItem {
  notes: string | null;
  timeline: InternalAlphaContactTimelineEntry[];
  latestFunnel: InternalAlphaContactLatestFunnel;
  latestArenaActivity: string | null;
  latestRuntimeIssues: InternalAlphaContactRuntimeIssue[];
}

export interface InternalUpdateAlphaContactRequest {
  ownerSubject?: string | null;
  ownerEmail?: string | null;
  status?: InternalAlphaContactStatus;
  currentBlocker?: string | null;
  nextFollowUpAt?: string | null;
  notes?: string | null;
  tags?: string[];
}

export interface InternalReleaseGateListResponse {
  items: InternalReleaseGate[];
}

export interface InternalUpdateReleaseGateRequest {
  status?: InternalReleaseGateStatus;
  note?: string | null;
  evidenceUrl?: string | null;
}

export const INTERNAL_PHASE_1_API_ROUTES = {
  summary: '/internal/summary',
  alphaContacts: '/internal/alpha-contacts',
  alphaContactDetail: (id: string) => `/internal/alpha-contacts/${id}`,
  releaseGates: '/internal/release-gates',
  releaseGateDetail: (id: string) => `/internal/release-gates/${id}`,
  funnel: '/internal/funnel',
} as const;
