/** The transient notification a Claude hook event should raise, or null to ignore. */
export interface MappedHookNotification {
  type: string;
  title: string;
  body: string;
}

// Only these Notification subtypes mean "the user is genuinely blocked": a
// permission dialog or an idle prompt awaiting the next instruction. auth/
// elicitation chatter is deliberately ignored so we never spam.
const ATTENTION_NOTIFICATION_TYPES = new Set(["permission_prompt", "idle_prompt"]);

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Map a Claude Code hook payload (parsed JSON body of a `/agent-hook` POST) to
 * the notification it should raise, or null when the event is not worth
 * interrupting the user. Pure and total: never throws on malformed input.
 *
 * Only the `Notification` event is surfaced. `Stop`/`StopFailure` are
 * intentionally NOT mapped: `Stop` fires on every assistant turn and
 * `StopFailure` on transient auto-retried API errors, so notifying on them would
 * spam a still-running agent. Actual completion/exit is reflected by the local
 * status pill (PTY exit code), not an OS notification.
 */
export function mapClaudeHookEvent(payload: unknown): MappedHookNotification | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (asString(p.hook_event_name) !== "Notification") return null;
  const kind = asString(p.notification_type);
  if (!kind || !ATTENTION_NOTIFICATION_TYPES.has(kind)) return null;
  return {
    type: "agent.attention",
    title: "Agent needs input",
    body: asString(p.message) ?? "Claude is waiting for your input",
  };
}
