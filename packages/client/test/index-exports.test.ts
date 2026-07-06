import { describe, expect, it } from "vitest";
import { isRtlLanguage } from "../src/index.js";

describe("@csf/client public exports", () => {
  it("re-exports isRtlLanguage from @csf/analysis (docs/08-modern-features.md#accessibility)", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
  });
});
