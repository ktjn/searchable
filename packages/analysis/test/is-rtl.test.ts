import { describe, expect, it } from "vitest";
import { isRtlLanguage } from "../src/is-rtl.js";

describe("isRtlLanguage", () => {
  it("returns true for known RTL languages", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("he")).toBe(true);
    expect(isRtlLanguage("fa")).toBe(true);
    expect(isRtlLanguage("ur")).toBe(true);
  });

  it("returns false for LTR languages, including every registered LanguageProfile", () => {
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("de")).toBe(false);
    expect(isRtlLanguage("zh")).toBe(false);
    expect(isRtlLanguage("ja")).toBe(false);
  });

  it("compares only the primary subtag, ignoring region/script suffixes", () => {
    expect(isRtlLanguage("ar-EG")).toBe(true);
    expect(isRtlLanguage("he-IL")).toBe(true);
    expect(isRtlLanguage("en-US")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isRtlLanguage("AR")).toBe(true);
    expect(isRtlLanguage("He-IL")).toBe(true);
  });

  it("returns false for an empty or unknown code", () => {
    expect(isRtlLanguage("")).toBe(false);
    expect(isRtlLanguage("xx")).toBe(false);
  });
});
