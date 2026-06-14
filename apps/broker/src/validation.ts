type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, context: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object.`);
  }

  return value;
}

export function assertKnownKeys(record: JsonRecord, allowed: readonly string[], context: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new Error(`${context}.${key} is not allowed.`);
    }
  }
}

export function expectString(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${context} must be a string.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${context} must not be empty.`);
  }

  return normalized;
}

export function expectOptionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, context);
}

export function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${context} must be a boolean.`);
  }

  return value;
}

export function expectArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array.`);
  }

  return value;
}

export function expectStringArray(value: unknown, context: string): string[] {
  return expectArray(value, context).map((entry, index) => expectString(entry, `${context}[${index}]`));
}

export function expectOptionalNumber(value: unknown, context: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${context} must be a number.`);
  }

  return value;
}

export function expectNumber(value: unknown, context: string): number {
  const parsed = expectOptionalNumber(value, context);
  if (parsed === undefined) {
    throw new Error(`${context} must be a number.`);
  }

  return parsed;
}

export function expectEnum<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  const normalized = expectString(value, context);
  if (!allowed.includes(normalized as T)) {
    throw new Error(`${context} must be one of ${allowed.join(', ')}.`);
  }

  return normalized as T;
}

export function expectIdentifier(value: unknown, context: string): string {
  const normalized = expectString(value, context);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(normalized)) {
    throw new Error(`${context} must use only letters, numbers, dashes, or underscores.`);
  }

  return normalized;
}
