import type { Message } from "@/lib/ipc";

// A rough heuristic — ~4 characters per token. Used for client-side estimates
// only; the figure is always surfaced to the user as an estimate, never billed.
const CHARS_PER_TOKEN = 4;

// USD per 1K tokens, blended input/output. Keyed by backend id substring.
// These are coarse public list prices; refine as backends expose real usage.
const PRICE_PER_1K: Record<string, number> = {
  claude: 0.009,
  codex: 0.006,
  gemini: 0.002,
  ollama: 0,
  pi: 0,
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokensForMessages(messages: Pick<Message, "content">[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function pricePer1k(backend: string): number {
  const key = Object.keys(PRICE_PER_1K).find((k) => backend.toLowerCase().includes(k));
  return key ? PRICE_PER_1K[key] : 0;
}

export function estimateCost(tokens: number, backend: string): number {
  return (tokens / 1000) * pricePer1k(backend);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
