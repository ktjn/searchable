import type { LanguageProfile } from "./language-profile.js";
import {
  chinese,
  english,
  german,
  japanese,
  khmer,
  lao,
  thai,
} from "./language-profile.js";
import { ownProp } from "./safe-dict.js";

/**
 * The one place indexer and runtime both look up a LanguageProfile by
 * code, so "is language X supported" and "which profile does X get"
 * can never answer differently on the two sides (docs/guides/internationalization.md).
 */
const PROFILES: Record<string, LanguageProfile> = {
  en: english,
  de: german,
  zh: chinese,
  ja: japanese,
  th: thai,
  km: khmer,
  lo: lao,
};

export function getLanguageProfile(code: string): LanguageProfile {
  // ownProp(), not a bare `PROFILES[code]` truthy check: `code` is
  // ultimately attacker/content-controlled (a document's own `<html
  // lang="...">` attribute, per extract.ts) -- a bare index lookup is
  // fooled by the prototype chain for a code like "constructor" or
  // "toString", silently returning the *inherited* `Object.prototype`
  // member instead of `undefined`, so this function would return a
  // bogus non-`LanguageProfile` object instead of throwing the clear
  // "unsupported language" error every other unregistered code
  // correctly gets -- every caller downstream then crashes confusingly
  // trying to call e.g. `profile.tokenize(...)` on it instead.
  const profile = ownProp(PROFILES, code);
  if (!profile) {
    throw new Error(`no LanguageProfile registered for "${code}"`);
  }
  return profile;
}

/** Every language code with a registered `LanguageProfile` -- the candidate set `detectLanguage()` chooses among when a document declares none of its own (`packages/indexer/src/extract.ts`). */
export function getRegisteredLanguageCodes(): string[] {
  return Object.keys(PROFILES);
}
