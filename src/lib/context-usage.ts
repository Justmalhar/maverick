import type { Message } from "@/lib/ipc";
import { estimateCost3Tier, type CatalogUsage } from "@/lib/models/catalog";

// A rough heuristic — ~4 characters per token. Used for client-side estimates
// only; the figure is always surfaced to the user as an estimate, never billed.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokensForMessages(messages: Pick<Message, "content">[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function estimateCostFromUsage(usage: CatalogUsage, backend: string): number {
  return estimateCost3Tier(backend, usage);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
