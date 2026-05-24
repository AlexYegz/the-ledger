import type { Category, Decision, Status } from "@shared/schema";

export const CATEGORY_LABEL: Record<Category, string> = {
  meeting_request: "MEETING REQUEST",
  approval: "APPROVAL",
  response_needed: "RESPONSE NEEDED",
  invitation: "INVITATION",
  intro: "INTRO",
  funding: "FUNDING",
  sales: "SALES PITCH",
  other: "OTHER",
};

export const CATEGORY_VAR: Record<Category, { bg: string; fg: string }> = {
  meeting_request: { bg: "var(--cat-meeting-bg)", fg: "var(--cat-meeting-fg)" },
  approval: { bg: "var(--cat-approval-bg)", fg: "var(--cat-approval-fg)" },
  response_needed: { bg: "var(--cat-response-bg)", fg: "var(--cat-response-fg)" },
  invitation: { bg: "var(--cat-invitation-bg)", fg: "var(--cat-invitation-fg)" },
  intro: { bg: "var(--cat-intro-bg)", fg: "var(--cat-intro-fg)" },
  funding: { bg: "var(--cat-funding-bg)", fg: "var(--cat-funding-fg)" },
  sales: { bg: "var(--cat-sales-bg)", fg: "var(--cat-sales-fg)" },
  other: { bg: "var(--cat-other-bg)", fg: "var(--cat-other-fg)" },
};

export const DECISION_LABEL: Record<Decision, string> = {
  team_to_action: "TEAM TO ACTION",
  team_to_decline: "TEAM TO DECLINE",
  principal_to_respond: "JOE TO RESPOND",
  delegate: "DELEGATE",
};

export const DECISION_CLASS: Record<Decision, string> = {
  team_to_action: "action",
  team_to_decline: "decline",
  principal_to_respond: "respond",
  delegate: "delegate",
};

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting: "Waiting",
  complete: "Complete",
  canceled: "Canceled",
};

export const STATUS_CLASS: Record<Status, string> = {
  not_started: "not",
  in_progress: "prog",
  waiting: "wait",
  complete: "done",
  canceled: "cancel",
};

export function decisionTagLabel(
  decision: string | null | undefined,
  delegateTo: string | null | undefined,
): string {
  if (!decision) return "AWAITING JOE";
  if (decision === "delegate" && delegateTo)
    return `DELEGATE → ${delegateTo.toUpperCase()}`;
  return DECISION_LABEL[decision as Decision] || decision.toUpperCase();
}

export function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d
      .toLocaleString("en-US", { month: "short", day: "2-digit" })
      .toUpperCase();
  } catch {
    return iso;
  }
}

export function fmtNoteDate(ms: number): string {
  const d = new Date(ms);
  const date = d
    .toLocaleString("en-US", { month: "short", day: "2-digit" })
    .toUpperCase();
  const time = d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

export function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
