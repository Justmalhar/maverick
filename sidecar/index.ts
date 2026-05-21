import { RpcHandlers } from "./rpc-handlers";
import { stdoutNotifier } from "./deps";
import type { JsonRpcResponse, Notifier } from "./types";

export interface ServerOptions {
  handlers?: RpcHandlers;
  notifier?: Notifier;
  input?: AsyncIterable<string>;
}

export async function processLine(line: string, handlers: RpcHandlers, notifier: Notifier): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(trimmed);
  } catch {
    notifier.write(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
    );
    return;
  }
  if (typeof req.method !== "string") {
    notifier.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id ?? null,
        error: { code: -32600, message: "Invalid Request" },
      })
    );
    return;
  }
  let response: JsonRpcResponse;
  try {
    const result = await handlers.dispatch(req.method, req.params ?? {});
    response = { jsonrpc: "2.0", id: req.id ?? 0, result };
  } catch (err) {
    response = {
      jsonrpc: "2.0",
      id: req.id ?? 0,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  notifier.write(JSON.stringify(response));
}

export async function runServer(opts: ServerOptions = {}): Promise<void> {
  const handlers = opts.handlers ?? new RpcHandlers();
  const notifier = opts.notifier ?? stdoutNotifier;
  const input = opts.input ?? (console as unknown as AsyncIterable<string>);
  for await (const line of input) {
    if (typeof line === "string") {
      await processLine(line, handlers, notifier);
    }
  }
}

