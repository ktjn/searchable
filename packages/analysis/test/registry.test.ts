import { describe, expect, it } from "vitest";
import {
  getLanguageProfile,
  getRegisteredLanguageCodes,
  norwegian,
  norwegianBokmal,
  norwegianNynorsk,
} from "../src/index.js";

describe("language profile registry", () => {
  it("registers Nordic and Dutch language codes", () => {
    expect(getRegisteredLanguageCodes()).toEqual([
      "en",
      "de",
      "sv",
      "nl",
      "nb",
      "nn",
      "no",
      "zh",
      "ja",
      "th",
      "km",
      "lo",
    ]);
  });

  it("keeps all Norwegian codes explicit while sharing stemming", () => {
    expect(getLanguageProfile("nb")).toBe(norwegianBokmal);
    expect(getLanguageProfile("nn")).toBe(norwegianNynorsk);
    expect(getLanguageProfile("no")).toBe(norwegian);
    expect(norwegianBokmal.stem).toBe(norwegianNynorsk.stem);
    expect(norwegian.stem).toBe(norwegianBokmal.stem);
  });
});
