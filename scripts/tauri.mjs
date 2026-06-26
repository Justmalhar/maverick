// Cross-platform `tauri` launcher that guarantees the Rust toolchain is on PATH.
//
// On Windows the shell that runs `bun run tauri dev` often inherits a PATH that
// predates the rustup install, so tauri-cli's `cargo metadata` probe fails with
// "program not found" even though cargo is installed. We prepend the cargo bin
// dir (which also holds rustup) before delegating to the real tauri CLI, so the
// dev/build commands work regardless of the calling shell's PATH. Mirrors the
// boot-time PATH repair the sidecar already does for GUI launches.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";

function withCargoOnPath(env) {
  const next = { ...env };
  // CARGO_HOME wins when set; otherwise the rustup default (~/.cargo).
  const cargoHome = next.CARGO_HOME && next.CARGO_HOME.trim() !== ""
    ? next.CARGO_HOME
    : join(homedir(), ".cargo");
  const cargoBin = join(cargoHome, "bin");
  if (!existsSync(cargoBin)) return next;
  const parts = (next.PATH ?? "").split(delimiter);
  if (!parts.includes(cargoBin)) {
    next.PATH = cargoBin + delimiter + (next.PATH ?? "");
  }
  return next;
}

function resolveTauriBin() {
  const binName = process.platform === "win32" ? "tauri.cmd" : "tauri";
  const local = join(process.cwd(), "node_modules", ".bin", binName);
  return existsSync(local) ? local : "tauri";
}

const env = withCargoOnPath(process.env);
const child = spawn(resolveTauriBin(), process.argv.slice(2), {
  stdio: "inherit",
  env,
  // A .cmd shim on Windows must run through the shell.
  shell: process.platform === "win32",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
