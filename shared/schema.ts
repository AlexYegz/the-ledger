import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ============================================================
// items — rows in the ledger
// ============================================================
export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  created_at: integer("created_at").notNull().default(sql`(strftime('%s','now') * 1000)`),
  date_received: text("date_received").notNull(),
  sender_name: text("sender_name").notNull(),
  sender_org: text("sender_org"),
  sender_email: text("sender_email"),
  subject: text("subject").notNull(),
  category: text("category").notNull(),
  context: text("context").notNull(),
  email_url: text("email_url"),
  team_note_for_principal: text("team_note_for_principal"),
  is_time_sensitive: integer("is_time_sensitive").notNull().default(0),
  decision: text("decision"),
  delegate_to: text("delegate_to"),
  // JSON stored as text: { team_to_action, team_to_decline, principal_to_respond, delegate }
  implied_action: text("implied_action"),
  decided_at: integer("decided_at"),
  owner: text("owner"),
  status: text("status").notNull().default("not_started"),
  last_touched_by: text("last_touched_by"),
  last_touched_at: integer("last_touched_at"),
  sent_to_meeting_tracker_at: integer("sent_to_meeting_tracker_at"),
  meeting_tracker_id: text("meeting_tracker_id"),
  skip_count: integer("skip_count").notNull().default(0),
  principal_note: text("principal_note"),
  archived_at: integer("archived_at"),
  deleted_at: integer("deleted_at"),
});

export const insertItemSchema = createInsertSchema(items).omit({
  id: true,
  created_at: true,
  decided_at: true,
  last_touched_at: true,
  sent_to_meeting_tracker_at: true,
});

export type Item = typeof items.$inferSelect;
export type InsertItem = z.infer<typeof insertItemSchema>;

// Categories enum (for validation)
export const CATEGORIES = [
  "meeting_request",
  "approval",
  "response_needed",
  "invitation",
  "intro",
  "funding",
  "sales",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DECISIONS = [
  "team_to_action",
  "team_to_decline",
  "principal_to_respond",
  "delegate",
] as const;
export type Decision = (typeof DECISIONS)[number];

export const STATUSES = [
  "not_started",
  "in_progress",
  "waiting",
  "complete",
  "canceled",
] as const;
export type Status = (typeof STATUSES)[number];

// ============================================================
// notes — threaded notes per item
// ============================================================
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  item_id: text("item_id").notNull(),
  author: text("author").notNull(), // "meghan" | "alexandra" | "joe" | "system"
  body: text("body").notNull(),
  created_at: integer("created_at").notNull().default(sql`(strftime('%s','now') * 1000)`),
});

export const insertNoteSchema = createInsertSchema(notes).omit({
  id: true,
  created_at: true,
});
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

// ============================================================
// activity_log — per-item events
// ============================================================
export const activity_log = sqliteTable("activity_log", {
  id: text("id").primaryKey(),
  item_id: text("item_id").notNull(),
  actor: text("actor").notNull(),
  event: text("event").notNull(),
  detail: text("detail"),
  created_at: integer("created_at").notNull().default(sql`(strftime('%s','now') * 1000)`),
});

export const insertActivitySchema = createInsertSchema(activity_log).omit({
  id: true,
  created_at: true,
});
export type Activity = typeof activity_log.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
