#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type RefreshOptions,
  refreshGovukSuite,
  type SnapshotComparison,
} from "./govuk-refresh.js";

export interface RefreshCliOptions {
  suite: "govuk-learn-to-drive";
  mode: "check" | "write";
  version?: string;
  sourceCreditAudit?: boolean;
}

export interface RefreshCliDependencies {
  refresh(options: RefreshOptions): Promise<SnapshotComparison>;
  writeOutput(text: string): void;
  setExitCode(code: number): void;
}

export function parseRefreshArgs(args: readonly string[]): RefreshCliOptions {
  let suite: string | undefined;
  let version: string | undefined;
  let checkCount = 0;
  let writeCount = 0;
  let sourceCreditAudit = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--suite") {
      const value = args[++index];
      if (!value) throw new Error("--suite requires a value");
      suite = value;
    } else if (arg === "--check") {
      checkCount++;
    } else if (arg === "--write") {
      writeCount++;
    } else if (arg === "--version") {
      const value = args[++index];
      if (!value) throw new Error("--version requires a value");
      version = value;
    } else if (arg === "--source-credit-audit") {
      sourceCreditAudit = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (!suite) throw new Error("--suite is required");
  if (suite !== "govuk-learn-to-drive")
    throw new Error(`unsupported refresh suite: ${suite}`);
  if (checkCount + writeCount !== 1)
    throw new Error("exactly one of --check or --write is required");
  const mode = checkCount === 1 ? "check" : "write";
  if (mode === "check" && version)
    throw new Error("--version is only valid with --write");
  if (mode === "check" && sourceCreditAudit)
    throw new Error("--source-credit-audit is only valid with --write");
  if (mode === "write" && !version)
    throw new Error("--version is required with --write");
  if (mode === "write" && !sourceCreditAudit)
    throw new Error("--source-credit-audit is required with --write");

  return {
    suite,
    mode,
    ...(version ? { version } : {}),
    ...(sourceCreditAudit ? { sourceCreditAudit: true } : {}),
  };
}

const fixturePath = fileURLToPath(
  new URL("../fixtures/domains/govuk-learn-to-drive.json", import.meta.url),
);

export const defaultRefreshCliDependencies: RefreshCliDependencies = {
  refresh: refreshGovukSuite,
  writeOutput: (text) => process.stdout.write(text),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

function renderChanges(comparison: SnapshotComparison): string[] {
  return [
    ...comparison.addedRoutes.map((route) => `added ${route}`),
    ...comparison.removedRoutes.map((route) => `removed ${route}`),
    ...comparison.changedRoutes.map((route) => `changed ${route}`),
  ];
}

export async function main(
  args = process.argv.slice(2),
  dependencies = defaultRefreshCliDependencies,
): Promise<void> {
  const options = parseRefreshArgs(args);
  const comparison = await dependencies.refresh({
    mode: options.mode,
    fixturePath,
    ...(options.version ? { version: options.version } : {}),
    ...(options.sourceCreditAudit ? { sourceCreditAudit: true } : {}),
  });
  const changes = renderChanges(comparison);
  if (options.mode === "check") {
    const hasDrift = changes.length > 0;
    dependencies.writeOutput(
      `${[...changes, hasDrift ? "snapshot drift detected" : "no snapshot drift"].join("\n")}\n`,
    );
    if (hasDrift) dependencies.setExitCode(1);
  } else {
    dependencies.writeOutput(
      `${[...changes, `snapshot updated to ${options.version}`].join("\n")}\n`,
    );
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
