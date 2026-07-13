import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export async function prepareShowcase(): Promise<void> {
  await execAsync("pnpm docs:build", {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
}
