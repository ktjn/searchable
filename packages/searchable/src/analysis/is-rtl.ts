/**
 * BCP-47 primary language subtags of scripts written right-to-left --
 * enough for a consuming app to set `dir="rtl"` on rendered results
 * (docs/guides/internationalization.md#segmentation, docs/reference/client-api.md).
 * Deliberately just this one predicate, not a `LanguageProfile` for any
 * of these languages -- no RTL `LanguageProfile` (Arabic/Hebrew
 * stemming, segmentation) is built yet, but a consuming app still needs
 * to know a result set's script direction today for whatever language
 * *is* actually indexed, including a caller-registered custom profile
 * for one of these codes. RTL *layout* itself (the actual DOM/CSS work)
 * stays a consuming-app responsibility -- this is the one small,
 * stable, deterministic fact the core library can hand over, not a
 * step toward building a UI framework.
 */
const RTL_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  "ar", // Arabic
  "he", // Hebrew
  "fa", // Persian/Farsi
  "ur", // Urdu
  "ps", // Pashto
  "sd", // Sindhi
  "yi", // Yiddish
  "dv", // Divehi
  "ku", // Kurdish (Sorani, written in Arabic script)
  "ckb", // Central Kurdish (Sorani)
]);

/**
 * Whether `code` (a BCP-47 language tag, e.g. `"ar"`, `"ar-EG"`,
 * `"he"`) is a right-to-left script -- compares only the primary
 * subtag (before the first `-`), so region/script suffixes don't need
 * to be stripped by the caller first.
 */
export function isRtlLanguage(code: string): boolean {
  const primarySubtag = code.split("-")[0]?.toLowerCase() ?? "";
  return RTL_LANGUAGE_CODES.has(primarySubtag);
}
