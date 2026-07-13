/**
 * Minimal fetch-and-cache helper. Deliberately just a Map (no LRU
 * eviction, no priority hints, no Worker) — those land with the
 * resource-aware-loading and Worker-execution phases; Phase 1 only
 * needs to prove the shard-fetch-on-demand model works at all.
 */
export class ShardCache {
  #cache = new Map<string, Promise<unknown>>();

  async fetchJson<T>(url: string): Promise<T> {
    let pending = this.#cache.get(url) as Promise<T> | undefined;
    if (!pending) {
      pending = fetch(url)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`failed to fetch ${url}: ${res.status}`);
          }
          return res.json() as Promise<T>;
        })
        .catch((err) => {
          // Don't let one failed fetch (e.g. a transient network blip)
          // permanently poison this URL for the rest of the session — a
          // later retry should get a fresh attempt, not the same cached
          // rejection forever (REVIEW.md#3).
          this.#cache.delete(url);
          throw err;
        });
      this.#cache.set(url, pending);
    }
    return pending;
  }

  /** Raw bytes, for binary-format term shards (docs/archive/specs/binary-format.md) -- same caching/eviction-on-failure behavior as `fetchJson`, just no JSON decode. */
  async fetchArrayBuffer(url: string): Promise<Uint8Array> {
    let pending = this.#cache.get(url) as Promise<Uint8Array> | undefined;
    if (!pending) {
      pending = fetch(url)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`failed to fetch ${url}: ${res.status}`);
          }
          return new Uint8Array(await res.arrayBuffer());
        })
        .catch((err) => {
          this.#cache.delete(url);
          throw err;
        });
      this.#cache.set(url, pending);
    }
    return pending;
  }
}
