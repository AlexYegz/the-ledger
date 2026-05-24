import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { storage, maybeSeed } from "./storage";
import {
  insertItemSchema,
  insertNoteSchema,
  type InsertItem,
} from "@shared/schema";
import {
  CLAUDE_API_KEY,
  CLAUDE_MODEL,
  INTERNAL_DOMAINS,
  LEDGER_PRINCIPAL_PASSWORD,
  LEDGER_TEAM_PASSWORD,
  LEDGER_TO_TRACKER_TOKEN,
  MEETING_TRACKER_URL,
} from "./config";
import { z } from "zod";

// ============================================================
// Token-based auth (cookies don't survive the proxy iframe)
// ============================================================
type Role = "principal" | "team";
type Identity = "meghan" | "alexandra" | "joe";
type TokenSession = { role: Role; identity: Identity; createdAt: number };
const SESSIONS = new Map<string, TokenSession>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function issueToken(role: Role, identity: Identity): string {
  const token = crypto.randomBytes(32).toString("hex");
  SESSIONS.set(token, { role, identity, createdAt: Date.now() });
  return token;
}

function readSession(req: Request): TokenSession | null {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const sess = SESSIONS.get(m[1]);
  if (!sess) return null;
  if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
    SESSIONS.delete(m[1]);
    return null;
  }
  return sess;
}

function revokeToken(req: Request): void {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) SESSIONS.delete(m[1]);
}

const PARSER_PROMPT = `You are parsing an email/request to fill a row in The Ledger — a decision tracker used by two executive assistants who support a principal named Joe.

Extract the fields below and return ONLY valid JSON — no explanation, no markdown, no code fences.

{
  "date_received": "YYYY-MM-DD (date the email was sent; today's date if not found)",
  "sender_name": "Sender's full name only, e.g. 'John Smith'",
  "sender_org": "Sender's company or organization, or null if none",
  "sender_email": "Sender's email address, or null if not present",
  "subject": "Exact email subject line",
  "category": "ONE of: meeting_request, approval, response_needed, invitation, intro, funding, sales, other",
  "context": "2-3 sentences summarizing the email. Bold all names except Joe using <b> tags. Never use Joe's last name. End with a single bolded yes/no question for Joe as the final sentence, e.g. <b>Does Joe want to meet?</b> If there is a deadline or hard time constraint, include <b>Time sensitive.</b> before the final question.",
  "is_time_sensitive": true or false,
  "implied_actions": {
    "team_to_action": "Brief lowercase fragment describing what the team would do if Joe picks Team to Action, e.g. 'accept invitation and schedule shaping call'",
    "team_to_decline": "Brief lowercase fragment for the decline path, e.g. 'graceful pass, leave door open'",
    "principal_to_respond": "Brief lowercase fragment for Joe handling it himself",
    "delegate": "Brief lowercase fragment for delegation, e.g. 'forward to chief of staff'"
  }
}`;

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
  return sess?.identity || sess?.role || "system";
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
    const stamp = new Date().toLocaleString();
    storage.createNote({
      item_id: item.id,
      author: "system",
      body: `Sent to Meeting Tracker · ${stamp}${trackerId ? ` · id ${trackerId}` : ""}`,
    });
    storage.logActivity({
      item_id: item.id,
      actor,
      event: "sent_to_meeting_tracker",
      detail: JSON.stringify({ trackerId }),
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    storage.createNote({
      item_id: item.id,
      author: "system",
      body: `Failed to send to Meeting Tracker · ${msg}. Click to retry.`,
    });
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
  app.post("/api/auth/login", (req, res) => {
    const schema = z.object({
      role: z.enum(["principal", "team"]),
      password: z.string(),
      identity: z.enum(["meghan", "alexandra"]).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "invalid input" });
    }
    const { role, password, identity } = parsed.data;
    if (role === "principal") {
      if (password !== LEDGER_PRINCIPAL_PASSWORD) {
        return res.status(401).json({ message: "wrong password" });
      }
      const token = issueToken("principal", "joe");
      return res.json({ role: "principal", identity: "joe", token });
    }
    // team
    if (password !== LEDGER_TEAM_PASSWORD) {
      return res.status(401).json({ message: "wrong password" });
    }
    if (!identity) {
      return res.status(400).json({ message: "team identity required" });
    }
    const token = issueToken("team", identity);
    return res.json({ role: "team", identity, token });
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
  app.get("/api/items", requireAuth, (_req, res) => {
    res.json(storage.listItems());
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

  app.delete("/api/items/:id", requireAuth, (req, res) => {
    storage.deleteItem((req.params.id as string));
    res.json({ ok: true });
  });

  app.patch("/api/items/:id", requireAuth, async (req, res) => {
    const existing = storage.getItem((req.params.id as string));
    if (!existing) return res.status(404).json({ message: "not found" });
    const patch: any = { ...req.body };
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
    const principalNoteChanging =
      patch.principal_note !== undefined &&
      (patch.principal_note || null) !== (existing.principal_note || null);

    if (decisionChanging) {
      patch.decided_at = undoingDecision ? null : now;
      if (undoingDecision) {
        // Wipe delegate name when reverting to awaiting Joe.
        patch.delegate_to = null;
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
        storage.createNote({
          item_id: updated.id,
          author: "system",
          body: `${actor} reverted Joe's call. Back to awaiting Joe.`,
        });
      } else {
        storage.logActivity({
          item_id: updated.id,
          actor,
          event: "decision_made",
          detail: JSON.stringify({
            decision: updated.decision,
            delegate_to: updated.delegate_to,
          }),
        });
        const decisionLabel = labelDecision(
          updated.decision,
          updated.delegate_to,
        );
        storage.createNote({
          item_id: updated.id,
          author: "system",
          body: `Joe's call: ${decisionLabel}.`,
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
  app.post("/api/items/parse", requireAuth, async (req, res) => {
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
