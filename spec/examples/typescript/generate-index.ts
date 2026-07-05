#!/usr/bin/env -S node --experimental-strip-types
// Minimal reference generator proving the index format needs no library
// beyond a JSON encoder — deliberately independent of this repo's own
// @csf/* packages (no shared code with the real indexer). See
// docs/02-index-format.md and docs/20-tech-stack.md. Usage:
//   node --experimental-strip-types generate-index.ts documents.json out/
//   (or: npx tsx generate-index.ts documents.json out/)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface SourceDoc {
  id: number;
  url: string;
  title: string;
  body: string;
}

interface FieldPosting {
  tf: number;
  pos: number[];
  len: number;
}

interface Posting {
  doc: number;
  fields: Record<string, FieldPosting>;
}

interface TermEntry {
  df: number;
  postings: Posting[];
}

function tokenize(text: string): string[] {
  const stripped = text.replace(/<[^>]+>/g, " ");
  return stripped.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function writeJson(outDir: string, relPath: string, data: unknown): string {
  const json = JSON.stringify(data);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 8);
  const hashedRelPath = relPath.replace(/\.json$/, `.${hash}.json`);
  const absPath = join(outDir, hashedRelPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, json);
  return hashedRelPath;
}

const [inputFile, outDir] = process.argv.slice(2) as [string, string];
const docs: SourceDoc[] = JSON.parse(readFileSync(inputFile, "utf8"));

const terms: Record<string, TermEntry> = {};
const docStore: Record<
  string,
  { url: string; fields: Record<string, string> }
> = {};
let titleLenSum = 0;
let bodyLenSum = 0;

for (const doc of docs) {
  const titleTokens = tokenize(doc.title);
  const bodyTokens = tokenize(doc.body);
  titleLenSum += titleTokens.length;
  bodyLenSum += bodyTokens.length;

  const fieldTokens: [string, string[]][] = [
    ["title", titleTokens],
    ["body", bodyTokens],
  ];
  for (const [field, tokens] of fieldTokens) {
    const positionsByTerm: Record<string, number[]> = {};
    tokens.forEach((term, pos) => {
      if (!positionsByTerm[term]) positionsByTerm[term] = [];
      positionsByTerm[term].push(pos);
    });
    for (const [term, positions] of Object.entries(positionsByTerm)) {
      terms[term] ??= { df: 0, postings: [] };
      let posting = terms[term].postings.find((p) => p.doc === doc.id);
      if (!posting) {
        posting = { doc: doc.id, fields: {} };
        terms[term].postings.push(posting);
        terms[term].df++;
      }
      posting.fields[field] = {
        tf: positions.length,
        pos: positions,
        len: tokens.length,
      };
    }
  }

  docStore[String(doc.id)] = {
    url: doc.url,
    fields: { title: doc.title, excerpt: doc.body.slice(0, 200) },
  };
}

const termsFile = writeJson(outDir, "terms/en/all.json", terms);
const docsFile = writeJson(outDir, "docs/0.json", docStore);
const ids = docs.map((d) => d.id);

const manifest = {
  version: 1,
  buildId: new Date().toISOString(),
  format: "json",
  languages: ["en"],
  defaultLanguage: "en",
  fields: {
    title: { boost: 1.0, stored: true },
    body: { boost: 1.0, stored: false },
  },
  docCount: docs.length,
  avgFieldLength: {
    title: titleLenSum / docs.length,
    body: bodyLenSum / docs.length,
  },
  shards: {
    terms: [
      {
        lang: "en",
        prefix: "all",
        file: termsFile,
        termCount: Object.keys(terms).length,
      },
    ],
    docs: [
      {
        shard: 0,
        file: docsFile,
        idRange: [Math.min(...ids), Math.max(...ids)],
      },
    ],
  },
};

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest));
console.log(`indexed ${docs.length} document(s) -> ${outDir}`);
