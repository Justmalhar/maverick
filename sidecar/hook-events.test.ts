import { describe, it, expect } from "bun:test";
import { mapClaudeHookEvent } from "./hook-events";

describe("mapClaudeHookEvent", () => {
  it("maps permission_prompt Notification to agent.attention", () => {
    const out = mapClaudeHookEvent({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Claude needs permission to run npm test",
    });
    expect(out).toEqual({
      type: "agent.attention",
      title: "Agent needs input",
      body: "Claude needs permission to run npm test",
    });
  });

  it("maps idle_prompt Notification to agent.attention with a default body", () => {
    const out = mapClaudeHookEvent({
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
    });
    expect(out).toEqual({
      type: "agent.attention",
      title: "Agent needs input",
      body: "Claude is waiting for your input",
    });
  });

  it("ignores Stop and StopFailure (per-turn / transient — would spam)", () => {
    expect(mapClaudeHookEvent({ hook_event_name: "Stop" })).toBeNull();
    expect(mapClaudeHookEvent({ hook_event_name: "StopFailure" })).toBeNull();
  });

  it("ignores Notification types that are not attention-worthy", () => {
    expect(
      mapClaudeHookEvent({ hook_event_name: "Notification", notification_type: "auth_success" })
    ).toBeNull();
  });

  it("ignores unknown / malformed events", () => {
    expect(mapClaudeHookEvent({})).toBeNull();
    expect(mapClaudeHookEvent({ hook_event_name: "SessionStart" })).toBeNull();
    expect(mapClaudeHookEvent(null)).toBeNull();
    expect(mapClaudeHookEvent("nope")).toBeNull();
  });
});
