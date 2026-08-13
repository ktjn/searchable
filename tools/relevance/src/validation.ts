/**
 * Shared structural-validation helpers for the relevance suite validators.
 *
 * Two flavors live here because the package's validators historically used
 * both:
 *
 * - **Errors-collecting** (`record`/`nonBlank`/`httpUrl`/`isoDate`): used by
 *   `validateSuite` and `validateDomainSuite`, which accumulate every
 *   problem into one `errors[]` and throw a single aggregated message at
 *   the end. Each helper returns a safe default (empty object / empty
 *   string) on failure so traversal can continue and report further
 *   problems.
 * - **Throwing** (`expectRecord`/`expectArray`/`expectString`): used by the
 *   GOV.UK refresh/normalize path and `domain-runner`, which fail fast on
 *   the first malformed value while reading external JSON.
 *
 * The two flavors are kept visually distinct (`expect*` vs the soft names)
 * so a future reader can't mistake one contract for the other at a call
 * site.
 */

export type UnknownRecord = Record<string, unknown>;

/**
 * Narrows `value` to an object record, pushing a message onto `errors` and
 * returning `{}` on failure so the caller can keep validating the rest of
 * the structure. Mirrors the historical `validate-suite`/
 * `validate-domain-suite` helper.
 */
export function record(
  value: unknown,
  path: string,
  errors: string[],
): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return {};
  }
  return value as UnknownRecord;
}

/** Requires a non-blank string; returns `""` on failure after recording the error. */
export function nonBlank(
  value: unknown,
  path: string,
  errors: string[],
): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-blank string`);
    return "";
  }
  return value;
}

/** Validates an HTTP(S) URL; records an error (no return value) on failure. */
export function httpUrl(value: unknown, path: string, errors: string[]): void {
  const text = nonBlank(value, path, errors);
  if (!text) return;
  try {
    if (!/^https?:$/.test(new URL(text).protocol)) throw new Error();
  } catch {
    errors.push(`${path} must be an HTTP(S) URL`);
  }
}

/** Validates a `YYYY-MM-DD` ISO date; records an error on failure. */
export function isoDate(value: unknown, path: string, errors: string[]): void {
  const text = nonBlank(value, path, errors);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    errors.push(`${path} must be a valid YYYY-MM-DD date`);
    return;
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text)
    errors.push(`${path} must be a valid YYYY-MM-DD date`);
}

/**
 * Narrows `value` to an object record, throwing on failure. Used where the
 * caller reads inherently-trusted JSON and wants to abort on the first
 * structural problem instead of accumulating errors. Mirrors the historical
 * `govuk-normalize`/`govuk-refresh`/`domain-runner` helper.
 */
export function expectRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as UnknownRecord;
}

/** Requires an array, throwing on failure. */
export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

/** Requires a string (any length, including empty), throwing on failure. */
export function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}
