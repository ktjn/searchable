#!/usr/bin/env node
import { buildIndex } from "./build-index.js";
import { discoverHtmlDocuments } from "./discover.js";
import { writeIndex } from "./write-index.js";

const [inputDir, outDir] = process.argv.slice(2);
if (!inputDir || !outDir) {
  console.error("usage: searchable-indexer <inputDir> <outDir>");
  process.exit(1);
}

const sources = await discoverHtmlDocuments(inputDir);
const built = buildIndex(sources);
await writeIndex(built, outDir);
const totalDocs = Object.values(built.manifest.docCount).reduce(
  (sum, n) => sum + n,
  0,
);
console.log(`indexed ${totalDocs} document(s) from ${inputDir} -> ${outDir}`);
