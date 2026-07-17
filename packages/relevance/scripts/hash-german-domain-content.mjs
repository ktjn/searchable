import { createHash } from "node:crypto";

function hashSnapshotContent({ title, description, body }) {
  return createHash("sha256")
    .update(`${title}\n${description}\n${body}`, "utf8")
    .digest("hex");
}

const [, , titleArg, descriptionArg, bodyFileArg] = process.argv;
if (!titleArg || !descriptionArg || !bodyFileArg) {
  console.error(
    "usage: node hash-german-domain-content.mjs <title> <description> <bodyFile>",
  );
  process.exit(1);
}

const { readFileSync } = await import("node:fs");
const body = readFileSync(bodyFileArg, "utf8");
console.log(
  hashSnapshotContent({ title: titleArg, description: descriptionArg, body }),
);
