import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function prepareShowcase(): Promise<void> {
  await execAsync("pnpm docs:build", {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
}
