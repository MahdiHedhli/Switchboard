/*
 * Copyright 2026 Mahdi Hedhli
 *
 * Licensed under the Apache License, Version 2.0.
 */

export type ProviderId = 'openai' | 'anthropic' | 'google' | (string & {});
export type AuthMode = 'subscription' | 'api' | 'hybrid';
export type UsageUnit = 'requests' | 'messages' | 'minutes' | 'credits' | 'tokens' | 'unknown';
export type AvailabilityState = 'available' | 'constrained' | 'unavailable' | 'unknown';
export type UsageSource = 'manual' | 'cli' | 'provider-ui' | 'api' | 'inferred';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type QuotaInterpretation = 'absolute' | 'percentage_window' | 'informational';
export type TaskStatus = 'queued' | 'planned' | 'running' | 'review' | 'blocked' | 'completed' | 'failed';
export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';
export type SubscriptionSyncMethod = 'seed' | 'snapshot' | 'provider';
export type ApprovalEventKind = 'requested' | 'approved' | 'reset';
export type ProviderAdapterKind = 'snapshot' | 'trusted-command';
export type AdapterStatusState = 'ready' | 'ready_with_advisories' | 'missing' | 'insecure' | 'invalid';
export type SubscriptionSyncMode =
  | 'app-server-rate-limits'
  | 'app-server-account'
  | 'login-status-fallback'
  | 'unknown';

export interface SubscriptionSignal {
  id: string;
  label: string;
  value: string;
}

export interface ModelQuotaWindowSnapshot {
  id: string;
  label: string;
  durationMinutes?: number;
  limit?: number;
  used?: number;
  remaining?: number;
  interpretation?: QuotaInterpretation;
  resetAt?: string;
}

export interface ModelQuotaSnapshot {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  availability: AvailabilityState;
  authMode: AuthMode;
  usageUnit: UsageUnit;
  source: UsageSource;
  confidence: ConfidenceLevel;
  limit?: number;
  used?: number;
  remaining?: number;
  interpretation?: QuotaInterpretation;
  resetAt?: string;
  windows?: ModelQuotaWindowSnapshot[];
  notes?: string;
}

export interface SubscriptionAccount {
  id: string;
  provider: ProviderId;
  displayName: string;
  authMode: AuthMode;
  owner: string;
  syncMethod?: SubscriptionSyncMethod;
  lastRefreshedAt?: string;
  signals?: SubscriptionSignal[];
  quotas: ModelQuotaSnapshot[];
}

export interface ModelReservation {
  provider: ProviderId;
  modelId: string;
  estimatedCost: number;
  usageUnit: UsageUnit;
  reason: string;
}

export interface AgentRole {
  id: string;
  name: string;
  provider: ProviderId;
  defaultModelId: string;
  responsibilities: string[];
  canWrite: boolean;
  canReview: boolean;
  canApprove: boolean;
}

export interface TaskArtifact {
  id: string;
  type: 'spec' | 'diff' | 'doc' | 'log' | 'result' | 'other';
  uri: string;
  summary: string;
}

export interface TaskApprovalEvent {
  id: string;
  kind: ApprovalEventKind;
  at: string;
  actor?: string;
  note?: string;
}

export interface SwitchboardTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  role: string;
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  blockedReason?: string;
  approvalRequired?: boolean;
  approvalRequestedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  approvalNote?: string;
  approvalEvents?: TaskApprovalEvent[];
  reservations?: ModelReservation[];
  artifacts?: TaskArtifact[];
  dependsOn?: string[];
}

export interface ProjectProfile {
  id: string;
  name: string;
  description: string;
  repos: Array<{
    id: string;
    path: string;
    visibility: 'public' | 'private';
    role: 'working' | 'publish' | 'mixed';
  }>;
  roles: AgentRole[];
}

export interface ProjectProfileSummary {
  id: string;
  name: string;
  description: string;
  repoCount: number;
  roleCount: number;
}

export interface ProjectProfilesSnapshot {
  profiles: ProjectProfileSummary[];
}

export interface PlannerContext {
  project: ProjectProfile;
  subscriptions: SubscriptionAccount[];
  tasks: SwitchboardTask[];
}

export interface ProviderSyncWarningDetails {
  kind: 'provider_sync';
  provider: ProviderId;
  accountId: string;
  displayName: string;
  mode?: SubscriptionSyncMode;
  accountSyncMethods?: SubscriptionSyncMethod[];
  source?: string;
  rateLimitsDetail?: string;
  rateLimitsHost?: string;
  openaiAuthRequired: boolean;
}

export interface QuotaReservationWarningDetails {
  kind: 'quota_reservation';
  taskId: string;
  provider: ProviderId;
  modelId: string;
  displayName?: string;
  status: 'missing' | 'insufficient' | 'unavailable' | 'unknown';
  quotaAvailability?: AvailabilityState;
  quotaInterpretation?: QuotaInterpretation;
  quotaUsageUnit?: UsageUnit;
  reservationUsageUnit: UsageUnit;
  quotaRemaining?: number;
  reservationEstimatedCost: number;
}

export interface PlannerWarning {
  code: 'quota_unknown' | 'quota_low' | 'model_unavailable' | 'approval_pending' | 'provider_sync_degraded' | 'provider_snapshot_only';
  message: string;
  details?: ProviderSyncWarningDetails | QuotaReservationWarningDetails;
}

export interface PlannerResult {
  runnable: SwitchboardTask[];
  blocked: SwitchboardTask[];
  warnings: PlannerWarning[];
}

export type BrokerMutationAccess = 'open' | 'operator_token' | 'disabled';
export type BrokerOperatorTokenSource = 'direct' | 'env' | 'file' | 'unset';

export interface BrokerScopeSummary {
  requirement: BrokerMutationAccess;
  detail: string;
}

export interface BrokerAuthSummary {
  localOnly: boolean;
  remoteExposureAllowed: boolean;
  operatorTokenConfigured: boolean;
  operatorTokenSource?: BrokerOperatorTokenSource;
  operatorTokenFile?: string;
  operatorTokenProblem?: string;
  manualSubscriptionReplaceEnabled: boolean;
  operatorTokenHeader: string;
  scopes: {
    taskCreate: BrokerScopeSummary;
    taskUpdate: BrokerScopeSummary;
    subscriptionRefresh: BrokerScopeSummary;
    subscriptionReplace: BrokerScopeSummary;
  };
}

export interface BrokerHealthSnapshot {
  status: 'ok';
  service: 'switchboard-broker';
  localOnly: boolean;
  operatorTokenRequired: boolean;
  protocol: 'http' | 'https';
  tlsEnabled: boolean;
  auth: BrokerAuthSummary;
}

export interface ProviderAdapterStatusSnapshot {
  provider: ProviderId;
  kind: ProviderAdapterKind;
  description: string;
  source: string;
  status: AdapterStatusState;
  configured: boolean;
  secure: boolean;
  advisoryCodes?: string[];
  statusMessage?: string;
  lastModifiedAt?: string;
  problem?: string;
}

export interface ProjectAdaptersSnapshot {
  adapters: ProviderAdapterStatusSnapshot[];
}

export type QuotaCoverageState = 'none' | 'informational_only' | 'mixed' | 'typed';

export interface ProviderSyncSummary {
  degraded: boolean;
  syncModes: SubscriptionSyncMode[];
  syncBadges: string[];
  rateLimitHosts: string[];
  openaiAuth: string[];
  quotaCoverage: QuotaCoverageState;
  quotaModels: number;
  typedQuotaModels: number;
}

export interface ProviderAccountContextSummary {
  accountDisplayNames: string[];
  latestAccountRefreshedAt?: string;
  accountSyncMethods: SubscriptionSyncMethod[];
}

export interface ProviderRefreshSummary extends ProviderSyncSummary, ProviderAccountContextSummary {
  provider: ProviderId;
  kind: 'snapshot' | 'trusted-command';
  refreshedAt: string;
  accounts: number;
}

export interface ProviderDashboardSummary extends ProviderSyncSummary, ProviderAccountContextSummary {
  provider: ProviderId;
  accounts: number;
}

export interface ProjectStateSnapshot {
  profile: ProjectProfile;
  subscriptions: SubscriptionAccount[];
  tasks: SwitchboardTask[];
  updatedAt: string;
}

export interface ProjectDashboardSnapshot extends ProjectStateSnapshot {
  plan: PlannerResult;
  providerSummaries: ProviderDashboardSummary[];
}

export interface TaskSnapshot {
  task: SwitchboardTask;
}

export interface ProjectRefreshSnapshot {
  dashboard: ProjectDashboardSnapshot;
  refresh: ProviderRefreshSummary[];
}

export type BrokerErrorCode =
  | 'not_found'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'method_not_allowed'
  | 'internal_error';

export interface BrokerErrorResponse {
  error: BrokerErrorCode;
  detail: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  role: string;
  status?: TaskStatus;
  assignee?: string;
  approvalRequired?: boolean;
  approvalNote?: string;
  reservations?: ModelReservation[];
  artifacts?: TaskArtifact[];
  dependsOn?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  role?: string;
  status?: TaskStatus;
  assignee?: string | null;
  blockedReason?: string | null;
  approvalRequired?: boolean;
  approvedBy?: string | null;
  approvalNote?: string | null;
}
