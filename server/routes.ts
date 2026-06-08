import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import rateLimit from "express-rate-limit";
import { storage, sqlite, maybeSeed } from "./storage";
import {
  insertItemSchema,
  insertNoteSchema,
  type InsertItem,
} from "@shared/schema";
import {
  CLAUDE_API_KEY,
  CLAUDE_MODEL,
  INTERNAL_DOMAINS,
  LEDGER_TO_TRACKER_TOKEN,
  MEETING_TRACKER_URL,
  GOOGLE_CLIENT_ID,
} from "./config";
import { lookupAllowlist } from "./google-allowlist";
import { z } from "zod";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ============================================================
// Token-based auth (cookies don't survive the proxy iframe).
// Sessions are persisted in SQLite so they survive deploys/restarts.
// ============================================================
type Role = "principal" | "team";
type Identity = "meghan" | "alexandra" | "joe";
type TokenSession = { role: Role; identity: Identity; createdAt: number };
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const sessionInsert = sqlite.prepare(
  "INSERT INTO sessions (token, role, identity, created_at) VALUES (?, ?, ?, ?)",
);
const sessionSelect = sqlite.prepare(
  "SELECT role, identity, created_at FROM sessions WHERE token = ?",
);
const sessionDelete = sqlite.prepare("DELETE FROM sessions WHERE token = ?");
const sessionPurge = sqlite.prepare("DELETE FROM sessions WHERE created_at < ?");

// Sweep expired sessions on boot.
sessionPurge.run(Date.now() - SESSION_TTL_MS);

function issueToken(role: Role, identity: Identity): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessionInsert.run(token, role, identity, Date.now());
  return token;
}

function readSession(req: Request): TokenSession | null {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const row = sessionSelect.get(m[1]) as
    | { role: Role; identity: Identity; created_at: number }
    | undefined;
  if (!row) return null;
  if (Date.now() - row.created_at > SESSION_TTL_MS) {
    sessionDelete.run(m[1]);
    return null;
  }
  return { role: row.role, identity: row.identity, createdAt: row.created_at };
}

function revokeToken(req: Request): void {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) sessionDelete.run(m[1]);
}

const PARSER_PROMPT = `You are parsing an email/request to fill a row in The Ledger — a decision tracker. The reader of the "context" field is Joe himself, so write directly TO Joe in second person ("you"), never about him in third person.

Extract the fields below and return ONLY valid JSON — no explanation, no markdown, no code fences.

Writing rules for the "context" field:
- Address Joe in second person. Use "you" / "your". Never write "Joe" or "he" or "him" in the context.
- Bold every other person's name (not Joe's) on first mention using <b> tags. Use first names only after the first mention.
- Be brief and plain. No corporate filler, no hedging, no em dashes or en dashes.
- 2-3 sentences of summary, then ONE final bolded yes/no question phrased to Joe in second person, e.g. <b>Want to meet?</b>, <b>Approve?</b>, <b>Take the call?</b>
- If there is a deadline or hard time constraint, include <b>Time sensitive.</b> immediately before the final question.

{
  "date_received": "YYYY-MM-DD (date the email was sent; today's date if not found)",
  "sender_name": "Sender's full name only, e.g. 'John Smith'",
  "sender_org": "Sender's company or organization, or null if none",
  "sender_email": "Sender's email address, or null if not present",
  "subject": "Exact email subject line",
  "category": "ONE of: meeting_request, approval, response_needed, invitation, intro, funding, sales, other",
  "context": "2-3 sentences addressed directly to Joe in second person, following the writing rules above. End with one bolded yes/no question to Joe.",
  "is_time_sensitive": true or false,
  "implied_actions": {
    "team_to_action": "Brief lowercase fragment describing what the team would do if Joe picks Team to Action, e.g. 'accept invitation and schedule shaping call'",
    "team_to_decline": "Brief lowercase fragment for the decline path, e.g. 'graceful pass, leave door open'",
    "principal_to_respond": "Brief lowercase fragment for Joe handling it himself",
    "delegate": "Brief lowercase fragment for delegation, e.g. 'forward to chief of staff'"
  },
  "suggested_actions": [
    { "label": "Specific action button text", "decision": "team_to_action | team_to_decline | principal_to_respond | delegate", "is_snooze": false }
  ]
}

Rules for "suggested_actions":
- Return 2 to 4 buttons that are the most likely next steps for THIS specific email. These are the buttons Joe will see and tap.
- Each label is a short, specific imperative phrase (2-5 words). Use the actual person/topic from the email. Examples: "Schedule with Arpan", "Decline politely", "Ask for MAP scores first", "Pass to Meghan".
- BAD labels (too generic): "Team to action", "Yes", "Reply", "Take meeting".
- Always include at least one decline-style option mapped to team_to_decline.
- Unless the item is time-sensitive, ALWAYS include exactly one snooze option as the LAST entry: { "label": "I'll think about it", "decision": "principal_to_respond", "is_snooze": true }.
- Map each label to the correct underlying decision:
  - team_to_action: team will execute (book the meeting, send the doc, etc.)
  - team_to_decline: team will politely decline
  - principal_to_respond: Joe handles personally (writes the reply, makes the call) — also used for snooze with is_snooze: true
  - delegate: forward to a specific named person (Meghan, etc.)

Example of correct context tone:
  "<b>Arun Rao</b> wants to introduce you to <b>Emma Brunskill</b>, a Stanford CS professor researching ML/RL in education. Arun suggests meeting in Palo Alto this week to discuss applying RCT methodology to Alpha School. <b>Want to meet with Emma?</b>"

Example of WRONG tone (do not do this):
  "Arun Rao is introducing Joe to Emma Brunskill... Does Joe want to meet?"

Example of good suggested_actions for the Arun/Emma intro above:
  [
    { "label": "Schedule with Emma", "decision": "team_to_action", "is_snooze": false },
    { "label": "Ask Arun for context first", "decision": "principal_to_respond", "is_snooze": false },
    { "label": "Politely pass", "decision": "team_to_decline", "is_snooze": false },
    { "label": "I'll think about it", "decision": "principal_to_respond", "is_snooze": true }
  ]`;

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sess = readSession(req);
  if (!sess) {
    return res.status(401).json({ message: "not authenticated" });
  }
  (req as any).auth = sess;
  next();
}

function actorForReq(req: Request): string {
  const sess = (req as any).auth as TokenSession | undefined;
  const base = sess?.identity || sess?.role || "system";
  // Team members can opt into "recording for Joe" mode by setting the
  // X-Acting-As: joe header. The actor we log keeps their real identity
  // so the audit trail shows who actually clicked, but flags it as a
  // proxy action. We refuse the header from anyone other than a real
  // team session to keep this from being abused via curl.
  const actingAs = String(req.headers["x-acting-as"] || "").toLowerCase().trim();
  if (actingAs === "joe" && sess?.role === "team") {
    return `${base} (as joe)`;
  }
  return base;
}

// True when the current request is a team member recording for Joe.
// Used to attribute principal notes to Joe even though the click came
// from Alexandra or Meghan.
function isActingAsJoe(req: Request): boolean {
  const sess = (req as any).auth as TokenSession | undefined;
  const actingAs = String(req.headers["x-acting-as"] || "").toLowerCase().trim();
  return actingAs === "joe" && sess?.role === "team";
}

// -------------------------------------------------------------
// Meeting Tracker integration
// NOTE: As of build time the /api/ingest/meetings endpoint on the
// Meeting Tracker does not exist yet — Alexandra will add it
// separately. We intentionally do NOT modify the Meeting Tracker
// codebase. The fetch will most likely 404; we surface that via
// a system note on the item so the team can retry once the
// endpoint is live.
// -------------------------------------------------------------
async function sendToMeetingTracker(item: any, actor: string) {
  try {
    const body = {
      requesterName: item.sender_name,
      requesterOrg: item.sender_org,
      requesterEmail: item.sender_email,
      context: (item.context || "").replace(/<[^>]+>/g, "").trim(),
      notes: item.team_note_for_principal || null,
      lastContact: item.date_received,
      source: "the_ledger",
      sourceId: item.id,
    };
    const res = await fetch(`${MEETING_TRACKER_URL}/api/ingest/meetings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: LEDGER_TO_TRACKER_TOKEN
          ? `Bearer ${LEDGER_TO_TRACKER_TOKEN}`
          : "",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data: any = await res.json().catch(() => ({}));
    const trackerId = data?.id || data?.meetingId || null;
    storage.updateItem(item.id, {
      sent_to_meeting_tracker_at: Date.now(),
      meeting_tracker_id: trackerId,
    });
    storage.logActivity({
      item_id: item.id,
      actor,
      event: "sent_to_meeting_tracker",
      detail: JSON.stringify({ trackerId }),
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    storage.logActivity({
      item_id: item.id,
      actor,
      event: "meeting_tracker_failed",
      detail: JSON.stringify({ error: msg }),
    });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Seed if requested (and table empty)
  maybeSeed();

  // ============================================================
  // Auth
  // ============================================================
  // Rate limit: at most 20 sign-in attempts per IP per 15 minutes.
  // Generous enough for normal use, tight enough to block brute force.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "too many sign-in attempts, try again in 15 minutes" },
  });

  // Google sign-in. Front end uses Google Identity Services to obtain an
  // ID token (JWT), then POSTs it here. We verify the JWT signature against
  // Google's published keys, confirm the audience matches our client ID,
  // and check the email is in our allowlist. Anything else gets 403.
  app.post("/api/auth/google", loginLimiter, async (req, res) => {
    const schema = z.object({ credential: z.string().min(20) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "invalid input" });
    }
    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ message: "google client id not configured" });
    }
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: parsed.data.credential,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const email = payload?.email?.toLowerCase();
      const emailVerified = payload?.email_verified;
      if (!email || !emailVerified) {
        return res.status(403).json({ message: "email not verified by google" });
      }
      const entry = lookupAllowlist(email);
      if (!entry) {
        return res.status(403).json({ message: "this account is not authorized" });
      }
      const token = issueToken(entry.role, entry.identity);
      return res.json({ role: entry.role, identity: entry.identity, token });
    } catch (err: any) {
      return res.status(401).json({ message: "could not verify google sign-in" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    revokeToken(req);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const sess = readSession(req);
    if (!sess) return res.json({ role: null, identity: null });
    return res.json({ role: sess.role, identity: sess.identity });
  });

  // ============================================================
  // Config
  // ============================================================
  app.get("/api/config", (_req, res) => {
    res.json({ internalDomains: INTERNAL_DOMAINS });
  });

  // ============================================================
  // Items
  // ============================================================
  app.get("/api/items", requireAuth, (req, res) => {
    // ?scope=active | archived | trash | all_visible (active + archived) | all
    const raw = String((req.query as any).scope || "active");
    const allowed = ["active", "archived", "trash", "all_visible", "all"] as const;
    const scope = (allowed as readonly string[]).includes(raw)
      ? (raw as (typeof allowed)[number])
      : "active";
    res.json(storage.listItems(scope));
  });

  app.get("/api/items/:id", requireAuth, (req, res) => {
    const item = storage.getItem((req.params.id as string));
    if (!item) return res.status(404).json({ message: "not found" });
    res.json(item);
  });

  app.post("/api/items", requireAuth, (req, res) => {
    const parsed = insertItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "invalid item", issues: parsed.error.issues });
    }
    const item = storage.createItem(parsed.data as InsertItem);
    storage.logActivity({
      item_id: item.id,
      actor: actorForReq(req),
      event: "created_manual",
      detail: null,
    });
    res.json(item);
  });

  // Soft-delete: moves the item to trash. Hard purge happens after 30 days
  // via the periodic purge sweep in server/index.ts.
  app.delete("/api/items/:id", requireAuth, (req, res) => {
    const id = req.params.id as string;
    const existing = storage.getItem(id);
    if (!existing) return res.status(404).json({ message: "not found" });
    if (existing.deleted_at) {
      // Already in trash — explicit ?hard=1 triggers permanent delete.
      if ((req.query as any).hard === "1") {
        storage.deleteItem(id);
        return res.json({ ok: true, hardDeleted: true });
      }
      return res.json({ ok: true, alreadyDeleted: true });
    }
    const actor = actorForReq(req);
    const updated = storage.softDeleteItem(id);
    storage.logActivity({
      item_id: id,
      actor,
      event: "item_deleted",
      detail: null,
    });
    res.json({ ok: true, item: updated });
  });

  app.post("/api/items/:id/restore", requireAuth, (req, res) => {
    const id = req.params.id as string;
    const existing = storage.getItem(id);
    if (!existing) return res.status(404).json({ message: "not found" });
    const updated = storage.restoreItem(id);
    storage.logActivity({
      item_id: id,
      actor: actorForReq(req),
      event: "item_restored",
      detail: null,
    });
    res.json({ ok: true, item: updated });
  });

  app.post("/api/items/:id/archive", requireAuth, (req, res) => {
    const id = req.params.id as string;
    const existing = storage.getItem(id);
    if (!existing) return res.status(404).json({ message: "not found" });
    const updated = storage.archiveItem(id);
    storage.logActivity({
      item_id: id,
      actor: actorForReq(req),
      event: "item_archived",
      detail: null,
    });
    res.json({ ok: true, item: updated });
  });

  app.post("/api/items/:id/unarchive", requireAuth, (req, res) => {
    const id = req.params.id as string;
    const existing = storage.getItem(id);
    if (!existing) return res.status(404).json({ message: "not found" });
    const updated = storage.unarchiveItem(id);
    storage.logActivity({
      item_id: id,
      actor: actorForReq(req),
      event: "item_unarchived",
      detail: null,
    });
    res.json({ ok: true, item: updated });
  });

  // Bulk action on multiple items. Loops over the ids and applies the
  // requested action to each. Returns counts of successes and failures
  // instead of failing the whole batch on one bad id. Same actor flows
  // through every activity log entry, so capture mode ("x as joe") is
  // preserved across the batch.
  app.post("/api/items/bulk", requireAuth, (req, res) => {
    const schema = z.object({
      ids: z.array(z.string().min(1)).min(1).max(500),
      action: z.enum(["archive", "unarchive", "delete", "restore"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "invalid input" });
    }
    const { ids, action } = parsed.data;
    const actor = actorForReq(req);
    const updated: string[] = [];
    const skipped: string[] = [];

    for (const id of ids) {
      const existing = storage.getItem(id);
      if (!existing) {
        skipped.push(id);
        continue;
      }
      try {
        if (action === "archive") {
          if (existing.archived_at || existing.deleted_at) {
            skipped.push(id);
            continue;
          }
          storage.archiveItem(id);
          storage.logActivity({ item_id: id, actor, event: "item_archived", detail: null });
        } else if (action === "unarchive") {
          if (!existing.archived_at) {
            skipped.push(id);
            continue;
          }
          storage.unarchiveItem(id);
          storage.logActivity({ item_id: id, actor, event: "item_unarchived", detail: null });
        } else if (action === "delete") {
          if (existing.deleted_at) {
            skipped.push(id);
            continue;
          }
          storage.softDeleteItem(id);
          storage.logActivity({ item_id: id, actor, event: "item_deleted", detail: null });
        } else if (action === "restore") {
          if (!existing.deleted_at) {
            skipped.push(id);
            continue;
          }
          storage.restoreItem(id);
          storage.logActivity({ item_id: id, actor, event: "item_restored", detail: null });
        }
        updated.push(id);
      } catch {
        skipped.push(id);
      }
    }
    res.json({ ok: true, updated: updated.length, skipped: skipped.length, updatedIds: updated });
  });

  app.patch("/api/items/:id", requireAuth, async (req, res) => {
    const existing = storage.getItem((req.params.id as string));
    if (!existing) return res.status(404).json({ message: "not found" });
    const patch: any = { ...req.body };
    // Optional metadata about WHICH button was clicked (the visible label).
    // We strip it from the persisted patch and attach to decision_made activity.
    const actionLabel: string | null =
      typeof patch.action_label === "string" && patch.action_label.trim()
        ? patch.action_label.trim().slice(0, 80)
        : null;
    delete patch.action_label;
    const actor = actorForReq(req);
    const now = Date.now();

    const decisionChanging =
      patch.decision !== undefined && patch.decision !== existing.decision;
    const statusChanging =
      patch.status !== undefined && patch.status !== existing.status;
    const ownerChanging =
      patch.owner !== undefined && patch.owner !== existing.owner;

    const undoingDecision =
      decisionChanging &&
      (patch.decision === null || patch.decision === "") &&
      existing.decision !== null;

    // custom_actions: accept either a CustomAction[] array, a JSON string,
    // or null/empty to clear. Normalize to either a JSON string of a
    // 2-4 entry array, or null. Reject malformed input.
    let customActionsChanging = false;
    let customActionsNewVal: string | null | undefined = undefined;
    if (patch.custom_actions !== undefined) {
      const incoming = patch.custom_actions;
      if (incoming === null || incoming === "") {
        customActionsNewVal = null;
      } else {
        let arr: any;
        if (typeof incoming === "string") {
          try {
            arr = JSON.parse(incoming);
          } catch {
            return res.status(400).json({ message: "custom_actions: invalid JSON" });
          }
        } else {
          arr = incoming;
        }
        if (!Array.isArray(arr)) {
          return res.status(400).json({ message: "custom_actions must be an array" });
        }
        const validDecisions = new Set([
          "team_to_action",
          "team_to_decline",
          "principal_to_respond",
          "delegate",
        ]);
        const cleaned = arr
          .map((a: any, i: number) => {
            if (!a || typeof a !== "object") return null;
            const label = String(a.label || "").trim().slice(0, 60);
            const decision = String(a.decision || "").trim();
            if (!label || !validDecisions.has(decision)) return null;
            return {
              id: String(a.id || `act_${i + 1}`),
              label,
              decision,
              is_snooze: Boolean(a.is_snooze),
            };
          })
          .filter((a: any) => a !== null)
          .slice(0, 4);
        if (cleaned.length > 0 && cleaned.length < 2) {
          return res.status(400).json({ message: "custom_actions: need 0, or 2-4 entries" });
        }
        customActionsNewVal = cleaned.length === 0 ? null : JSON.stringify(cleaned);
      }
      customActionsChanging = (customActionsNewVal || null) !== (existing.custom_actions || null);
      patch.custom_actions = customActionsNewVal;
    }
    const principalNoteChanging =
      patch.principal_note !== undefined &&
      (patch.principal_note || null) !== (existing.principal_note || null);
    const teamNoteChanging =
      patch.team_note_for_principal !== undefined &&
      (patch.team_note_for_principal || null) !==
        (existing.team_note_for_principal || null);
    const timeSensitiveChanging =
      patch.is_time_sensitive !== undefined &&
      !!patch.is_time_sensitive !== !!existing.is_time_sensitive;
    const categoryChanging =
      patch.category !== undefined && patch.category !== existing.category;
    const contextChanging =
      patch.context !== undefined && patch.context !== existing.context;
    const subjectChanging =
      patch.subject !== undefined && patch.subject !== existing.subject;
    const emailUrlChanging =
      patch.email_url !== undefined &&
      (patch.email_url || null) !== (existing.email_url || null);

    if (decisionChanging) {
      patch.decided_at = undoingDecision ? null : now;
      if (undoingDecision) {
        // Wipe delegate name when reverting to awaiting Joe.
        patch.delegate_to = null;
      } else {
        // Once a real decision lands, clear any snooze flag — the item
        // is no longer in the "thinking" pile.
        if (existing.snoozed_at) patch.snoozed_at = null;
      }
    }
    patch.last_touched_by = actor;
    patch.last_touched_at = now;

    const updated = storage.updateItem(existing.id, patch);
    if (!updated) return res.status(500).json({ message: "update failed" });

    if (decisionChanging) {
      if (undoingDecision) {
        storage.logActivity({
          item_id: updated.id,
          actor,
          event: "decision_undone",
          detail: JSON.stringify({
            from: existing.decision,
            from_delegate: existing.delegate_to,
          }),
        });
      } else {
        storage.logActivity({
          item_id: updated.id,
          actor,
          event: "decision_made",
          detail: JSON.stringify({
            decision: updated.decision,
            delegate_to: updated.delegate_to,
            label: actionLabel,
          }),
        });
      }
    }
    if (principalNoteChanging && updated.principal_note) {
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "principal_note_added",
        detail: null,
      });
      storage.createNote({
        item_id: updated.id,
        author: "joe",
        body: updated.principal_note,
      });
    }
    if (statusChanging) {
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "status_changed",
        detail: JSON.stringify({ status: updated.status }),
      });
    }
    if (ownerChanging) {
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "owner_changed",
        detail: JSON.stringify({ owner: updated.owner }),
      });
    }
    if (teamNoteChanging) {
      const newVal = updated.team_note_for_principal || null;
      const action = newVal
        ? existing.team_note_for_principal
          ? "updated"
          : "added"
        : "cleared";
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "team_note_changed",
        detail: JSON.stringify({ action, value: newVal }),
      });
    }
    if (timeSensitiveChanging) {
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "time_sensitive_changed",
        detail: JSON.stringify({ to: !!updated.is_time_sensitive }),
      });
    }
    if (categoryChanging) {
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "category_changed",
        detail: JSON.stringify({ from: existing.category, to: updated.category }),
      });
    }
    if (customActionsChanging) {
      let count = 0;
      try {
        const parsed = updated.custom_actions ? JSON.parse(updated.custom_actions) : [];
        if (Array.isArray(parsed)) count = parsed.length;
      } catch {}
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "custom_actions_edited",
        detail: JSON.stringify({
          count,
          cleared: !updated.custom_actions,
        }),
      });
    }
    const detailFields: string[] = [];
    if (patch.sender_name !== undefined && patch.sender_name !== existing.sender_name) {
      detailFields.push("sender_name");
    }
    if (patch.sender_org !== undefined && (patch.sender_org || null) !== (existing.sender_org || null)) {
      detailFields.push("sender_org");
    }
    if (patch.sender_email !== undefined && (patch.sender_email || null) !== (existing.sender_email || null)) {
      detailFields.push("sender_email");
    }
    if (patch.date_received !== undefined && patch.date_received !== existing.date_received) {
      detailFields.push("date_received");
    }
    if (subjectChanging) detailFields.push("subject");
    if (contextChanging) detailFields.push("context");
    if (emailUrlChanging) detailFields.push("email_url");
    if (detailFields.length > 0) {
      storage.logActivity({
        item_id: updated.id,
        actor,
        event: "context_edited",
        detail: JSON.stringify({ fields: detailFields }),
      });
    }

    // Fire-and-forget Meeting Tracker handoff
    if (
      decisionChanging &&
      !undoingDecision &&
      updated.decision === "team_to_action" &&
      updated.category === "meeting_request" &&
      !updated.sent_to_meeting_tracker_at
    ) {
      sendToMeetingTracker(updated, actor);
    }
    res.json(updated);
  });

  app.post("/api/items/:id/skip", requireAuth, (req, res) => {
    const updated = storage.incrementSkip((req.params.id as string));
    if (!updated) return res.status(404).json({ message: "not found" });
    storage.logActivity({
      item_id: updated.id,
      actor: actorForReq(req),
      event: "skipped",
      detail: null,
    });
    res.json(updated);
  });

  // Snooze: Joe taps a "think about it" button. We mark snoozed_at
  // and intentionally do NOT set a decision — the item remains in
  // "Awaiting Joe" buckets while also showing up in the side rail.
  app.post("/api/items/:id/snooze", requireAuth, (req, res) => {
    const id = req.params.id as string;
    const existing = storage.getItem(id);
    if (!existing) return res.status(404).json({ message: "not found" });
    const actor = actorForReq(req);
    const label =
      typeof req.body?.action_label === "string" && req.body.action_label.trim()
        ? req.body.action_label.trim().slice(0, 80)
        : null;
    const updated = storage.updateItem(id, {
      snoozed_at: Date.now(),
      last_touched_by: actor,
      last_touched_at: Date.now(),
    } as any);
    if (!updated) return res.status(500).json({ message: "snooze failed" });
    storage.logActivity({
      item_id: id,
      actor,
      event: "decision_snoozed",
      detail: JSON.stringify({ label }),
    });
    res.json(updated);
  });

  app.post("/api/items/:id/unsnooze", requireAuth, (req, res) => {
    const id = req.params.id as string;
    const existing = storage.getItem(id);
    if (!existing) return res.status(404).json({ message: "not found" });
    const actor = actorForReq(req);
    const updated = storage.updateItem(id, {
      snoozed_at: null,
      last_touched_by: actor,
      last_touched_at: Date.now(),
    } as any);
    if (!updated) return res.status(500).json({ message: "unsnooze failed" });
    storage.logActivity({
      item_id: id,
      actor,
      event: "decision_unsnoozed",
      detail: null,
    });
    res.json(updated);
  });

  app.post(
    "/api/items/:id/retry-meeting-tracker",
    requireAuth,
    async (req, res) => {
      const item = storage.getItem((req.params.id as string));
      if (!item) return res.status(404).json({ message: "not found" });
      await sendToMeetingTracker(item, actorForReq(req));
      res.json(storage.getItem((req.params.id as string)));
    },
  );

  // ============================================================
  // Notes
  // ============================================================
  app.get("/api/items/:id/notes", requireAuth, (req, res) => {
    res.json(storage.listNotes((req.params.id as string)));
  });
  app.post("/api/items/:id/notes", requireAuth, (req, res) => {
    const body = z
      .object({ body: z.string().min(1), author: z.string().optional() })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "invalid" });
    const note = storage.createNote({
      item_id: (req.params.id as string),
      author: body.data.author || actorForReq(req),
      body: body.data.body,
    });
    storage.logActivity({
      item_id: (req.params.id as string),
      actor: actorForReq(req),
      event: "note_added",
      detail: null,
    });
    res.json(note);
  });

  // ============================================================
  // Activity log
  // ============================================================
  app.get("/api/items/:id/activity", requireAuth, (req, res) => {
    res.json(storage.listActivity((req.params.id as string)));
  });

  // ============================================================
  // Parser endpoint (Claude)
  // ============================================================
  // Rate limit parse: at most 60 parses per signed-in user per hour.
  // Each parse costs real money (Claude API) and runs Anthropic's model;
  // this caps both runaway loops and a hostile insider abusing the endpoint.
  const parseLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const h = req.headers.authorization || "";
      const m = /^Bearer\s+(.+)$/i.exec(h);
      return m ? `t:${m[1]}` : `ip:${req.ip}`;
    },
    message: { message: "too many parses this hour, try again later" },
  });

  app.post("/api/items/parse", parseLimiter, requireAuth, async (req, res) => {
    const schema = z.object({
      mode: z.enum(["text", "pdf"]),
      content: z.string().min(1),
      emailUrl: z.string().optional().nullable(),
      teamNoteForPrincipal: z.string().optional().nullable(),
      isTimeSensitive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "invalid input" });
    }
    if (!CLAUDE_API_KEY) {
      return res
        .status(500)
        .json({ message: "CLAUDE_API_KEY not configured" });
    }
    const { mode, content, emailUrl, teamNoteForPrincipal, isTimeSensitive } =
      parsed.data;

    let messages: any[];
    if (mode === "pdf") {
      messages = [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: content,
              },
            },
            { type: "text", text: PARSER_PROMPT },
          ],
        },
      ];
    } else {
      messages = [
        {
          role: "user",
          content: `${PARSER_PROMPT}\n\nEMAIL:\n${content}`,
        },
      ];
    }
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          messages,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        return res
          .status(502)
          .json({ message: `Claude error ${r.status}: ${text}` });
      }
      const data: any = await r.json();
      const textBlock = (data.content || []).find(
        (b: any) => b.type === "text",
      );
      let raw: string = textBlock?.text || "";
      raw = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      let parsedJson: any;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        return res
          .status(502)
          .json({ message: "Claude returned non-JSON", raw });
      }

      // Sanitize Claude's suggested_actions into a clean CustomAction[]
      // shape before we persist. We tolerate Claude returning slightly
      // wrong types (missing is_snooze, weird casing, extra fields) by
      // normalizing each entry and dropping anything we can't fix.
      const rawSuggested: any[] = Array.isArray(parsedJson.suggested_actions)
        ? parsedJson.suggested_actions
        : [];
      const validDecisions = new Set([
        "team_to_action",
        "team_to_decline",
        "principal_to_respond",
        "delegate",
      ]);
      const cleanedActions = rawSuggested
        .map((a, i) => {
          if (!a || typeof a !== "object") return null;
          const label = String(a.label || "").trim().slice(0, 60);
          const decision = String(a.decision || "").trim();
          if (!label) return null;
          if (!validDecisions.has(decision)) return null;
          return {
            id: `act_${i + 1}`,
            label,
            decision,
            is_snooze: Boolean(a.is_snooze),
          };
        })
        .filter((a): a is { id: string; label: string; decision: string; is_snooze: boolean } => a !== null)
        .slice(0, 4);

      const item: InsertItem = {
        date_received:
          parsedJson.date_received || new Date().toISOString().slice(0, 10),
        sender_name: parsedJson.sender_name || "Unknown",
        sender_org: parsedJson.sender_org ?? null,
        sender_email: parsedJson.sender_email ?? null,
        subject: parsedJson.subject || "(no subject)",
        category: parsedJson.category || "other",
        context: parsedJson.context || "",
        email_url: emailUrl || null,
        team_note_for_principal: teamNoteForPrincipal || null,
        is_time_sensitive:
          (isTimeSensitive ?? parsedJson.is_time_sensitive) ? 1 : 0,
        implied_action: parsedJson.implied_actions
          ? JSON.stringify(parsedJson.implied_actions)
          : null,
        decision: null,
        delegate_to: null,
        owner: null,
        status: "not_started",
        last_touched_by: null,
        skip_count: 0,
        meeting_tracker_id: null,
        custom_actions: cleanedActions.length >= 2 ? JSON.stringify(cleanedActions) : null,
      };
      const created = storage.createItem(item);
      storage.logActivity({
        item_id: created.id,
        actor: actorForReq(req),
        event: "parsed",
        detail: null,
      });
      return res.json(created);
    } catch (err: any) {
      return res
        .status(500)
        .json({ message: err?.message || "parser failed" });
    }
  });

  return httpServer;
}

function labelDecision(decision: string | null, delegateTo: string | null) {
  switch (decision) {
    case "team_to_action":
      return "Team to action";
    case "team_to_decline":
      return "Team to decline";
    case "principal_to_respond":
      return "Joe to respond";
    case "delegate":
      return delegateTo ? `Delegate → ${delegateTo}` : "Delegate";
    default:
      return "Awaiting Joe";
  }
}
