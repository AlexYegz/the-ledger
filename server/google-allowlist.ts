// Email allowlist for Google sign-in.
// Each entry maps a Google account email to a Ledger role + identity.
// Only emails in this map can sign in. Everyone else gets 403.
//
// To add or remove access, edit this file and redeploy. Keep it in source
// control so any change is reviewable in git history.

export type Role = "principal" | "team";
export type Identity = "joe" | "alexandra" | "meghan";

export interface AllowlistEntry {
  role: Role;
  identity: Identity;
}

// NOTE: keys are normalized to lowercase before lookup.
export const GOOGLE_ALLOWLIST: Record<string, AllowlistEntry> = {
  "joe.liemandt@trilogy.com":           { role: "principal", identity: "joe" },
  "joe.liemandt@alpha.school":          { role: "principal", identity: "joe" },
  "meghan.womack@trilogy.com":          { role: "team",      identity: "meghan" },
  "meghan.womack@alpha.school":         { role: "team",      identity: "meghan" },
  "alexandra.yeghiazarian@trilogy.com": { role: "team",      identity: "alexandra" },
  "alexandra.yeghiazarian@alpha.school":{ role: "team",      identity: "alexandra" },
};

export function lookupAllowlist(email: string | null | undefined): AllowlistEntry | null {
  if (!email) return null;
  const key = email.trim().toLowerCase();
  return GOOGLE_ALLOWLIST[key] || null;
}
