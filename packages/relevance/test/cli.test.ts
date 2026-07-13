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

  it.each([
    [["--unknown"], /unknown option/],
    [["--language"], /requires a value/],
    [["--language", "fr"], /unsupported language/],
    [["--k", "0"], /positive integer/],
    [["--k", "1.5"], /positive integer/],
  ])("rejects invalid arguments %#", (args, message) => {
    expect(() => parseCliArgs(args)).toThrow(message);
  });
});
