import { createHash } from "node:crypto";
import type { SnapshotDomainDocument } from "./domain-schema.js";

export function hashSnapshotContent(
  document: Pick<SnapshotDomainDocument, "title" | "description" | "body">,
): string {
  return createHash("sha256")
    .update(
      `${document.title}\n${document.description}\n${document.body}`,
      "utf8",
    )
    .digest("hex");
}
