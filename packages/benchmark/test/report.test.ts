import { describe, expect, it, vi } from "vitest";
import {
  captureEnvironment,
  validateReport,
  writeReportAtomic,
} from "../src/report.js";
import { createReportFixture } from "./report-fixture.js";

describe("benchmark report validation", () => {
  it("captures the installed pnpm version on the host platform", async () => {
    const environment = await captureEnvironment(
      {
        profile: "smoke",
        documentCount: 40,
        warmupCount: 1,
        repeatCount: 2,
        requireCleanWorktree: false,
        headless: true,
      },
      "140",
    );
    expect(environment.pnpmVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("validates a complete schema-v1 report and its invariants", () => {
    const report = createReportFixture();
    const coldMeasurement = report.cold[0];
    if (!coldMeasurement) throw new Error("fixture must contain a cold query");
    expect(validateReport(report)).toBe(report);
    expect(() => validateReport({ ...report, schemaVersion: 2 })).toThrow(
      /schemaVersion/,
    );
    expect(() =>
      validateReport({
        ...report,
        warm: { ...report.warm, indexRequestCount: 1 },
      }),
    ).toThrow(/warm network/);
    expect(() =>
      validateReport({
        ...report,
        cold: [
          {
            ...coldMeasurement,
            firstQuery: { samples: [Number.NaN] },
          },
        ],
      }),
    ).toThrow(/finite/);
  });

  it("removes its temporary sibling when the atomic rename fails", async () => {
    const order: string[] = [];
    const writeFile = vi.fn(async () => order.push("write"));
    const rename = vi.fn(async () => {
      order.push("rename");
      throw new Error("rename failed");
    });
    const rm = vi.fn(async () => order.push("remove"));

    await expect(
      writeReportAtomic(createReportFixture(), "C:/reports/result.json", {
        writeFile,
        rename,
        rm,
        destinationExists: async () => false,
      }),
    ).rejects.toThrow("rename failed");
    expect(order).toEqual(["write", "rename", "remove"]);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/result\.json\..+\.tmp$/),
      expect.stringContaining('"schemaVersion": 1'),
      { flag: "wx" },
    );
  });
});
