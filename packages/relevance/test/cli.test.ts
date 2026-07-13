import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("uses all-language defaults", () => {
    expect(parseCliArgs([])).toEqual({ k: 5, json: false });
  });

  it("parses language, cutoff, and JSON output", () => {
    expect(parseCliArgs(["--language", "sv", "--k", "10", "--json"])).toEqual({
      language: "sv",
      k: 10,
      json: true,
    });
  });

  it("parses a known domain suite", () => {
    expect(parseCliArgs(["--suite", "searchable-docs", "--json"])).toEqual({
      suite: "searchable-docs",
      k: 5,
      json: true,
    });
  });

  it("rejects simultaneous suite and language selectors", () => {
    expect(() =>
      parseCliArgs(["--suite", "searchable-docs", "--language", "en"]),
    ).toThrow(/mutually exclusive/);
  });

  it.each([
    [["--unknown"], /unknown option/],
    [["--language"], /requires a value/],
    [["--language", "fr"], /unsupported language/],
    [["--suite"], /requires a value/],
    [["--suite", "missing"], /unknown domain suite/],
    [["--k", "0"], /positive integer/],
    [["--k", "1.5"], /positive integer/],
  ])("rejects invalid arguments %#", (args, message) => {
    expect(() => parseCliArgs(args)).toThrow(message);
  });
});
