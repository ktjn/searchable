import { expect, test } from "vitest";
import { pageShell } from "../gallery-shared.js";

test("gallery pages expose a skip link and main landmark target", () => {
  const html = pageShell({
    title: "Gallery",
    description: "Gallery page",
    root: "../",
    bodyHtml: "<main><h1>Gallery</h1></main>",
  });

  expect(html).toContain('<a class="skip-link" href="#main-content">');
  expect(html).toContain('<main id="main-content">');
});
