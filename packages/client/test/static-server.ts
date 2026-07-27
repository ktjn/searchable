import { serveDirectory } from "@ktjn/searchable-fixtures";

/**
 * The smallest possible "static host" for the e2e test — proves the
 * client talks to the index over plain HTTP GET, not via direct
 * filesystem access, which is the actual deployment model
 * (docs/concepts/architecture.md#deployment-topology). Node's built-in
 * fetch doesn't support file:// URLs, so a real (if tiny) HTTP server
 * is the honest way to exercise that path, not a shortcut around it.
 * Delegates to @ktjn/searchable-fixtures's serveDirectory, serving every
 * file as application/json (the client's index shards are all JSON).
 */
export const serveStatic = (rootDir: string) =>
  serveDirectory(rootDir, {
    defaultContentType: "application/json",
  });