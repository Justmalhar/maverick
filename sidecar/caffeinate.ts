import { defaultSpawner } from "./process-manager";
import type { Spawner, ManagedProc } from "./process-manager";

// Hold ES_CONTINUOUS | ES_SYSTEM_REQUIRED (0x80000001) for the life of this
// process so Windows won't idle-sleep while it runs; killing the process lets
// Windows auto-clear the request (symmetric with darwin/linux). The sleep loop
// keeps the setting thread alive — ES_CONTINUOUS persists only while it lives.
const WIN_KEEP_AWAKE =
  "$s='[DllImport(\"kernel32.dll\")]public static extern uint SetThreadExecutionState(uint e);';" +
  "$t=Add-Type -MemberDefinition $s -Name Power -Namespace Mvk -PassThru;" +
  "$t::SetThreadExecutionState(0x80000001) | Out-Null;" +
  "while($true){Start-Sleep -Seconds 3600}";

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
      return this.track(this.spawner(["caffeinate", "-i"], {}));
    }
    if (this.platform === "linux") {
      return this.track(
        this.spawner(
          ["systemd-inhibit", "--what=idle:sleep", "--who=maverick", "--why=AI agents running", "--mode=block", "sleep", "infinity"],
          {}
        )
      );
    }
    if (this.platform === "win32") {
      return this.track(this.spawner(["powershell", "-NoProfile", "-NonInteractive", "-Command", WIN_KEEP_AWAKE], {}));
    }
    return { started: false };
  }

  // Track the keep-awake child so active() reflects reality: if it exits on its
  // own (killed externally, crashed), clear our handle so active() returns false.
  private track(proc: ManagedProc): { started: boolean } {
    this.proc = proc;
    void Promise.resolve(proc.exited)
      .catch(() => 0)
      .then(() => {
        if (this.proc === proc) this.proc = null;
      });
    return { started: true };
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
