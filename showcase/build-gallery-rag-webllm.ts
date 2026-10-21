import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const exampleDir = join(repoRoot, "examples", "rag-webllm");
const distDir = join(__dirname, "dist");
const targetDir = join(distDir, "gallery", "rag-webllm");

/**
 * Deploys examples/rag-webllm alongside the rest of the feature gallery, so
 * a visitor with a WebGPU-capable browser can try it live instead of only
 * reading about it. Unlike the other Stage 2 gallery demos (build-gallery.ts
 * et al.), this one isn't built through gallery-shared.ts's pageShell/
 * writePythonIndex pipeline -- examples/rag-webllm is a standalone project
 * with its own build.sh and a hand-built, differently themed index.html
 * (no gallery-widget.ts facet UI; it talks to WebLLM directly), and it's
 * meant to double as a runnable-on-its-own example outside this site, so
 * its own files stay untouched. This script just runs that project's own
 * build, copies the output, and injects one small "back to gallery" link
 * into the *copy* (not the source file).
 */
async function main() {
  console.log("building examples/rag-webllm (search index + client bundle)...");
  await run("bash", ["build.sh"], { cwd: exampleDir });

  await mkdir(targetDir, { recursive: true });
  await cp(join(exampleDir, "search-index"), join(targetDir, "search-index"), {
    recursive: true,
  });
  await cp(join(exampleDir, "searchable.js"), join(targetDir, "searchable.js"));

  const html = await readFile(join(exampleDir, "index.html"), "utf8");
  const withBackLink = html.replace(
    "<main>\n  <h1>",
    '<main>\n  <p style="margin:0 0 1rem;font-size:0.85rem"><a href="../index.html">&larr; Back to the feature gallery</a></p>\n  <h1>',
  );
  if (withBackLink === html) {
    throw new Error(
      "build-gallery-rag-webllm.ts: couldn't find the expected <main>/<h1> anchor to inject the back-link into -- examples/rag-webllm/index.html's structure changed, update the replace target above.",
    );
  }
  await writeFile(join(targetDir, "index.html"), withBackLink, "utf8");

  console.log(`built RAG-over-WebLLM demo -> ${targetDir}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
