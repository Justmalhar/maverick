import { useEffect, useState } from "react";
import { contextRecord, contextUsage } from "@/lib/tauri";
import {
  estimateCost,
  estimateTokensForMessages,
} from "@/lib/context-usage";
import type { ContextUsage, Message } from "@/lib/ipc";

const UPDATED_EVENT = "maverick:context:updated";

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
    window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: usage }));
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
      const detail = (e as CustomEvent<ContextUsage>).detail;
      if (detail && detail.workspaceId !== undefined) {
        contextUsage(sessionId!)
          .then((u) => {
            if (!cancelled) setUsage(u);
          })
          .catch(() => {});
      }
    }
    window.addEventListener(UPDATED_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(UPDATED_EVENT, onUpdated);
    };
  }, [sessionId]);

  return usage;
}
