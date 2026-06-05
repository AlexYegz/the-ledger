// Internal domain configuration.
// Override via env: INTERNAL_DOMAINS="alpha.school,trilogy.com,esw.com"
const DEFAULT_INTERNAL_DOMAINS = [
  "alpha.school",
  "trilogy.com",
  "esw.com",
  "superbuilders.school",
  "gt.school",
  "sportsacademy.school",
  "2hourlearning.com",
];
export const INTERNAL_DOMAINS = (process.env.INTERNAL_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean)
  .length
  ? (process.env.INTERNAL_DOMAINS || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
  : DEFAULT_INTERNAL_DOMAINS;

export function isInternal(email?: string | null): boolean {
  if (!email) return false;
  const m = email.toLowerCase().match(/@([^\s>]+)$/);
  if (!m) return false;
  const domain = m[1].trim();
  return INTERNAL_DOMAINS.some(
    (d) => domain === d.toLowerCase() || domain.endsWith("." + d.toLowerCase()),
  );
}

export const MEETING_TRACKER_URL =
  process.env.MEETING_TRACKER_URL || "https://meeting-tracker-production.up.railway.app";

export const LEDGER_TO_TRACKER_TOKEN = process.env.LEDGER_TO_TRACKER_TOKEN || "";

export const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || "";
// Model id — using claude-sonnet-4-5 mapped to current Anthropic ID.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

// Google OAuth client ID for Sign in with Google. Set on Railway.
// Same value is also passed to the front end at build time via
// VITE_GOOGLE_CLIENT_ID — see script/build.ts.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

export const SESSION_SECRET =
  process.env.SESSION_SECRET || "the-ledger-dev-secret-change-me";
