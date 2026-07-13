import { describe, expect, it } from "vitest";
import { isRtlLanguage } from "../src/index.js";

describe("@csf/client public exports", () => {
  it("re-exports isRtlLanguage from @csf/analysis (docs/reference/client-api.md)", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
  });
});
