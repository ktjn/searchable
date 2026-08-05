/**
 * Dependency-free HTML -> text conversion (named/numeric entities, block
 * breaks, script/style stripping). Extracted from govuk-normalize.ts so it
 * can be reused without importing the whole GOV.UK document normalizer.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  pound: "£",
};

function decodeEntity(entity: string): string {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff)
      throw new Error(`invalid numeric HTML entity ${entity}`);
    return String.fromCodePoint(codePoint);
  }
  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff)
      throw new Error(`invalid numeric HTML entity ${entity}`);
    return String.fromCodePoint(codePoint);
  }
  const decoded = NAMED_ENTITIES[entity];
  if (decoded === undefined) throw new Error(`unknown HTML entity ${entity}`);
  return decoded;
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

interface HtmlTag {
  closing: boolean;
  end: number;
  name?: string;
}

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function readTag(html: string, start: number): HtmlTag | undefined {
  const end = findTagEnd(html, start);
  if (end < 0) return undefined;
  let value = html.slice(start + 1, end).trimStart();
  if (value.startsWith("!") || value.startsWith("?"))
    return { closing: false, end };
  const closing = value.startsWith("/");
  if (closing) value = value.slice(1).trimStart();
  const match = /^([a-z][a-z0-9:-]*)/iu.exec(value);
  const name = match?.[1];
  if (!name) return undefined;
  return { closing, end, name: name.toLowerCase() };
}

function skipRawTextElement(
  html: string,
  start: number,
  name: "script" | "style",
): number {
  const lower = html.toLowerCase();
  let candidate = lower.indexOf(`</${name}`, start);
  while (candidate >= 0) {
    const tag = readTag(html, candidate);
    if (tag?.closing && tag.name === name) return tag.end + 1;
    candidate = lower.indexOf(`</${name}`, candidate + 2);
  }
  return html.length;
}

function stripHtml(html: string): string {
  let text = "";
  for (let index = 0; index < html.length; ) {
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[index] === "<") {
      const tag = readTag(html, index);
      if (tag) {
        if (!tag.closing && (tag.name === "script" || tag.name === "style")) {
          index = skipRawTextElement(html, tag.end + 1, tag.name);
          continue;
        }
        if (tag.name && BLOCK_TAGS.has(tag.name)) text += "\n";
        index = tag.end + 1;
        continue;
      }
    }
    text += html[index] === "\n" ? " " : html[index];
    index++;
  }
  return text;
}

export function htmlToText(html: string): string {
  return stripHtml(html.replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
    .replace(
      /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/giu,
      (_match, entity: string) => decodeEntity(entity),
    )
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}
