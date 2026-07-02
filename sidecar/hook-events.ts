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
 */
export function mapClaudeHookEvent(payload: unknown): MappedHookNotification | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const event = asString(p.hook_event_name);
  if (!event) return null;

  if (event === "Notification") {
    const kind = asString(p.notification_type);
    if (!kind || !ATTENTION_NOTIFICATION_TYPES.has(kind)) return null;
    return {
      type: "agent.attention",
      title: "Agent needs input",
      body: asString(p.message) ?? "Claude is waiting for your input",
    };
  }
  if (event === "Stop") {
    return { type: "agent.done", title: "Agent finished", body: "Claude finished its task" };
  }
  if (event === "StopFailure") {
    return { type: "agent.error", title: "Agent error", body: "Claude exited with an error" };
  }
  return null;
}
