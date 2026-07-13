#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { runGeneratedDomainSuite } from "./domain-runner.js";
import type { DomainRelevanceSuite } from "./domain-schema.js";
import type { SuiteReport } from "./evaluate.js";
import {
  KNOWN_DOMAIN_SUITES,
  type KnownDomainSuite,
  loadDomainSuite,
} from "./load-domain-suite.js";
import { loadSuites } from "./load-suites.js";
import { prepareShowcase } from "./prepare-showcase.js";
import { renderConsoleReport, serializeJsonReport } from "./report.js";
import {
  type RelevanceSuite,
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

export interface CliDependencies {
  prepareShowcase(): Promise<void>;
  loadBaselines(
    language?: SupportedBaselineLanguage,
  ): Promise<RelevanceSuite[]>;
  loadDomain(name: KnownDomainSuite): Promise<DomainRelevanceSuite>;
  runBaseline(suite: RelevanceSuite, k: number): Promise<SuiteReport>;
  runDomain(suite: DomainRelevanceSuite, k: number): Promise<SuiteReport>;
  writeOutput(text: string): void;
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

const fixtureDirectory = fileURLToPath(
  new URL("../fixtures/", import.meta.url),
);
const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);
const showcaseDistDirectory = fileURLToPath(
  new URL("../../../showcase/dist/", import.meta.url),
);

export const defaultCliDependencies: CliDependencies = {
  prepareShowcase,
  loadBaselines: (language) => loadSuites(fixtureDirectory, language),
  loadDomain: (name) => loadDomainSuite(domainFixtureDirectory, name),
  runBaseline: runSearchableSuite,
  runDomain: (suite, k) =>
    runGeneratedDomainSuite(suite, showcaseDistDirectory, k),
  writeOutput: (value) => process.stdout.write(value),
};

export async function main(
  args = process.argv.slice(2),
  dependencies = defaultCliDependencies,
): Promise<void> {
  const options = parseCliArgs(args);
  const reports: SuiteReport[] = [];
  if (options.suite) {
    await dependencies.prepareShowcase();
    reports.push(
      await dependencies.runDomain(
        await dependencies.loadDomain(options.suite),
        options.k,
      ),
    );
  } else {
    for (const suite of await dependencies.loadBaselines(options.language))
      reports.push(await dependencies.runBaseline(suite, options.k));
  }
  dependencies.writeOutput(
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
