import { defaultSpawner } from "./process-manager";
import type { Spawner, ManagedProc } from "./process-manager";

export interface CaffeinateOptions {
  spawn?: Spawner;
  platform?: NodeJS.Platform;
}

export class Caffeinate {
  private proc: ManagedProc | null = null;
  private spawner: Spawner;
  private platform: NodeJS.Platform;

  constructor(opts: CaffeinateOptions = {}) {
    this.spawner = opts.spawn ?? defaultSpawner;
    this.platform = opts.platform ?? process.platform;
  }

  start(): { started: boolean } {
    if (this.proc) return { started: false };
    if (this.platform === "darwin") {
      this.proc = this.spawner(["caffeinate", "-i"], {});
      return { started: true };
    }
    if (this.platform === "linux") {
      this.proc = this.spawner(
        ["systemd-inhibit", "--what=idle:sleep", "--who=maverick", "--why=AI agents running", "--mode=block", "sleep", "infinity"],
        {}
      );
      return { started: true };
    }
    return { started: false };
  }

  stop(): { stopped: boolean } {
    if (!this.proc) return { stopped: false };
    this.proc.kill();
    this.proc = null;
    return { stopped: true };
  }

  active(): boolean {
    return this.proc !== null;
  }
}
