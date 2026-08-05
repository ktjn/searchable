/**
 * Minimal URL resolution helper: always resolves `relPath` against
 * `baseUrl` regardless of scheme. Shared by every search module (and the
 * service-worker search path) so a single definition is used.
 */
export function resolve(baseUrl: string, relPath: string): string {
  return new URL(relPath, baseUrl).toString();
}
