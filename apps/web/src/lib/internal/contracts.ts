export interface InternalAuthContext {
  subject: string;
  email: string;
  displayName?: string | null;
}

export interface InternalActivationOverview {
  newAgentsToday: number;
  newAgents7d: number;
  firstActionSubmittedToday: number;
  firstActionSubmitted7d: number;
  completedArenasToday: number;
  completedArenas7d: number;
  trendDeltaPct?: number | null;
  largestBlockerLabel?: string | null;
}

export interface InternalFunnelStage {
  stage: string;
  count: number;
  conversionRate?: number | null;
}

export interface InternalBlockerItem {
  id: string;
  title: string;
  owner?: string | null;
  reason: string;
  ageHours?: number | null;
  nextFollowUpAt?: string | null;
}

export interface InternalRuntimeIssue {
  id: string;
  label: string;
  severity: 'info' | 'warning' | 'danger';
  detail: string;
  metric?: string | null;
}

export interface InternalReleaseGateSummary {
  verdict: 'ready' | 'watch' | 'blocked';
  unmetConditions: string[];
  evidenceLinks?: string[];
  updatedAt?: string | null;
}

export interface InternalSummaryResponse {
  auth?: InternalAuthContext;
  activationOverview?: Partial<InternalActivationOverview>;
  funnelSummary?: {
    stages?: InternalFunnelStage[];
  };
  blockerQueue?: {
    items?: InternalBlockerItem[];
  };
  runtimeRedZone?: {
    issues?: InternalRuntimeIssue[];
  };
  releaseGate?: Partial<InternalReleaseGateSummary>;
  partials?: string[];
}

export type AlphaContactStatus =
  | 'new'
  | 'contacted'
  | 'installing'
  | 'smoke_passed'
  | 'competing'
  | 'first_action_submitted'
  | 'completed_arena'
  | 'blocked'
  | 'paused'
  | 'lost';

export interface InternalAlphaContact {
  id: string;
  displayName: string;
  source: string;
  ownerSubject?: string | null;
  ownerEmail?: string | null;
  status: AlphaContactStatus;
  currentBlocker?: string | null;
  nextFollowUpAt?: string | null;
  lastActivityAt?: string | null;
  notes?: string | null;
  tags?: string[];
}

export interface InternalAlphaContactsResponse {
  contacts: InternalAlphaContact[];
}

export interface InternalAlphaContactPatch {
  ownerEmail?: string;
  status?: AlphaContactStatus;
  currentBlocker?: string;
  nextFollowUpAt?: string | null;
  notes?: string;
  tags?: string[];
}

export type ReleaseGateStatus = 'pass' | 'watch' | 'blocked';

export interface InternalReleaseGate {
  id: string;
  gateKey: string;
  status: ReleaseGateStatus;
  note?: string | null;
  evidenceUrl?: string | null;
  updatedBySubject?: string | null;
  updatedByEmail?: string | null;
  updatedAt?: string | null;
}

export interface InternalReleaseGatesResponse {
  gates: InternalReleaseGate[];
}

export interface InternalReleaseGatePatch {
  status?: ReleaseGateStatus;
  note?: string;
  evidenceUrl?: string | null;
}
