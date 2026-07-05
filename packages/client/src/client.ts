import type { Manifest } from "@csf/format";
import { ShardCache } from "./fetch-json.js";
import { search } from "./search.js";
import type { Hit, SearchOptions } from "./search.js";

export interface SearchClientOptions {
  indexUrl: string;
}

/**
 * Phase 1 minimal runtime: manifest + shard fetch over plain HTTP,
 * boolean AND + BM25F scoring, no Worker yet (docs/09-roadmap.md
 * Phase 1 vs Phase 2). Proves the shard-fetch-on-demand model end to
 * end; field boosts, facets, synonyms, pins, and worker execution are
 * additive layers that land in later phases without changing this
 * public API shape.
 */
export class SearchClient {
  #indexUrl: string;
  #cache = new ShardCache();
  #manifest: Promise<Manifest>;

  constructor(options: SearchClientOptions) {
    this.#indexUrl = options.indexUrl;
    this.#manifest = this.#cache.fetchJson<Manifest>(this.#indexUrl);
  }

  async ready(): Promise<void> {
    await this.#manifest;
  }

  async search(query: string, options: SearchOptions = {}): Promise<Hit[]> {
    const manifest = await this.#manifest;
    return search(query, manifest, this.#cache, this.#indexUrl, options);
  }
}
