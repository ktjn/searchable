import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { InvalidManifestError } from "../src/validate-manifest.js";
import { FakeWorker } from "../test-support/fake-worker.js";

const INDEX_URL = "https://example.com/index/manifest.json";
const WORKER_URL = "https://example.com/worker.js";

function makeClient(): SearchClient {
  return new SearchClient({
    indexUrl: INDEX_URL,
    worker: true,
    workerUrl: WORKER_URL,
  });
}

/** Flushes the microtask queue so an async search() call has posted its request before a test emits a scripted response. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("SearchClient fatal worker cleanup (#fail)", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.autoReply = false;
    FakeWorker.initScenario = { kind: "ok", protocolVersion: 2 };
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

  it("a Worker whose init returns InvalidManifestError is terminated, dereferenced, and becomes the client's fatal error", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = {
      kind: "error",
      shape: "new",
      error: {
        code: "INVALID_MANIFEST",
        name: "InvalidManifestError",
        message: "invalid manifest: unsupported version 2",
      },
    };
    const client = makeClient();
    const worker = FakeWorker.instances[0] as FakeWorker;

    await expect(client.ready()).rejects.toBeInstanceOf(InvalidManifestError);
    await expect(client.ready()).rejects.toThrow(/unsupported version 2/);
    expect(worker.terminated).toBe(true);

    // Future calls fail immediately with the same typed error -- no hang,
    // and no further postMessage against a dereferenced worker.
    const postedAtFailure = worker.posted.length;
    await expect(client.search("widgets")).rejects.toBeInstanceOf(
      InvalidManifestError,
    );
    await expect(client.search("widgets")).rejects.toThrow(
      /unsupported version 2/,
    );
    expect(worker.posted.length).toBe(postedAtFailure);
  });

  it("a Worker whose init returns an unknown domain error terminates it and preserves that error as fatal", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = {
      kind: "error",
      shape: "new",
      error: { code: "UNKNOWN", name: "Error", message: "init exploded" },
    };
    const client = makeClient();
    const worker = FakeWorker.instances[0] as FakeWorker;

    await expect(client.ready()).rejects.toThrow(/init exploded/);
    expect(worker.terminated).toBe(true);
    await expect(client.search("widgets")).rejects.toThrow(/init exploded/);
  });

  it("a legacy (version-1) Worker error payload rejects the caller instead of hanging the pending request", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = { kind: "ok", protocolVersion: "unset" };
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    await flush();
    worker.emit("message", {
      data: {
        type: "error",
        id: worker.lastSearchId(),
        message: "legacy worker boom",
      },
    });

    await expect(pending).rejects.toThrow(/legacy worker boom/);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("Error");
  });

  it("a legacy error on init (version-1 Worker) rejects ready() with a plain Error carrying the message", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = {
      kind: "error",
      shape: "legacy",
      message: "legacy init failure",
    };
    const client = makeClient();

    await expect(client.ready()).rejects.toThrow(/legacy init failure/);
    expect((FakeWorker.instances[0] as FakeWorker).terminated).toBe(true);
  });

  it("an unknown error code deserializes to a plain Error that keeps the worker-sent name and message", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    await flush();
    worker.emit("message", {
      data: {
        type: "error",
        id: worker.lastSearchId(),
        error: { code: "SOME_FUTURE_CODE", name: "FutureError", message: "x" },
      },
    });

    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("FutureError");
    expect((err as Error).message).toBe("x");
  });

  it("an error message with neither `error` nor `message` settles as an Unknown Worker error", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    await flush();
    worker.emit("message", {
      data: { type: "error", id: worker.lastSearchId() },
    });

    await expect(pending).rejects.toThrow(/Unknown Worker error/);
  });

  it("a malformed Worker message can never leave a pending request unresolved", async () => {
    FakeWorker.autoReply = true;
    const client = makeClient();
    await client.ready();
    const worker = FakeWorker.instances[0] as FakeWorker;

    const pending = client.search("widgets");
    await flush();

    // Not even an object as the message payload -- the handler must retire
    // the client fatally so the in-flight request (and any later one)
    // settles.
    worker.emit("message", { data: null });

    await expect(pending).rejects.toThrow();
    await expect(client.search("widgets")).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("a protocol-version mismatch on init fails clearly and terminates the Worker", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = { kind: "ok", protocolVersion: 3 };
    const client = makeClient();

    const err = await client.ready().catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/protocol version 3/);
    expect((err as Error).message).toMatch(/same package version/);
    expect((FakeWorker.instances[0] as FakeWorker).terminated).toBe(true);
    await expect(client.search("widgets")).rejects.toThrow(/protocol version/);
  });

  it("a pre-handshake Worker (no protocolVersion) is accepted and its requests work", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = { kind: "ok", protocolVersion: "unset" };
    const client = makeClient();

    await expect(client.ready()).resolves.toBeUndefined();
    expect((FakeWorker.instances[0] as FakeWorker).terminated).toBe(false);
  });

  it("dispose() after an init failure stays idempotent and does not replace the original fatal error", async () => {
    FakeWorker.autoReply = true;
    FakeWorker.initScenario = {
      kind: "error",
      shape: "new",
      error: {
        code: "INVALID_MANIFEST",
        name: "InvalidManifestError",
        message: "invalid manifest: nope",
      },
    };
    const client = makeClient();
    await client.ready().catch(() => undefined);

    expect(() => client.dispose()).not.toThrow();
    expect(() => client.dispose()).not.toThrow();

    // The init error -- not "SearchClient disposed" -- remains fatal.
    await expect(client.ready()).rejects.toThrow(/invalid manifest: nope/);
    await expect(client.search("widgets")).rejects.toThrow(
      /invalid manifest: nope/,
    );
  });
});
