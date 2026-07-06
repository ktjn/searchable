import { chinese, english, german, japanese } from "./language-profile.js";
import type { LanguageProfile } from "./language-profile.js";

/**
 * The one place indexer and runtime both look up a LanguageProfile by
 * code, so "is language X supported" and "which profile does X get"
 * can never answer differently on the two sides (docs/03).
 */
const PROFILES: Record<string, LanguageProfile> = {
  en: english,
  de: german,
  zh: chinese,
  ja: japanese,
};

export function getLanguageProfile(code: string): LanguageProfile {
  const profile = PROFILES[code];
  if (!profile) {
    throw new Error(`no LanguageProfile registered for "${code}"`);
  }
  return profile;
}

/** Every language code with a registered `LanguageProfile` -- the candidate set `detectLanguage()` chooses among when a document declares none of its own (`packages/indexer/src/extract.ts`). */
export function getRegisteredLanguageCodes(): string[] {
  return Object.keys(PROFILES);
}
