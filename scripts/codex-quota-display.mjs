function formatResetAt(resetAt) {
  if (!resetAt) {
    return null;
  }

  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString('en-US');
}

function formatUsageValue(value, interpretation) {
  if (value == null) {
    return null;
  }

  return interpretation === 'percentage_window' ? `${value}%` : String(value);
}

function detailHasTypedUsage(detail) {
  if ((detail.windows?.length ?? 0) > 0) {
    return detail.windows.some((window) =>
      window.interpretation !== 'informational'
      || window.limit != null
      || window.used != null
      || window.remaining != null
      || window.resetAt,
    );
  }

  return (
    detail.interpretation !== 'informational'
    || detail.limit != null
    || detail.used != null
    || detail.remaining != null
    || detail.resetAt
  );
}

export function quotaCoverage(quotaDetails = []) {
  if (quotaDetails.length === 0) {
    return 'none';
  }

  const typedCount = quotaDetails.filter((detail) => detailHasTypedUsage(detail)).length;

  if (typedCount === 0) {
    return 'informational_only';
  }

  if (typedCount < quotaDetails.length) {
    return 'mixed';
  }

  return 'typed';
}

export function quotaCoverageCounts(quotaDetails = []) {
  return {
    total: quotaDetails.length,
    typed: quotaDetails.filter((detail) => detailHasTypedUsage(detail)).length,
  };
}

function formatWindowLine(label, detail) {
  const remaining = formatUsageValue(detail.remaining, detail.interpretation);
  const used = formatUsageValue(detail.used, detail.interpretation);
  const resetAt = formatResetAt(detail.resetAt);
  const parts = [];

  if (remaining) {
    parts.push(`${remaining} remaining`);
  }
  if (used) {
    parts.push(`${used} used`);
  }
  if (resetAt) {
    parts.push(`resets ${resetAt}`);
  }

  if (parts.length === 0 && detail.notes) {
    parts.push(detail.notes);
  }

  return `${label}: ${parts.join(', ')}`;
}

export function quotaDisplayLines(quotaDetails = [], { headingLabel = 'quota model' } = {}) {
  const lines = [];

  for (const quota of quotaDetails) {
    lines.push(`${headingLabel}: ${quota.displayName}`);

    if ((quota.windows?.length ?? 0) > 0) {
      for (const window of quota.windows) {
        lines.push(`  ${formatWindowLine(window.label, window)}`);
      }
      continue;
    }

    if (quota.notes) {
      lines.push(`  note: ${quota.notes}`);
      continue;
    }

    lines.push(`  ${formatWindowLine('current window', quota)}`);
  }

  return lines;
}
