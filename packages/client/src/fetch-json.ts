/**
 * Minimal fetch-and-cache helper. Deliberately just a pair of Maps (no LRU
 * eviction, no priority hints, no Worker). JSON responses
 * are cached in separate maps keyed by URL, so the same URL can
 * never collide across representations: a JSON term shard
 * served from `shards` entries point at different files in
 * practice, but a manifest pointing the same file at two entries must not
 * serve one representation's cached promise as the other's type. Failure
 * eviction is likewise representation-specific.
 */
export class ShardCache {
  #jsonCache = new Map<string, Promise<unknown>>();

  async fetchJson<T>(url: string): Promise<T> {
    let pending = this.#jsonCache.get(url) as Promise<T> | undefined;
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
          this.#jsonCache.delete(url);
          throw err;
        });
      this.#jsonCache.set(url, pending);
    }
    return pending;
  }
}
