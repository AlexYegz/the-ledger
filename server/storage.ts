import {
  items,
  notes,
  activity_log,
  type Item,
  type InsertItem,
  type Note,
  type InsertNote,
  type Activity,
  type InsertActivity,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

// DB path: use DATA_DIR if set (Railway volume), else local data.db.
const DB_PATH = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, "")}/ledger.db`
  : "data.db";
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {}
// One-time migration: if volume DB is empty but a local data.db exists, copy it over.
if (process.env.DATA_DIR && !existsSync(DB_PATH) && existsSync("data.db")) {
  try { copyFileSync("data.db", DB_PATH); } catch {}
}
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Ensure tables exist (lightweight migrate-on-boot for dev/prod).
sqlite.exec(`
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  date_received TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_org TEXT,
  sender_email TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  context TEXT NOT NULL,
  email_url TEXT,
  team_note_for_principal TEXT,
  is_time_sensitive INTEGER NOT NULL DEFAULT 0,
  decision TEXT,
  delegate_to TEXT,
  implied_action TEXT,
  decided_at INTEGER,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  last_touched_by TEXT,
  last_touched_at INTEGER,
  sent_to_meeting_tracker_at INTEGER,
  meeting_tracker_id TEXT,
  skip_count INTEGER NOT NULL DEFAULT 0,
  principal_note TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_notes_item ON notes(item_id);
CREATE INDEX IF NOT EXISTS idx_activity_item ON activity_log(item_id);
`);

// Migrations for existing DBs: add new columns idempotently.
try {
  const cols = sqlite.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("principal_note")) {
    sqlite.exec("ALTER TABLE items ADD COLUMN principal_note TEXT;");
  }
} catch {
  // best-effort
}

export const db = drizzle(sqlite);

export interface IStorage {
  listItems(): Item[];
  getItem(id: string): Item | undefined;
  createItem(data: InsertItem): Item;
  updateItem(id: string, patch: Partial<Item>): Item | undefined;
  deleteItem(id: string): boolean;
  incrementSkip(id: string): Item | undefined;

  listNotes(itemId: string): Note[];
  createNote(data: InsertNote): Note;

  listActivity(itemId: string): Activity[];
  logActivity(data: InsertActivity): Activity;
}

export class SqliteStorage implements IStorage {
  listItems(): Item[] {
    return db.select().from(items).orderBy(desc(items.date_received), desc(items.created_at)).all();
  }
  getItem(id: string): Item | undefined {
    return db.select().from(items).where(eq(items.id, id)).get();
  }
  createItem(data: InsertItem): Item {
    const id = randomUUID();
    const row = {
      ...data,
      id,
      is_time_sensitive: data.is_time_sensitive ?? 0,
      status: data.status ?? "not_started",
      skip_count: data.skip_count ?? 0,
    } as any;
    return db.insert(items).values(row).returning().get();
  }
  updateItem(id: string, patch: Partial<Item>): Item | undefined {
    const existing = this.getItem(id);
    if (!existing) return undefined;
    db.update(items).set(patch).where(eq(items.id, id)).run();
    return this.getItem(id);
  }
  deleteItem(id: string): boolean {
    const r = db.delete(items).where(eq(items.id, id)).run();
    db.delete(notes).where(eq(notes.item_id, id)).run();
    db.delete(activity_log).where(eq(activity_log.item_id, id)).run();
    return r.changes > 0;
  }
  incrementSkip(id: string): Item | undefined {
    const existing = this.getItem(id);
    if (!existing) return undefined;
    db.update(items)
      .set({ skip_count: (existing.skip_count ?? 0) + 1 })
      .where(eq(items.id, id))
      .run();
    return this.getItem(id);
  }
  listNotes(itemId: string): Note[] {
    return db
      .select()
      .from(notes)
      .where(eq(notes.item_id, itemId))
      .orderBy(notes.created_at)
      .all();
  }
  createNote(data: InsertNote): Note {
    const id = randomUUID();
    return db.insert(notes).values({ ...data, id } as any).returning().get();
  }
  listActivity(itemId: string): Activity[] {
    return db
      .select()
      .from(activity_log)
      .where(eq(activity_log.item_id, itemId))
      .orderBy(desc(activity_log.created_at))
      .all();
  }
  logActivity(data: InsertActivity): Activity {
    const id = randomUUID();
    return db.insert(activity_log).values({ ...data, id } as any).returning().get();
  }
}

export const storage = new SqliteStorage();

// ============================================================
// Optional seed for QA — runs once if SEED_SAMPLE_DATA=1 and table empty.
// ============================================================
export function maybeSeed() {
  if (process.env.SEED_SAMPLE_DATA !== "1") return;
  const existing = storage.listItems();
  if (existing.length > 0) return;
  const now = Date.now();
  const sample: InsertItem[] = [
    {
      date_received: "2025-04-03",
      sender_name: "Michael Carter",
      sender_org: "Carter Morse & Goodrich",
      sender_email: "michael@cartermorse.com",
      subject: "TEDx Innovation Drive Invitation",
      category: "meeting_request",
      context:
        "<b>Michael Carter</b>, organizer of TEDx Innovation Drive and Managing Partner at Carter Morse & Goodrich, is inviting Joe to speak at an invitation-only gathering of 300 innovation leaders in Fairfield, CT on September 30. He believes Joe's work on AI-driven learning is uniquely positioned to anchor a compelling talk. <b>Time sensitive.</b> <b>Does Joe want to speak at TEDx?</b>",
      email_url: "https://mail.google.com/mail/u/0/#inbox/abc1",
      team_note_for_principal:
        "He's reached out twice before. Last year you wanted to defer to next cycle. Confirming whether that still holds.",
      is_time_sensitive: 1,
      implied_action: JSON.stringify({
        team_to_action: "accept invitation and schedule shaping call",
        team_to_decline: "graceful pass, leave door open",
        principal_to_respond: "handle this one personally",
        delegate: "forward to chief of staff",
      }),
      decision: "team_to_decline",
      owner: "meghan",
      status: "in_progress",
    },
    {
      date_received: "2025-04-03",
      sender_name: "Ben Somers",
      sender_org: "Recess",
      sender_email: "ben@recess.co",
      subject: "Quick intro — Maya Chen at OpenAI",
      category: "intro",
      context:
        "<b>Ben Somers</b> from Recess is double-opting an intro to <b>Maya Chen</b>, an AI policy researcher at OpenAI working on education benchmarks. He thinks her work overlaps directly with Alpha School's curriculum measurement effort. <b>Does Joe want the intro?</b>",
      email_url: null,
      team_note_for_principal: null,
      is_time_sensitive: 0,
      implied_action: JSON.stringify({
        team_to_action: "accept intro and propose two times",
        team_to_decline: "thank Ben, not the right moment",
        principal_to_respond: "Joe replies directly to Ben",
        delegate: "forward to chief of staff",
      }),
      decision: "team_to_action",
      owner: "meghan",
      status: "not_started",
    },
    {
      date_received: "2025-04-03",
      sender_name: "Jack McDonald",
      sender_org: "Texas Sports Academy",
      sender_email: "jack@texassportsacademy.com",
      subject: "Invitation to advisory board",
      category: "invitation",
      context:
        "<b>Jack McDonald</b>, founder of Texas Sports Academy, is inviting Joe onto the advisory board for the academy's new AI-assisted athletics program. Time commitment is two meetings per year. <b>Time sensitive.</b> <b>Does Joe want to join the board?</b>",
      email_url: null,
      team_note_for_principal:
        "Jack and Joe overlapped at Alpha last fall. Warm relationship.",
      is_time_sensitive: 1,
      implied_action: JSON.stringify({
        team_to_action: "accept and confirm two-meeting cadence",
        team_to_decline: "thank Jack, full plate this year",
        principal_to_respond: "Joe wants to reply himself",
        delegate: "loop in Eliot for diligence",
      }),
      decision: "principal_to_respond",
      owner: "alexandra",
      status: "waiting",
    },
    {
      date_received: "2025-04-02",
      sender_name: "Hilary Link",
      sender_org: "Drew University",
      sender_email: "president@drew.edu",
      subject: "Meeting request — Drew x Alpha pilot",
      category: "meeting_request",
      context:
        "<b>Hilary Link</b>, President of Drew University, is asking for a 30-minute call to discuss a possible Alpha-style undergraduate pilot at Drew. She'd like to bring her provost on the call. <b>Does Joe want to take the call?</b>",
      is_time_sensitive: 0,
      implied_action: JSON.stringify({
        team_to_action: "schedule a 30-min call next month",
        team_to_decline: "polite pass with a referral",
        principal_to_respond: "Joe replies directly",
        delegate: "send to Eliot to scope a pilot",
      }),
      decision: "delegate",
      delegate_to: "Eliot",
      owner: "meghan",
      status: "complete",
    },
    {
      date_received: "2025-04-02",
      sender_name: "Tasha Arnold",
      sender_org: "Alpha Schools",
      sender_email: "tasha@alpha.school",
      subject: "Approval needed: Q2 curriculum spend",
      category: "response_needed",
      context:
        "<b>Tasha Arnold</b> needs Joe's sign-off on the Q2 curriculum content budget — $480K, up 12% from Q1, driven by new STEM module licensing. She has the line-item breakdown ready. <b>Does Joe approve the Q2 spend?</b>",
      is_time_sensitive: 0,
      implied_action: JSON.stringify({
        team_to_action: "log approval and reply yes",
        team_to_decline: "reply no, ask for revised plan",
        principal_to_respond: "Joe replies with conditions",
        delegate: "send to CFO to validate first",
      }),
      decision: null,
      owner: null,
      status: "not_started",
    },
    {
      date_received: "2025-04-01",
      sender_name: "Sarah Whitfield",
      sender_org: "Whitfield Capital",
      sender_email: "sarah@whitfieldcap.com",
      subject: "Series C participation",
      category: "funding",
      context:
        "<b>Sarah Whitfield</b> at Whitfield Capital wants to participate in the upcoming Series C at a $1.4B pre-money. She's offering to lead with $40M. <b>Does Joe want to take the meeting?</b>",
      is_time_sensitive: 0,
      implied_action: JSON.stringify({
        team_to_action: "schedule a 45-min intro call",
        team_to_decline: "polite pass, round is full",
        principal_to_respond: "Joe replies directly",
        delegate: "send to CFO",
      }),
      decision: null,
      owner: null,
      status: "not_started",
    },
  ];
  for (const s of sample) storage.createItem(s);
  console.log(`[seed] inserted ${sample.length} sample items`);
}
