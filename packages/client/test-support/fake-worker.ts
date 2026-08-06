import type {
  SerializedWorkerError,
  WorkerRequest,
  WorkerResponse,
} from "../../client/src/worker-protocol.js";

/**
 * How a scripted `FakeWorker` answers `init`, letting lifecycle, protocol,
 * and cancellation tests drive every terminal outcome deterministically
 * (no browser, no network, no time-based sleeps).
 */
export type InitScenario =
  | {
      kind: "ok";
      /** `"unset"` simulates a pre-handshake (version 1) Worker. */
      protocolVersion: number | "unset";
    }
  | {
      kind: "error";
      shape: "new" | "legacy";
      error?: SerializedWorkerError;
      message?: string;
    };

/**
 * A minimal scriptable stand-in for a DedicatedWorkerGlobalScope so the
 * worker-lifecycle and protocol contracts (dispose()/error/messageerror,
 * init failures, legacy vs current error payloads, pending-init aborts)
 * can be tested in plain Node without a real browser. It records every
 * postMessage, exposes addEventListener-based emit(), and can be told to
 * auto-reply to init requests the way the real worker would so `ready()`
 * can resolve.
 */
export class FakeWorker {
  static instances: FakeWorker[] = [];
  static autoReply = false;
  static initScenario: InitScenario = { kind: "ok", protocolVersion: 2 };

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
        const scenario = FakeWorker.initScenario;
        let data: WorkerResponse;
        if (scenario.kind === "error") {
          data =
            scenario.shape === "legacy"
              ? {
                  type: "error",
                  id: msg.id,
                  message: scenario.message ?? "worker error",
                }
              : {
                  type: "error",
                  id: msg.id,
                  error: scenario.error ?? {
                    code: "UNKNOWN",
                    name: "Error",
                    message: scenario.message ?? "worker error",
                  },
                };
        } else if (scenario.protocolVersion === "unset") {
          data = {
            type: "result",
            id: msg.id,
            result: { hits: [], totalHits: 0, language: "en" },
          };
        } else {
          data = {
            type: "result",
            id: msg.id,
            result: { protocolVersion: scenario.protocolVersion },
          };
        }
        this.emit("message", { data });
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

  /** The request id recorded for the worker's most recent search message, if any. */
  lastSearchId(): number | undefined {
    return [...this.posted].reverse().find((m) => m.type === "search")?.id;
  }

  /** Replies to the client as if it received a current-protocol init result from the real worker (for tests that hold init pending while autoReply is off). */
  replyInitResult(protocolVersion = 2): void {
    const initMsg = this.posted.find((m) => m.type === "init");
    if (!initMsg) throw new Error("no init request recorded");
    this.emit("message", {
      data: {
        type: "result",
        id: initMsg.id,
        result: { protocolVersion },
      },
    });
  }
}
