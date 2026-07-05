export interface Trigger {
  kind: "slash" | "mention";
  query: string;
  start: number;
}

export function detectTrigger(text: string, caret: number): Trigger | null {
  const upToCaret = text.slice(0, caret);
  if (upToCaret.startsWith("/") && !/\s/.test(upToCaret)) {
    return { kind: "slash", query: upToCaret.slice(1), start: 0 };
  }
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return null;
  const token = upToCaret.slice(at + 1);
  if (/\s/.test(token)) return null;
  return { kind: "mention", query: token, start: at };
}

export function applyTrigger(text: string, trigger: Trigger, replacement: string): { text: string; caret: number } {
  const tokenLen = 1 + trigger.query.length;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.start + tokenLen);
  const next = `${before}${replacement} ${after}`;
  return { text: next, caret: before.length + replacement.length + 1 };
}
