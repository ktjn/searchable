import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type RelevanceSuite,
  SUPPORTED_BASELINE_LANGUAGES,
  type SupportedBaselineLanguage,
} from "./schema.js";
import { validateSuite } from "./validate-suite.js";

export async function loadSuites(
  directory: string,
  selectedLanguage?: SupportedBaselineLanguage,
): Promise<RelevanceSuite[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const suites: RelevanceSuite[] = [];
  for (const name of names) {
    const language = name.slice(0, -5);
    if (selectedLanguage && language !== selectedLanguage) continue;
    const suite = validateSuite(
      JSON.parse(await readFile(join(directory, name), "utf8")),
    );
    if (suite.language !== language)
      throw new Error(`Fixture ${name} declares language ${suite.language}`);
    suites.push(suite);
  }
  const required = selectedLanguage
    ? [selectedLanguage]
    : [...SUPPORTED_BASELINE_LANGUAGES];
  for (const language of required) {
    const count = suites.filter((suite) => suite.language === language).length;
    if (count !== 1)
      throw new Error(`Expected exactly one ${language} suite, found ${count}`);
  }
  const order = new Map(
    SUPPORTED_BASELINE_LANGUAGES.map((language, index) => [language, index]),
  );
  return suites.sort(
    (left, right) =>
      (order.get(left.language) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.language) ?? Number.MAX_SAFE_INTEGER),
  );
}
