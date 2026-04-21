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
export type TaskStatus = 'queued' | 'planned' | 'running' | 'review' | 'blocked' | 'completed' | 'failed';
export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';

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
  resetAt?: string;
  notes?: string;
}

export interface SubscriptionAccount {
  id: string;
  provider: ProviderId;
  displayName: string;
  authMode: AuthMode;
  owner: string;
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

export interface SwitchboardTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  role: string;
  assignee?: string;
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

export interface PlannerContext {
  project: ProjectProfile;
  subscriptions: SubscriptionAccount[];
  tasks: SwitchboardTask[];
}
