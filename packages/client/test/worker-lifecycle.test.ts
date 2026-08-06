import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import type { WorkerRequest } from "../src/worker-protocol.js";

/**
 * A minimal scriptable stand-in for a DedicatedWorkerGlobalScope so the
 * worker-lifecycle contract (dispose()/error/messageerror) can be tested
 * in plain Node without a real browser. It records every postMessage,
 * exposes addEventListener-based emit(), and can be told to auto-reply to
 * init requests the way the real worker would so `ready()` can resolve.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static autoReply = false;

  listeners = new Map<string, Set<(event: unknown) => void>>();
  posted: Array<WorkerRequest> = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: object): void {
    this.posted.push(message as WorkerRequest);
    const msg = message as WorkerRequest;
    if (FakeWorker.autoReply && msg.type === "init") {
      setTimeout(() => {
        if (this.terminated) return;
        this.emit("message", {
          data: {
            type: "result",
            id: msg.id,
            result: { hits: [], totalHits: 0, language: "en" },
          },
        });
      }, 0);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(type: string, event: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      handler(event);
    }
  }
}

const INDEX_URL = "https://example.com/index/manifest.json";
const WORKER_URL = "https://example.com/worker.js";

function makeClient(): SearchClient {
  return new SearchClient({
    indexUrl: INDEX_URL,
    worker: true,
    workerUrl: WORKER_URL,
  });
}

describe("SearchClient fatal worker cleanup (#fail)", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.autoReply = false;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  });

  afterEach(() => {
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  it("dispose() before ready() rejects ready and every later call, and never posts", async () => {
    const client = makeClient();
    const worker = FakeWorker.instances[0] as FakeWorker | undefined;

    client.dispose();

    await expect(client.ready()).rejects.toThrow(/disposed/);
    await expect(client.search("widgets")).rejects.toThrow(/disposed/);
    await expect(client.facetValues("category")).rejects.toThrow(/disposed/);
    expect(worker?.terminated).toBe(true);
    const postedAtDisposal = worker?.posted.length ?? 0;
    await client.search("widgets").catch(() => undefined);
    expect(worker?.posted.length).toBe(postedAtDisposal);
  });

  it("dispose() during an in-flight request rejects that request exactly once", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    const postedAtSearch = worker.posted.length;
    client.dispose();

    await expect(pending).rejects.toThrow(/disposed/);
    expect(worker.terminated).toBe(true);
    // Nothing further is posted (the worker reference is already dropped)
    // and a fresh call also fails immediately instead of re-posting.
    await expect(client.search("widgets")).rejects.toThrow(/disposed/);
    expect(worker.posted.length).toBe(postedAtSearch);
  });

  it("a worker 'error' event terminates the worker, drops the reference, and rejects pending + future calls", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    worker.emit("error", { message: "worker exploded" });

    await expect(pending).rejects.toThrow(/worker exploded/);
    await expect(client.search("widgets")).rejects.toThrow(/worker exploded/);
    expect(worker.terminated).toBe(true);
  });

  it("a worker 'messageerror' event (which need not terminate the worker itself) still drops the reference and rejects everything", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    worker.emit("messageerror", {});

    await expect(pending).rejects.toThrow(/deserialized/);
    await expect(client.search("widgets")).rejects.toThrow(/deserialized/);
    expect(worker.terminated).toBe(true);
  });

  it("dispose() after a fatal worker error keeps the original, more specific error", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    worker.emit("error", { message: "specific worker failure" });
    const pending = client.search("widgets");
    client.dispose(); // must not shadow the earlier fatal error with "disposed"

    await expect(pending).rejects.toThrow(/specific worker failure/);
    await expect(client.search("widgets")).rejects.toThrow(
      /specific worker failure/,
    );
  });

  it("repeated dispose() is safe and stays idempotent", async () => {
    const client = makeClient();
    // Dispose before the constructor's own init promise is observed -- the
    // test still watches ready() so its rejection can't surface as an
    // unrelated unhandled rejection.
    client.ready().catch(() => {});
    client.dispose();
    expect(() => client.dispose()).not.toThrow();
    expect(() => client.dispose()).not.toThrow();
    await expect(client.search("widgets")).rejects.toThrow(/disposed/);
  });

  it("leaves no pending request unresolved: a search against an errored worker settles, and so does one after dispose", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    // A request dispatched just before the fatal error rejects with it.
    const inFlight = client.search("widgets");
    worker.emit("messageerror", {});
    await expect(inFlight).rejects.toThrow(/deserialized/);

    // A request dispatched after disposal rejects straight away too.
    client.dispose();
    await expect(client.search("widgets")).rejects.toThrow(/deserialized/);
  });
});
