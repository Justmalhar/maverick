import { useEffect, useState } from "react";
import { contextRecord, contextUsage } from "@/lib/tauri";
import {
  estimateCost,
  estimateTokensForMessages,
} from "@/lib/context-usage";
import type { ContextUsage, Message } from "@/lib/ipc";

const UPDATED_EVENT = "maverick:context:updated";

/**
 * Payload carried by {@link UPDATED_EVENT}. `sessionId` lets a listening hook
 * skip the re-fetch for foreign sessions so N mounted instances don't each
 * re-issue a context_usage RPC on every broadcast (N× IPC amplification).
 */
type ContextUpdatedDetail = ContextUsage & { sessionId?: string };

const ZERO: ContextUsage = {
  workspaceId: "",
  tokensUsed: 0,
  contextWindow: 200000,
  sessionCostEstimate: 0,
};

/**
 * Recompute the estimated token + cost figures for a session from its messages
 * and persist them. Broadcasts an update so live readers (StatusBar, UsagePanel)
 * refresh without polling.
 */
export async function recordUsageEstimate(
  sessionId: string,
  messages: Pick<Message, "content">[],
  backend: string
): Promise<ContextUsage> {
  const tokens = estimateTokensForMessages(messages);
  const cost = estimateCost(tokens, backend);
  const usage = await contextRecord(sessionId, tokens, cost);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(UPDATED_EVENT, { detail: { ...usage, sessionId } })
    );
  }
  return usage;
}

/** Live session usage: fetches on mount and refreshes on update broadcasts. */
export function useContextUsage(sessionId: string | undefined): ContextUsage {
  const [usage, setUsage] = useState<ContextUsage>(ZERO);

  useEffect(() => {
    if (!sessionId) {
      setUsage(ZERO);
      return;
    }
    let cancelled = false;
    contextUsage(sessionId)
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        if (!cancelled) setUsage(ZERO);
      });

    function onUpdated(e: Event) {
      const detail = (e as CustomEvent<ContextUpdatedDetail>).detail;
      // Skip the re-fetch when the event names a different session; an event
      // without a sessionId is treated as a wildcard and always refreshes so we
      // never over-suppress legitimate updates.
      if (detail?.sessionId !== undefined && detail.sessionId !== sessionId) {
        return;
      }
      contextUsage(sessionId!)
        .then((u) => {
          if (!cancelled) setUsage(u);
        })
        .catch(() => {});
    }
    window.addEventListener(UPDATED_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(UPDATED_EVENT, onUpdated);
    };
  }, [sessionId]);

  return usage;
}
