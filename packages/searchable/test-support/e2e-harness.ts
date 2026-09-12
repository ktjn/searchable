import { afterAll, beforeAll } from "vitest";
import { serveStatic } from "../test/static-server.js";
import type {
  PythonBuildOptions,
  PythonSourceDocument,
  PythonStructuredDocument,
  PythonWriteOptions,
} from "./python-index.js";
import { writePythonIndex } from "./python-index.js";

export interface IndexServerHandle {
  /**
   * Only assigned once `beforeAll` has run -- read these from inside
   * `it()`/nested `beforeAll()`/`describe()` callbacks, never at
   * describe-body eval time (the same restriction vitest's own
   * `beforeAll`-populated variables have).
   */
  readonly baseUrl: string;
  readonly outDir: string;
  /**
   * Every request path served so far, in order. Mutate in place (e.g.
   * `handle.requestedPaths.length = 0`) to reset between assertions
   * within one test -- it's the same array `serveDirectory()` returned,
   * not a snapshot.
   */
  readonly requestedPaths: string[];
}

function readyOrThrow<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(
      `IndexServerHandle.${name} was read before beforeAll ran -- ` +
        "access it from inside it()/beforeAll(), not describe-body eval time.",
    );
  }
  return value;
}

/**
 * Registers the beforeAll/afterAll pair almost every e2e.test.ts describe
 * block used to hand-roll: build a real index from `sources` via the
 * Python builder (the project's only index generator), serve it over
 * plain HTTP, and tear both down after the suite. Must be called directly
 * inside a `describe()` body -- it calls vitest's own `beforeAll`/
 * `afterAll` under the hood, same restriction those have.
 *
 * Malformed/edge-case manifests (deliberately broken JSON, corrupt
 * shards, wrong types) are intentionally NOT built through this helper --
 * those exact bytes/shapes are the behavior under test, so they stay
 * hand-written inline (see the "manifest validation" describe block).
 */
export function setupIndexServer(
  sources: Array<PythonSourceDocument | PythonStructuredDocument>,
  buildOptions?: PythonBuildOptions,
  writeOptions?: PythonWriteOptions,
): IndexServerHandle {
  let baseUrl: string | undefined;
  let outDir: string | undefined;
  let requestedPaths: string[] | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const built = await writePythonIndex(sources, buildOptions, writeOptions);
    outDir = built.outDir;
    cleanup = built.cleanup;
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    requestedPaths = server.requestedPaths;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer?.();
    await cleanup?.();
  });

  return {
    get baseUrl() {
      return readyOrThrow(baseUrl, "baseUrl");
    },
    get outDir() {
      return readyOrThrow(outDir, "outDir");
    },
    get requestedPaths() {
      return readyOrThrow(requestedPaths, "requestedPaths");
    },
  };
}
