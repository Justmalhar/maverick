// Compile the Bun sidecar into a single self-contained executable
// and place it at src-tauri/binaries/maverick-sidecar-<target-triple>
// so Tauri's externalBin bundling picks it up.
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const sidecarEntry = join(repoRoot, "sidecar", "main.ts");
const binariesDir = join(repoRoot, "src-tauri", "binaries");

if (!existsSync(binariesDir)) mkdirSync(binariesDir, { recursive: true });

const rustc = await $`rustc -vV`.text();
const triple = rustc.match(/^host:\s+(.+)$/m)?.[1]?.trim();
if (!triple) {
  console.error("could not detect rustc host triple");
  process.exit(1);
}

const ext = process.platform === "win32" ? ".exe" : "";
const outfile = join(binariesDir, `maverick-sidecar-${triple}${ext}`);

console.log(`building sidecar → ${outfile}`);

await $`bun build --compile --minify --sourcemap --target=bun ${sidecarEntry} --outfile ${outfile}`;

console.log("sidecar built");
