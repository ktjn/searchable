import { english } from "./language-profile.js";
import type { LanguageProfile } from "./language-profile.js";

/**
 * The one place indexer and runtime both look up a LanguageProfile by
 * code, so "is language X supported" and "which profile does X get"
 * can never answer differently on the two sides (docs/03).
 */
const PROFILES: Record<string, LanguageProfile> = { en: english };

export function getLanguageProfile(code: string): LanguageProfile {
  const profile = PROFILES[code];
  if (!profile) {
    throw new Error(`no LanguageProfile registered for "${code}"`);
  }
  return profile;
}
