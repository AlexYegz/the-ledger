import type { CustomAction, Decision } from "@shared/schema";

const VALID_DECISIONS: Decision[] = [
  "team_to_action",
  "team_to_decline",
  "principal_to_respond",
  "delegate",
];

// Parse the stored JSON string into an array we can render.
// Returns [] for null/empty/malformed so the UI cleanly falls back to
// the generic 4-button row.
export function parseCustomActions(raw: string | null | undefined): CustomAction[] {
  if (!raw) return [];
  let arr: any;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((a, i): CustomAction | null => {
      if (!a || typeof a !== "object") return null;
      const label = typeof a.label === "string" ? a.label.trim() : "";
      const decision = typeof a.decision === "string" ? a.decision : "";
      if (!label) return null;
      if (!VALID_DECISIONS.includes(decision as Decision)) return null;
      return {
        id: typeof a.id === "string" && a.id ? a.id : `act_${i + 1}`,
        label,
        decision: decision as Decision,
        is_snooze: Boolean(a.is_snooze),
      };
    })
    .filter((a): a is CustomAction => a !== null)
    .slice(0, 4);
}

// Map a custom action's decision to the same CSS class used by the
// generic decision buttons (action/decline/respond/delegate) so colors
// stay consistent across the Answer view and Workspace.
export function decisionClass(d: Decision): "action" | "decline" | "respond" | "delegate" {
  switch (d) {
    case "team_to_action":
      return "action";
    case "team_to_decline":
      return "decline";
    case "principal_to_respond":
      return "respond";
    case "delegate":
      return "delegate";
  }
}

// Given an item with a decision and (optionally) stored custom_actions JSON,
// return the custom button label that produced that decision. Prefers a
// non-snooze match so an item decided via "Respond personally" doesn't
// surface a "Think about it" label. Returns null if no match — caller
// should fall back to the generic decision label.
export function matchedCustomLabel(item: {
  decision: string | null | undefined;
  custom_actions: string | null | undefined;
}): string | null {
  if (!item.decision) return null;
  const actions = parseCustomActions(item.custom_actions);
  if (actions.length === 0) return null;
  const candidates = actions.filter((a) => a.decision === item.decision);
  if (candidates.length === 0) return null;
  const nonSnooze = candidates.find((a) => !a.is_snooze);
  return (nonSnooze || candidates[0]).label;
}

// "Snoozed N days ago" / "Snoozed today" / "Snoozed N hours ago".
export function snoozeAgeLabel(snoozedAt: number | null | undefined, now = Date.now()): string {
  if (!snoozedAt) return "";
  const diffMs = now - snoozedAt;
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
    return mins === 1 ? "Snoozed 1 min ago" : `Snoozed ${mins} mins ago`;
  }
  if (diffMs < day) {
    const hrs = Math.floor(diffMs / hour);
    return hrs === 1 ? "Snoozed 1 hr ago" : `Snoozed ${hrs} hrs ago`;
  }
  const days = Math.floor(diffMs / day);
  if (days === 0) return "Snoozed today";
  if (days === 1) return "Thinking for 1 day";
  return `Thinking for ${days} days`;
}
