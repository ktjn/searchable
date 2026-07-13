import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DomainRelevanceSuite } from "./domain-schema.js";
import { validateDomainSuite } from "./validate-domain-suite.js";

export const KNOWN_DOMAIN_SUITES = ["searchable-docs"] as const;
export type KnownDomainSuite = (typeof KNOWN_DOMAIN_SUITES)[number];

export async function loadDomainSuite(
  directory: string,
  name: KnownDomainSuite,
): Promise<DomainRelevanceSuite> {
  if (!KNOWN_DOMAIN_SUITES.includes(name))
    throw new Error(`unknown domain suite: ${name}`);
  const suite = validateDomainSuite(
    JSON.parse(await readFile(join(directory, `${name}.json`), "utf8")),
  );
  if (suite.id !== name)
    throw new Error(`Domain fixture ${name}.json declares id ${suite.id}`);
  return suite;
}
