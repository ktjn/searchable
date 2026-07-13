import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { validateSite } from "../site-validation.js";

test("reports broken local links and fragments", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await writeFile(
    join(root, "index.html"),
    '<a href="missing.html#nope">broken</a>',
  );
  expect(await validateSite(root)).toEqual([
    {
      source: "index.html",
      reference: "missing.html#nope",
      reason: "missing target",
    },
  ]);
});

test("accepts nested relative assets and heading fragments", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "style.css"), "body {}");
  await writeFile(
    join(root, "index.html"),
    '<h1 id="home">Home</h1><a href="docs/a.html#topic">A</a>',
  );
  await writeFile(
    join(root, "docs/a.html"),
    '<link rel="stylesheet" href="../style.css"><h2 id="topic">Topic</h2>',
  );
  expect(await validateSite(root)).toEqual([]);
});

test("only treats exact href, src, and id attributes as references", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await writeFile(
    join(root, "index.html"),
    '<div data-href="missing.html" data-id="topic"></div><a href="#topic">Topic</a>',
  );

  expect(await validateSite(root)).toEqual([
    {
      source: "index.html",
      reference: "#topic",
      reason: "missing fragment",
    },
  ]);
});

test("does not accept targets outside the generated artifact", async () => {
  const parent = await mkdtemp(join(tmpdir(), "csf-site-"));
  const root = join(parent, "dist");
  await mkdir(root);
  await writeFile(join(parent, "outside.css"), "body {}");
  await writeFile(join(root, "index.html"), '<link href="../outside.css">');

  expect(await validateSite(root)).toEqual([
    {
      source: "index.html",
      reference: "../outside.css",
      reason: "missing target",
    },
  ]);
});

test("rejects root-absolute local asset references as not subpath-safe", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await writeFile(join(root, "style.css"), "body {}");
  await writeFile(
    join(root, "index.html"),
    '<link rel="stylesheet" href="/style.css"><script src="/app.js"></script>',
  );

  expect(await validateSite(root)).toEqual([
    {
      source: "index.html",
      reference: "/app.js",
      reason: "root-absolute reference is not Pages subpath-safe",
    },
    {
      source: "index.html",
      reference: "/style.css",
      reason: "root-absolute reference is not Pages subpath-safe",
    },
  ]);
});

test("allows root-relative URLs in search-index document data", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await mkdir(join(root, "search-index"));
  await writeFile(join(root, "index.html"), "<main>Home</main>");
  await writeFile(
    join(root, "search-index", "manifest.json"),
    JSON.stringify({ documents: { url: ["/docs/current.html"] } }),
  );

  expect(await validateSite(root)).toEqual([]);
});

test("rejects forbidden generated paths and search-index entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await mkdir(join(root, "docs", "archive"), { recursive: true });
  await mkdir(join(root, "search-index"));
  await writeFile(
    join(root, "docs", "archive", "index.html"),
    "<h1>Archive</h1>",
  );
  await writeFile(
    join(root, "search-index", "manifest.json"),
    JSON.stringify({
      excerpt: "Archived notes remain under docs/archive/.",
      documents: {
        url: ["/docs/current.html", "\\docs\\superpowers\\internal.html"],
      },
    }),
  );

  expect(await validateSite(root)).toEqual([
    {
      source: "docs/archive/index.html",
      reference: "docs/archive/index.html",
      reason: "forbidden generated path",
    },
    {
      source: "search-index/manifest.json",
      reference: "\\docs\\superpowers\\internal.html",
      reason: "forbidden search-index entry",
    },
  ]);
});

test("CLI reports issues and exits unsuccessfully", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await writeFile(join(root, "index.html"), '<img src="missing.png">');

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(import.meta.dirname, "..", "validate-dist.ts"),
      root,
    ],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8" },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("index.html: missing.png (missing target)");
});
