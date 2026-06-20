/*
 * Presentation helpers shared across dashboard panels: timestamp/quota/signal
 * formatting, approval and adapter-status derivation, and the operator-scope
 * predicate. All pure (string/boolean in, string/boolean out) so panels stay
 * declarative and the logic is unit-testable on its own.
 */
import { formatSubscriptionAccountWarning } from '@switchboard/core';
import type {
  BrokerAuthSummary,
  BrokerMutationAccess,
  ModelQuotaSnapshot,
  ModelQuotaWindowSnapshot,
  ProjectAdaptersSnapshot,
  ProjectDashboardSnapshot,
  ProviderAdapterStatusSnapshot,
  SubscriptionSignal,
  SwitchboardTask,
  TaskApprovalEvent,
} from '@switchboard/core';

export type AdapterStatus = ProviderAdapterStatusSnapshot;
export type AdapterStatusResponse = ProjectAdaptersSnapshot;

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function formatQuotaBudget(quota: Pick<ModelQuotaSnapshot, 'remaining' | 'interpretation' | 'usageUnit'>): string {
  if (quota.remaining === undefined) {
    if (quota.interpretation === 'percentage_window' || quota.usageUnit === 'unknown' || quota.usageUnit === undefined) {
      return 'unknown budget';
    }

    return `unknown ${quota.usageUnit}`;
  }

  if (quota.interpretation === 'percentage_window') {
    return `${quota.remaining}% remaining`;
  }

  return `${quota.remaining} ${quota.usageUnit}`;
}

export function formatQuotaUsage(
  quota: Pick<ModelQuotaSnapshot, 'used' | 'limit' | 'interpretation'>,
  label = 'current window',
): string | null {
  if (quota.used === undefined || quota.limit === undefined) {
    return null;
  }

  if (quota.interpretation === 'percentage_window') {
    return `used ${quota.used}% of ${label}`;
  }

  return `used ${quota.used}/${quota.limit}`;
}

export function resolveQuotaWindows(quota: ModelQuotaSnapshot): ModelQuotaWindowSnapshot[] {
  if (quota.windows?.length) {
    return quota.windows;
  }

  if (
    quota.limit === undefined
    && quota.used === undefined
    && quota.remaining === undefined
    && quota.resetAt === undefined
  ) {
    return [];
  }

  return [
    {
      id: 'current',
      label: 'Current window',
      limit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
      interpretation: quota.interpretation,
      resetAt: quota.resetAt,
    },
  ];
}

export function formatSignal(signal: SubscriptionSignal): string {
  return `${signal.label}: ${signal.value}`;
}

export function formatQuotaPills(quota: Pick<ModelQuotaSnapshot, 'source' | 'confidence' | 'interpretation' | 'usageUnit'>): string[] {
  const pills = [
    `source: ${quota.source}`,
    `confidence: ${quota.confidence}`,
  ];

  if (quota.interpretation === 'percentage_window') {
    pills.push('windowed %');
  } else if (quota.interpretation === 'informational') {
    pills.push('informational');
  } else if (quota.interpretation) {
    pills.push(quota.interpretation);
  }

  if (quota.usageUnit && quota.usageUnit !== 'unknown' && quota.interpretation !== 'percentage_window') {
    pills.push(`unit: ${quota.usageUnit}`);
  }

  return pills;
}

export function formatAccountSyncWarning(account: ProjectDashboardSnapshot['subscriptions'][number]): string | null {
  return formatSubscriptionAccountWarning(account);
}

export function formatTaskApproval(task: SwitchboardTask): string | null {
  if (!task.approvalRequired) {
    return null;
  }

  if (task.approvedAt) {
    return `approval: approved by ${task.approvedBy ?? 'operator'} at ${formatTimestamp(task.approvedAt)}`;
  }

  return task.approvalRequestedAt
    ? `approval: pending since ${formatTimestamp(task.approvalRequestedAt)}`
    : 'approval: pending';
}

export function formatApprovalEvent(event: TaskApprovalEvent): string {
  switch (event.kind) {
    case 'requested':
      return `Approval requested ${formatTimestamp(event.at)}`;
    case 'approved':
      return `Approved by ${event.actor ?? 'operator'} ${formatTimestamp(event.at)}`;
    case 'reset':
      return `Returned to pending ${formatTimestamp(event.at)}`;
    default:
      return `${event.kind} ${formatTimestamp(event.at)}`;
  }
}

export function canUseScope(scope: BrokerAuthSummary['scopes'][keyof BrokerAuthSummary['scopes']] | undefined, operatorToken: string): boolean {
  if (!scope) {
    return false;
  }

  return scope.requirement === 'open' || (scope.requirement === 'operator_token' && operatorToken.trim().length > 0);
}

export function formatRequirement(requirement: BrokerMutationAccess): string {
  switch (requirement) {
    case 'open':
      return 'open';
    case 'operator_token':
      return 'token';
    case 'disabled':
      return 'disabled';
    default:
      return requirement;
  }
}

export function formatBrokerTokenSource(authSummary: BrokerAuthSummary): string | null {
  switch (authSummary.operatorTokenSource) {
    case 'env':
      return 'env';
    case 'file':
      return authSummary.operatorTokenFile
        ? `file (${authSummary.operatorTokenFile})`
        : 'file';
    case 'direct':
      return 'direct override';
    case 'unset':
      return 'unset';
    default:
      return null;
  }
}

export function getAdapterStatus(adapter: Partial<AdapterStatus>): NonNullable<AdapterStatus['status']> {
  if (adapter.status) {
    return adapter.status;
  }

  if (adapter.configured === false) {
    return 'missing';
  }

  if (adapter.secure === false) {
    return 'insecure';
  }

  if ((adapter.advisoryCodes?.length ?? 0) > 0) {
    return 'ready_with_advisories';
  }

  return 'ready';
}

export function formatAdapterStatus(adapter: Partial<AdapterStatus>): string {
  return getAdapterStatus(adapter).replace(/_/g, ' ');
}

export function isAdapterAdvisory(adapter: Partial<AdapterStatus>): boolean {
  return getAdapterStatus(adapter) === 'ready_with_advisories' || (adapter.advisoryCodes?.length ?? 0) > 0;
}
