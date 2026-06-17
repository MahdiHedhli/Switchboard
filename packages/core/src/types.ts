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
  | 'provider-status'
  | 'provider-live-probe'
  | 'provider-unavailable'
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
  /**
   * How this reservation was produced, for observability. Absent on
   * legacy/hand-authored reservations so existing data is byte-for-byte
   * unaffected; the selector stamps `selector`, manual pins stamp `pin`.
   */
  source?: 'selector' | 'pin' | 'explicit';
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
  /**
   * Declared class of work. The selector resolves this into a concrete
   * ModelReservation before the planner validates coverage.
   */
  taskClass?: string;
  /**
   * Manual "force this model" pin. Bypasses selection (the rare override that
   * replaces the old fallbackProvider/fallbackModelId idea) but is still
   * validated by the planner like any other reservation.
   */
  modelPin?: { provider: ProviderId; modelId: string };
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
  /**
   * Declared classes of work the selector can resolve into reservations.
   * Optional so existing profiles keep loading; Slice 5 populates real values.
   */
  taskClasses?: TaskClass[];
  /**
   * Profile-wide default cost-basis strategy. A per-task-class
   * `selectionPolicyOverride` takes precedence. When absent the selector falls
   * back to DEFAULT_SELECTION_POLICY.
   */
  selectionPolicy?: CostBasisStrategy;
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
  openLoopbackMutationsEnabled?: boolean;
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
  /**
   * Selection-stage warnings surfaced from the selector. A SEPARATE union from
   * PlannerWarning, so the planner's logic and output stay untouched. Lets
   * operators see `selection_unresolved` / `selection_placeholder_skipped`
   * routing hints directly on the dashboard. Optional for backward
   * compatibility; `buildDashboardSnapshot` always populates it (an empty
   * array when selection produced no warnings).
   */
  selectionWarnings?: SelectionWarning[];
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

// ---------------------------------------------------------------------------
// Model selection (cost-aware, capability-matched routing)
//
// The selector runs as a discrete stage BEFORE planTasks: it resolves a task's
// declared task-class into a concrete ModelReservation. The planner then
// validates coverage exactly as it does today. Selection answers "who should do
// this"; planning answers "can they, right now". See docs/SELECTION.md.
// ---------------------------------------------------------------------------

/**
 * Coarse, hand-assigned capability tiers. Deliberately NOT a benchmark matrix:
 * `heavy` is reserved for judgment-heavy work (attribution, anything touching
 * corpus accuracy), `light` for mechanical drafting/formatting, `standard` in
 * between. The selector always picks the cheapest model that clears the floor,
 * so the floor is the only thing protecting quality.
 */
export type ModelCapabilityTier = 'heavy' | 'standard' | 'light';

/**
 * Cost-basis strategy for the selector.
 * - `subscription-first`: marginal-cost-0 subscription models beat metered API
 *   calls while they remain available; no scarcity weighting.
 * - `subscription-first-scarcity-preserving`: as above, but a near-exhausted
 *   premium subscription is progressively deprioritized so a cheaper capable
 *   model can win before the subscription is fully spent.
 */
export type CostBasisStrategy = 'subscription-first' | 'subscription-first-scarcity-preserving';

/**
 * Pricing for a catalog entry, discriminated on the cost-basis auth mode.
 * For non-hybrid rows this matches the entry's `authMode`; a `hybrid` provider
 * row declares whichever cost basis it should be routed on. API rows carry a
 * real per-unit cost; subscription rows have marginal cost 0 and derive scarcity
 * from the live quota snapshot's remaining/limit.
 */
export type ModelPricing =
  | { authMode: 'api'; unit: UsageUnit; costPerUnit: number }
  | { authMode: 'subscription'; drawsFromQuota: true };

export type ModelCatalogStatus = 'active' | 'placeholder';

/**
 * A fully-resolved catalog entry. `active` rows are routable and carry verified
 * tier + pricing. `placeholder` rows are never routed on — the selector excludes
 * them and the catalog doctor reports them until an operator fills real values.
 */
export interface ModelCatalogEntry {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  tier: ModelCapabilityTier;
  authMode: AuthMode;
  pricing: ModelPricing;
  status: ModelCatalogStatus;
}

/**
 * A declared class of work.
 *
 * `minimumTier` is optional: a class that needs no model (e.g. local
 * `validation`) omits it and is skipped by the selector entirely. When present,
 * the selector picks the cheapest active model whose tier clears it.
 */
export interface TaskClass {
  id: string;
  minimumTier?: ModelCapabilityTier;
  selectionPolicyOverride?: CostBasisStrategy;
}

export type SelectionWarningCode =
  | 'selection_unresolved'
  | 'selection_placeholder_skipped';

export interface SelectionWarning {
  code: SelectionWarningCode;
  taskId: string;
  message: string;
  /** Task-class involved in the routing decision, for observability. */
  taskClass?: string;
  /** Provider/modelId rows excluded as placeholders, for `selection_placeholder_skipped`. */
  excluded?: Array<{ provider: ProviderId; modelId: string }>;
}

/**
 * Output of the selector stage. `tasks` carries selector/pin reservations
 * applied; tasks the selector did not touch pass through unchanged. The caller
 * feeds these tasks into the existing planner, which is solely responsible for
 * coverage. Selection warnings are intentionally a SEPARATE union from
 * PlannerWarning so the planner's logic is untouched.
 */
export interface SelectionResult {
  tasks: SwitchboardTask[];
  warnings: SelectionWarning[];
}

/**
 * Input to the selector stage. Mirrors PlannerContext but additionally carries
 * the routable catalog. `catalog` holds ONLY normalized `active` entries (the
 * caller passes `normalizeCatalog(file).active`); `placeholders` lists rows the
 * normalizer excluded so the selector can surface a `selection_placeholder_skipped`
 * hint when a class would otherwise be resolvable. The selector never mutates
 * its inputs.
 */
export interface SelectionContext {
  project: ProjectProfile;
  subscriptions: SubscriptionAccount[];
  tasks: SwitchboardTask[];
  catalog: ModelCatalogEntry[];
  placeholders?: Array<{ provider: ProviderId; modelId: string }>;
}
