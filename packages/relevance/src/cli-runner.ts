import { pathToFileURL } from "node:url";

/**
 * Shared entry-point bootstrap for the relevance CLI scripts (`cli.ts`,
 * `refresh-cli.ts`): runs `main` only when this module was invoked
 * directly (`node <entry>.js`) rather than imported for tests, and pipes
 * errors to stderr with a non-zero exit code.
 */
export function runCliEntry(
  entryUrl: string,
  main: (args?: string[]) => Promise<void>,
): void {
  const entry = process.argv[1];
  if (entry && entryUrl === pathToFileURL(entry).href) {
    main().catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
  }
}
