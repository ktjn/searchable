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
      pending = fetch(url).then((res) => {
        if (!res.ok) {
          throw new Error(`failed to fetch ${url}: ${res.status}`);
        }
        return res.json() as Promise<T>;
      });
      this.#cache.set(url, pending);
    }
    return pending;
  }
}
