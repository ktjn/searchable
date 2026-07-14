import { describe, expect, it } from "vitest";
import {
  BASELINE_CONFIG,
  SMOKE_CONFIG,
  validateConfig,
} from "../src/config.js";

describe("benchmark profiles", () => {
  it("pins the reviewed CMS-2k profile", () => {
    expect(BASELINE_CONFIG).toEqual({
      profile: "cms-2k",
      documentCount: 2000,
      warmupCount: 1,
      repeatCount: 10,
      requireCleanWorktree: true,
      headless: true,
    });
  });

  it("keeps smoke fast and non-publishing", () => {
    expect(SMOKE_CONFIG).toEqual({
      profile: "smoke",
      documentCount: 40,
      warmupCount: 1,
      repeatCount: 2,
      requireCleanWorktree: false,
      headless: true,
    });
  });

  it.each([
    [{ ...BASELINE_CONFIG, documentCount: 0 }, /documentCount/],
    [{ ...BASELINE_CONFIG, warmupCount: -1 }, /warmupCount/],
    [{ ...BASELINE_CONFIG, repeatCount: 0 }, /repeatCount/],
  ])("rejects invalid configuration %#", (value, message) => {
    expect(() => validateConfig(value)).toThrow(message);
  });
});
