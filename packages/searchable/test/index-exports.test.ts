import { describe, expect, it } from "vitest";
import { isRtlLanguage } from "../src/index.js";

describe("@ktjn/searchable public exports", () => {
  it("re-exports isRtlLanguage from ./analysis/index.js (docs/reference/client-api.md)", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
  });
});
