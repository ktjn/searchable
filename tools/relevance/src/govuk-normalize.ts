import type { SnapshotDomainDocument } from "./domain-schema.js";
import { htmlToText } from "./html-to-text.js";
import { hashSnapshotContent } from "./snapshot-hash.js";
import {
  expectArray as array,
  expectRecord as record,
  expectString as string,
  type UnknownRecord,
} from "./validation.js";
export interface GovukContentItem {
  schema_name: string;
  base_path: string;
  title: string;
  description: string;
  details: UnknownRecord;
}

function normalized(value: unknown, path: string): string {
  const result = htmlToText(string(value, path));
  if (!result) throw new Error(`${path} must be non-blank`);
  return result;
}

function fragments(values: readonly unknown[], path: string): string {
  const result = values
    .filter((value) => value !== undefined && value !== null)
    .map((value, index) => htmlToText(string(value, `${path}[${index}]`)))
    .filter(Boolean)
    .join("\n");
  if (!result) throw new Error(`${path} must be non-blank`);
  return result;
}

function stepByStepBody(details: UnknownRecord): string {
  const navigation = record(
    details.step_by_step_nav,
    "item.details.step_by_step_nav",
  );
  const values: unknown[] = [navigation.introduction];
  for (const [stepIndex, rawStep] of array(
    navigation.steps,
    "item.details.step_by_step_nav.steps",
  ).entries()) {
    const step = record(
      rawStep,
      `item.details.step_by_step_nav.steps[${stepIndex}]`,
    );
    values.push(step.title);
    for (const [contentIndex, rawContent] of array(
      step.contents,
      `item.details.step_by_step_nav.steps[${stepIndex}].contents`,
    ).entries()) {
      const content = record(
        rawContent,
        `item.details.step_by_step_nav.steps[${stepIndex}].contents[${contentIndex}]`,
      );
      if (content.type === "paragraph") {
        values.push(content.text);
      } else if (content.type === "list") {
        for (const rawLink of array(
          content.contents,
          `item.details.step_by_step_nav.steps[${stepIndex}].contents[${contentIndex}].contents`,
        )) {
          const link = record(rawLink, "step-by-step link");
          values.push(link.text, link.context);
        }
      } else {
        throw new Error(
          `unsupported step-by-step content type ${content.type}`,
        );
      }
    }
  }
  return fragments(values, "step-by-step body");
}

function guidePart(
  route: string,
  item: GovukContentItem,
): { title?: unknown; body: unknown } {
  const parts = array(item.details.parts, "item.details.parts").map(
    (value, index) => record(value, `item.details.parts[${index}]`),
  );
  const suffix =
    route === item.base_path
      ? undefined
      : route.startsWith(`${item.base_path}/`)
        ? route.slice(`${item.base_path}/`.length)
        : "";
  const part = suffix
    ? parts.find((candidate) => candidate.slug === suffix)
    : suffix === undefined
      ? parts[0]
      : undefined;
  if (!part) throw new Error(`no guide part matches route ${route}`);
  return {
    title: suffix === undefined ? undefined : part.title,
    body: part.body,
  };
}

function manualBody(details: UnknownRecord): string {
  const values: unknown[] = [details.body];
  for (const [groupIndex, rawGroup] of array(
    details.child_section_groups,
    "item.details.child_section_groups",
  ).entries()) {
    const group = record(
      rawGroup,
      `item.details.child_section_groups[${groupIndex}]`,
    );
    values.push(group.title);
    for (const rawSection of array(
      group.child_sections,
      `item.details.child_section_groups[${groupIndex}].child_sections`,
    )) {
      const section = record(rawSection, "manual child section");
      values.push(section.title, section.description);
    }
  }
  return fragments(values, "manual body");
}

const NON_USER_FACING_NODE_KEYS = new Set([
  "condition",
  "href",
  "kind",
  "next_node",
  "slug",
  "url",
]);

function collectNodeStrings(value: unknown, key: string | undefined): string[] {
  if (key && NON_USER_FACING_NODE_KEYS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap((entry) => collectNodeStrings(entry, undefined));
  if (value && typeof value === "object")
    return Object.entries(value as UnknownRecord).flatMap(([entryKey, entry]) =>
      collectNodeStrings(entry, entryKey),
    );
  return [];
}

function smartAnswerBody(details: UnknownRecord): string {
  return fragments(
    [
      details.body,
      ...collectNodeStrings(
        array(details.nodes, "item.details.nodes"),
        undefined,
      ),
    ],
    "smart-answer body",
  );
}

function contentItem(value: unknown): GovukContentItem {
  const raw = record(value, "item");
  const basePath = string(raw.base_path, "item.base_path");
  if (!basePath.startsWith("/") || basePath.startsWith("//"))
    throw new Error("item.base_path must be a GOV.UK path");
  return {
    schema_name: string(raw.schema_name, "item.schema_name"),
    base_path: basePath,
    title: string(raw.title, "item.title"),
    description: string(raw.description, "item.description"),
    details: record(raw.details, "item.details"),
  };
}

export function normalizeGovukDocument(
  route: string,
  value: unknown,
): SnapshotDomainDocument {
  if (!route.startsWith("/") || route.startsWith("//"))
    throw new Error("route must start with /");
  const item = contentItem(value);
  let rawTitle: unknown = item.title;
  let body: string;
  switch (item.schema_name) {
    case "step_by_step_nav":
      body = stepByStepBody(item.details);
      break;
    case "answer":
      body = normalized(item.details.body, "item.details.body");
      break;
    case "transaction":
      body = fragments(
        [item.details.introductory_paragraph, item.details.more_information],
        "transaction body",
      );
      break;
    case "guide": {
      const part = guidePart(route, item);
      rawTitle = part.title ?? rawTitle;
      body = normalized(part.body, "guide part body");
      break;
    }
    case "publication":
      body = normalized(item.details.body, "item.details.body");
      break;
    case "manual":
      body = manualBody(item.details);
      break;
    case "simple_smart_answer":
      body = smartAnswerBody(item.details);
      break;
    default:
      throw new Error(`unsupported GOV.UK schema ${item.schema_name}`);
  }

  const document: SnapshotDomainDocument = {
    id: route,
    url: new URL(route, "https://www.gov.uk").href,
    title: normalized(rawTitle, "item.title"),
    description: normalized(item.description, "item.description"),
    body,
    contentHash: "",
  };
  document.contentHash = hashSnapshotContent(document);
  return document;
}
