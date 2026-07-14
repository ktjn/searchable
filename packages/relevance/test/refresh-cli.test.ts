import { describe, expect, it, vi } from "vitest";
import {
  main,
  parseRefreshArgs,
  type RefreshCliDependencies,
} from "../src/refresh-cli.js";

describe("parseRefreshArgs", () => {
  it("parses check mode", () => {
    expect(
      parseRefreshArgs(["--suite", "govuk-learn-to-drive", "--check"]),
    ).toEqual({ suite: "govuk-learn-to-drive", mode: "check" });
  });

  it("parses an explicitly audited write", () => {
    expect(
      parseRefreshArgs([
        "--suite",
        "govuk-learn-to-drive",
        "--write",
        "--version",
        "1.1.0",
        "--source-credit-audit",
      ]),
    ).toEqual({
      suite: "govuk-learn-to-drive",
      mode: "write",
      version: "1.1.0",
      sourceCreditAudit: true,
    });
  });

  it.each([
    [[], /--suite is required/],
    [["--suite", "other", "--check"], /unsupported refresh suite/],
    [["--suite", "govuk-learn-to-drive"], /exactly one of --check or --write/],
    [
      ["--suite", "govuk-learn-to-drive", "--check", "--write"],
      /exactly one of --check or --write/,
    ],
    [
      ["--suite", "govuk-learn-to-drive", "--check", "--version", "1.0.0"],
      /--version is only valid with --write/,
    ],
    [
      ["--suite", "govuk-learn-to-drive", "--check", "--source-credit-audit"],
      /source-credit-audit is only valid with --write/,
    ],
    [
      ["--suite", "govuk-learn-to-drive", "--write"],
      /--version is required with --write/,
    ],
    [
      ["--suite", "govuk-learn-to-drive", "--write", "--version", "1.0.0"],
      /--source-credit-audit is required/,
    ],
    [
      ["--suite", "govuk-learn-to-drive", "--check", "--unknown"],
      /unknown option/,
    ],
  ])("rejects invalid arguments %#", (args, message) => {
    expect(() => parseRefreshArgs(args)).toThrow(message);
  });
});

function dependencies(result: {
  addedRoutes: string[];
  removedRoutes: string[];
  changedRoutes: string[];
}): RefreshCliDependencies {
  return {
    refresh: vi.fn(async () => result),
    writeOutput: vi.fn(),
    setExitCode: vi.fn(),
  };
}

describe("refresh CLI main", () => {
  it("reports clean check mode without a failure exit", async () => {
    const target = dependencies({
      addedRoutes: [],
      removedRoutes: [],
      changedRoutes: [],
    });
    await main(["--suite", "govuk-learn-to-drive", "--check"], target);

    expect(target.refresh).toHaveBeenCalledWith({
      mode: "check",
      fixturePath: expect.stringMatching(/govuk-learn-to-drive\.json$/),
    });
    expect(target.writeOutput).toHaveBeenCalledWith("no snapshot drift\n");
    expect(target.setExitCode).not.toHaveBeenCalled();
  });

  it("lists drift and sets check mode exit code 1", async () => {
    const target = dependencies({
      addedRoutes: ["/added"],
      removedRoutes: ["/removed"],
      changedRoutes: ["/changed"],
    });
    await main(["--suite", "govuk-learn-to-drive", "--check"], target);

    expect(target.writeOutput).toHaveBeenCalledWith(
      "added /added\nremoved /removed\nchanged /changed\nsnapshot drift detected\n",
    );
    expect(target.setExitCode).toHaveBeenCalledWith(1);
  });

  it("reports the written version", async () => {
    const target = dependencies({
      addedRoutes: [],
      removedRoutes: [],
      changedRoutes: ["/changed"],
    });
    await main(
      [
        "--suite",
        "govuk-learn-to-drive",
        "--write",
        "--version",
        "1.1.0",
        "--source-credit-audit",
      ],
      target,
    );

    expect(target.refresh).toHaveBeenCalledWith({
      mode: "write",
      fixturePath: expect.stringMatching(/govuk-learn-to-drive\.json$/),
      version: "1.1.0",
      sourceCreditAudit: true,
    });
    expect(target.writeOutput).toHaveBeenCalledWith(
      "changed /changed\nsnapshot updated to 1.1.0\n",
    );
  });
});
