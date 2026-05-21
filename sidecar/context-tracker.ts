import { defaultIds } from "./deps";
import type { ContextUsage, IdProvider } from "./types";
import type { SQLiteStore } from "./sqlite-store";

interface UsageRow {
  session_id: string;
  tokens_used: number;
  context_window: number;
  cost_estimate: number;
}

export interface ContextTrackerOptions {
  ids?: IdProvider;
  defaultWindow?: number;
}

export class ContextTracker {
  private ids: IdProvider;
  private defaultWindow: number;

  constructor(private store: SQLiteStore, opts: ContextTrackerOptions = {}) {
    this.ids = opts.ids ?? defaultIds;
    this.defaultWindow = opts.defaultWindow ?? 200000;
  }

  usage(sessionId: string): ContextUsage {
    const row = this.store.db
      .query<UsageRow, [string]>(
        "SELECT session_id, tokens_used, context_window, cost_estimate FROM context_usage WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1"
      )
      .get(sessionId);
    const workspaceRow = this.store.db
      .query<{ workspace_id: string }, [string]>("SELECT workspace_id FROM sessions WHERE id = ?")
      .get(sessionId);
    return {
      workspaceId: workspaceRow?.workspace_id ?? "",
      tokensUsed: row?.tokens_used ?? 0,
      contextWindow: row?.context_window ?? this.defaultWindow,
      sessionCostEstimate: row?.cost_estimate ?? 0,
    };
  }

  update(sessionId: string, tokensUsed: number, costDelta: number): void {
    const id = this.ids.uuid("ctx");
    const updatedAt = Math.floor(this.ids.now() / 1000);
    const existing = this.store.db
      .query<{ id: string; cost_estimate: number }, [string]>(
        "SELECT id, cost_estimate FROM context_usage WHERE session_id = ?"
      )
      .get(sessionId);
    if (existing) {
      this.store.db
        .query(
          "UPDATE context_usage SET tokens_used = ?, cost_estimate = cost_estimate + ?, updated_at = ? WHERE id = ?"
        )
        .run(tokensUsed, costDelta, updatedAt, existing.id);
    } else {
      this.store.db
        .query(
          "INSERT INTO context_usage (id, session_id, tokens_used, context_window, cost_estimate, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, sessionId, tokensUsed, this.defaultWindow, costDelta, updatedAt);
    }
  }
}
