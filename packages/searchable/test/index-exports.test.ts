import { describe, expect, it } from "vitest";
import type { GeoFilter } from "../src/index.js";
import { isRtlLanguage } from "../src/index.js";

describe("@ktjn/searchable public exports", () => {
  it("re-exports isRtlLanguage from ./analysis/index.js (docs/reference/client-api.md)", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
  });

  it("exports GeoFilter as part of the public SearchOptions surface", () => {
    const filter: GeoFilter = { lat: 59.3293, lon: 18.0686, radiusKm: 10 };
    expect(filter.radiusKm).toBe(10);
  });
});
