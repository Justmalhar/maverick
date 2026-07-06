import { randomBytes } from "crypto";
import { mapClaudeHookEvent } from "./hook-events";

interface NotificationSink {
  send(params: { workspaceId?: string | null; type: string; title: string; body: string }): unknown;
}

export interface HookServerOptions {
  notifications: NotificationSink;
  token?: string;
  /** Local-loopback webhook trigger for a scheduled Autopilot. */
  onAutopilotTrigger?: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

const OK = JSON.stringify({ continue: true });

/**
 * Loopback-only HTTP receiver for Claude Code lifecycle hooks. Bound to
 * 127.0.0.1 on an OS-assigned port and gated by a random per-process token so no
 * other local process can spoof notifications. Maps each event via
 * mapClaudeHookEvent and forwards to NotificationService.
 */
export class HookServer {
  private readonly notifications: NotificationSink;
  private readonly onAutopilotTrigger?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  private readonly token: string;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(opts: HookServerOptions) {
    this.notifications = opts.notifications;
    this.onAutopilotTrigger = opts.onAutopilotTrigger;
    this.token = opts.token ?? randomBytes(24).toString("hex");
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => this.handle(req),
    });
  }

  endpoint(): { port: number; token: string } {
    if (!this.server) throw new Error("HookServer not started");
    const port = this.server.port;
    if (port === undefined) throw new Error("HookServer has no port");
    return { port, token: this.token };
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    if (req.headers.get("X-Maverick-Token") !== this.token) {
      return new Response("unauthorized", { status: 401 });
    }
    if (url.pathname === "/agent-hook") return this.handleAgentHook(req);
    if (url.pathname === "/autopilot-trigger") return this.handleAutopilotTrigger(req);
    return new Response("not found", { status: 404 });
  }

  private async handleAgentHook(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const mapped = mapClaudeHookEvent(body);
    if (mapped) {
      const workspaceId = req.headers.get("X-Maverick-Workspace") || null;
      this.notifications.send({ workspaceId, ...mapped });
    }
    return new Response(OK, { status: 200, headers: { "Content-Type": "application/json" } });
  }

  private async handleAutopilotTrigger(req: Request): Promise<Response> {
    if (!this.onAutopilotTrigger) return new Response("not found", { status: 404 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) {
      return new Response("bad request", { status: 400 });
    }
    const result = await this.onAutopilotTrigger(id);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
