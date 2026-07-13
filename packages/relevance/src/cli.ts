#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  KNOWN_DOMAIN_SUITES,
  type KnownDomainSuite,
} from "./load-domain-suite.js";
import { loadSuites } from "./load-suites.js";
import { renderConsoleReport, serializeJsonReport } from "./report.js";
import {
  SUPPORTED_BASELINE_LANGUAGES,
  type SupportedBaselineLanguage,
} from "./schema.js";
import { runSearchableSuite } from "./searchable-runner.js";

export interface CliOptions {
  language?: SupportedBaselineLanguage;
  suite?: KnownDomainSuite;
  k: number;
  json: boolean;
}

export function parseCliArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { k: 5, json: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--language") {
      const value = args[++index];
      if (!value) throw new Error("--language requires a value");
      if (!SUPPORTED_BASELINE_LANGUAGES.includes(value as never))
        throw new Error(`unsupported language: ${value}`);
      options.language = value as SupportedBaselineLanguage;
    } else if (arg === "--suite") {
      const value = args[++index];
      if (!value) throw new Error("--suite requires a value");
      if (!KNOWN_DOMAIN_SUITES.includes(value as never))
        throw new Error(`unknown domain suite: ${value}`);
      options.suite = value as KnownDomainSuite;
    } else if (arg === "--k") {
      const value = args[++index];
      if (!value) throw new Error("--k requires a value");
      const k = Number(value);
      if (!Number.isInteger(k) || k <= 0)
        throw new Error("--k must be a positive integer");
      options.k = k;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (options.suite && options.language)
    throw new Error("--suite and --language are mutually exclusive");
  return options;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(args);
  const fixtureDirectory = fileURLToPath(
    new URL("../fixtures/", import.meta.url),
  );
  const suites = await loadSuites(fixtureDirectory, options.language);
  const reports = [];
  for (const suite of suites)
    reports.push(await runSearchableSuite(suite, options.k));
  process.stdout.write(
    options.json
      ? serializeJsonReport(reports, options.k)
      : `${renderConsoleReport(reports)}\n`,
  );
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
