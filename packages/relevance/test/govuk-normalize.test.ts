import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashSnapshotContent,
  htmlToText,
  normalizeGovukDocument,
} from "../src/govuk-normalize.js";

function item(
  schemaName: string,
  details: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    schema_name: schemaName,
    base_path: "/example",
    title: "Shared title",
    description: "Shared description",
    details,
    ...overrides,
  };
}

describe("htmlToText", () => {
  it("preserves block boundaries and decodes named entities", () => {
    expect(
      htmlToText("<p>Eyesight &amp; rules</p><ul><li>20 metres</li></ul>"),
    ).toBe("Eyesight & rules\n20 metres");
  });

  it("decodes non-breaking spaces and numeric entities", () => {
    expect(htmlToText("<p>A&nbsp;B &#x2019; C &#39;</p>")).toBe("A B ’ C '");
  });

  it("removes comments, scripts, styles, tags, and unstable whitespace", () => {
    expect(
      htmlToText(
        "<!-- hidden --><style>.x { color: red }</style><h2>  First\r\n heading </h2><script>bad()</script><div>Second\t line<br/>Third</div>\n\n\n<p>Fourth</p>",
      ),
    ).toBe("First heading\nSecond line\nThird\nFourth");
  });

  it("rejects unknown named entities", () => {
    expect(() => htmlToText("A &copy; B")).toThrow(/unknown HTML entity copy/);
  });
});

describe("hashSnapshotContent", () => {
  it("hashes canonical normalized content as UTF-8 SHA-256", () => {
    const document = {
      id: "/example",
      url: "https://www.gov.uk/example",
      title: "Title",
      description: "Description",
      body: "Line one\nLine two",
      contentHash: "",
    };
    const expected = createHash("sha256")
      .update("Title\nDescription\nLine one\nLine two", "utf8")
      .digest("hex");
    expect(hashSnapshotContent(document)).toBe(expected);
  });
});

describe("normalizeGovukDocument", () => {
  it("normalizes step-by-step introductions, steps, and internal-link context", () => {
    const document = normalizeGovukDocument(
      "/learn-to-drive-a-car",
      item(
        "step_by_step_nav",
        {
          step_by_step_nav: {
            introduction: "<p>Start here</p>",
            steps: [
              {
                title: "Step one",
                contents: [
                  { type: "paragraph", text: "<p>Check rules</p>" },
                  {
                    type: "list",
                    contents: [
                      {
                        href: "/rules",
                        text: "Read rules",
                        context: "Before applying",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        { base_path: "/learn-to-drive-a-car" },
      ),
    );
    expect(document.body).toBe(
      "Start here\nStep one\nCheck rules\nRead rules\nBefore applying",
    );
  });

  it("normalizes answer body", () => {
    expect(
      normalizeGovukDocument(
        "/example",
        item("answer", { body: "<p>Direct answer</p>" }),
      ).body,
    ).toBe("Direct answer");
  });

  it("normalizes transaction introduction before more information", () => {
    expect(
      normalizeGovukDocument(
        "/example",
        item("transaction", {
          introductory_paragraph: "<p>Book online</p>",
          more_information: "<div>Bring your licence</div>",
        }),
      ).body,
    ).toBe("Book online\nBring your licence");
  });

  it("selects the matching guide part and uses its title", () => {
    const document = normalizeGovukDocument(
      "/theory-test/what-to-take",
      item(
        "guide",
        {
          parts: [
            {
              slug: "revision-and-practice",
              title: "Revision",
              body: "<p>Practise questions</p>",
            },
            {
              slug: "what-to-take",
              title: "What to take",
              body: "<p>Bring your licence</p>",
            },
          ],
        },
        { base_path: "/theory-test" },
      ),
    );
    expect(document.title).toBe("What to take");
    expect(document.body).toBe("Bring your licence");
  });

  it("uses the first guide part and shared title at the base route", () => {
    const document = normalizeGovukDocument(
      "/example",
      item("guide", {
        parts: [
          { slug: "first", title: "First part", body: "<p>First body</p>" },
        ],
      }),
    );
    expect(document.title).toBe("Shared title");
    expect(document.body).toBe("First body");
  });

  it("normalizes publication body without attachment content", () => {
    expect(
      normalizeGovukDocument(
        "/example",
        item("publication", {
          body: "<p>Safety questions</p>",
          attachments: [{ title: "Ignored attachment", body: "Ignored body" }],
        }),
      ).body,
    ).toBe("Safety questions");
  });

  it("normalizes manual body and child-section summaries", () => {
    expect(
      normalizeGovukDocument(
        "/example",
        item("manual", {
          body: "<p>Read the code</p>",
          child_section_groups: [
            {
              title: "Contents",
              child_sections: [
                { title: "Signals", description: "Road signal rules." },
                { title: "Parking", description: "Parking rules." },
              ],
            },
          ],
          attachments: [{ body: "Ignored attachment body" }],
        }),
      ).body,
    ).toBe(
      "Read the code\nContents\nSignals\nRoad signal rules.\nParking\nParking rules.",
    );
  });

  it("normalizes user-facing smart-answer node strings only", () => {
    expect(
      normalizeGovukDocument(
        "/example",
        item("simple_smart_answer", {
          body: "<p>Choose a vehicle</p>",
          nodes: [
            {
              kind: "question",
              slug: "question-1",
              title: "What do you drive?",
              body: "<p>Select one</p>",
              href: "/ignored",
              url: "https://example.test/ignored",
              condition: "ignored == true",
              options: [
                {
                  label: "Car",
                  next_node: "outcome-1",
                  slug: "car",
                },
              ],
            },
          ],
        }),
      ).body,
    ).toBe("Choose a vehicle\nWhat do you drive?\nSelect one\nCar");
  });

  it("normalizes metadata, canonical URL, and content hash", () => {
    const document = normalizeGovukDocument(
      "/example",
      item(
        "answer",
        {
          body: "<p>Body&nbsp;copy</p>",
        },
        { title: "  Shared   title ", description: " Description\r\ntext " },
      ),
    );
    expect(document).toMatchObject({
      id: "/example",
      url: "https://www.gov.uk/example",
      title: "Shared title",
      description: "Description text",
      body: "Body copy",
    });
    expect(document.contentHash).toBe(hashSnapshotContent(document));
  });

  it.each([
    [
      "unknown schema",
      "/example",
      item("unknown", { body: "Text" }),
      /unsupported GOV\.UK schema unknown/,
    ],
    [
      "blank title",
      "/example",
      item("answer", { body: "Text" }, { title: " " }),
      /title must be non-blank/,
    ],
    [
      "blank description",
      "/example",
      item("answer", { body: "Text" }, { description: " " }),
      /description must be non-blank/,
    ],
    [
      "blank body",
      "/example",
      item("answer", { body: "<p> </p>" }),
      /body must be non-blank/,
    ],
    [
      "missing guide part",
      "/theory-test/missing",
      item(
        "guide",
        { parts: [{ slug: "first", title: "First", body: "Body" }] },
        { base_path: "/theory-test" },
      ),
      /no guide part matches route \/theory-test\/missing/,
    ],
    [
      "non-GOV.UK base path",
      "/example",
      item(
        "answer",
        { body: "Text" },
        { base_path: "https://example.test/example" },
      ),
      /base_path must be a GOV\.UK path/,
    ],
    [
      "route without slash",
      "example",
      item("answer", { body: "Text" }),
      /route must start with \//,
    ],
  ])("rejects %s", (_name, route, value, message) => {
    expect(() => normalizeGovukDocument(route, value)).toThrow(message);
  });
});
