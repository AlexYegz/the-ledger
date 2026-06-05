import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock, Trash2, Archive, ArchiveRestore, RotateCcw } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CategoryPill, DecisionTag, FlameIcon, OwnerAvatar, StatusTag } from "@/components/Bits";
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_CLASS, fmtDate, fmtNoteDate, relTime } from "@/lib/labels";
import type { Item, Note, Activity, Category, Status, Decision } from "@shared/schema";
import { useAuth } from "@/lib/auth";

const STATUSES: Status[] = ["not_started", "in_progress", "waiting", "complete", "canceled"];
const CATEGORIES: Category[] = [
  "meeting_request",
  "approval",
  "response_needed",
  "invitation",
  "intro",
  "funding",
  "sales",
  "other",
];
const DECISIONS: { v: Decision; label: string }[] = [
  { v: "team_to_action", label: "Team to action" },
  { v: "team_to_decline", label: "Team to decline" },
  { v: "principal_to_respond", label: "Joe to respond" },
  { v: "delegate", label: "Delegate" },
];

type RowScope = "active" | "archived" | "trash" | "all_visible";

export function LedgerRow({
  item,
  isInternal,
  readOnly = false,
  scope = "active",
}: {
  item: Item;
  isInternal: boolean;
  readOnly?: boolean;
  scope?: RowScope;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const { me } = useAuth();

  const notesQ = useQuery<Note[]>({
    queryKey: ["/api/items", item.id, "notes"],
    enabled: expanded,
  });

  const activityQ = useQuery<Activity[]>({
    queryKey: ["/api/items", item.id, "activity"],
    enabled: expanded,
  });

  const patchMut = useMutation({
    mutationFn: async (patch: Partial<Item>) => {
      const r = await apiRequest("PATCH", `/api/items/${item.id}`, patch);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items", item.id, "notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items", item.id, "activity"] });
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
  };

  const softDeleteMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `/api/items/${item.id}`);
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const restoreMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/items/${item.id}/restore`);
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const hardDeleteMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `/api/items/${item.id}?hard=1`);
      return r.json().catch(() => ({}));
    },
    onSuccess: invalidateAll,
  });

  const archiveMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/items/${item.id}/archive`);
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const unarchiveMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/items/${item.id}/unarchive`);
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const postNote = useMutation({
    mutationFn: async (body: string) => {
      const r = await apiRequest("POST", `/api/items/${item.id}/notes`, {
        body,
        author: me.identity || "system",
      });
      return r.json();
    },
    onSuccess: () => {
      setNoteDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/items", item.id, "notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items", item.id, "activity"] });
    },
  });

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={`ledger-row ${expanded ? "expanded" : ""}`}
      data-testid={`row-${item.id}`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="row-date">
        {readOnly ? (
          item.is_time_sensitive ? <FlameIcon className="row-flame" /> : null
        ) : (
          <button
            className={`row-flame-toggle ${item.is_time_sensitive ? "on" : "off"}`}
            onClick={(e) => {
              e.stopPropagation();
              patchMut.mutate({ is_time_sensitive: item.is_time_sensitive ? 0 : 1 } as any);
            }}
            title={item.is_time_sensitive ? "Time-sensitive (click to remove)" : "Mark as time-sensitive"}
            data-testid={`button-toggle-ts-${item.id}`}
          >
            <FlameIcon className="flame-icon" />
          </button>
        )}
        {fmtDate(item.date_received)}
      </div>

      <div className="row-main">
        <div className="sender">
          <b>{item.sender_name}</b>
          {item.sender_org ? `, ${item.sender_org}` : ""}
        </div>
        <div className="row-pills" onClick={stop}>
          {readOnly ? (
            <CategoryPill category={item.category} />
          ) : (
            <CategorySelect
              value={item.category as Category}
              onChange={(v) => patchMut.mutate({ category: v })}
              testId={`select-category-${item.id}`}
            />
          )}
        </div>
      </div>

      <div>
        <DecisionTag decision={item.decision} delegateTo={item.delegate_to} />
      </div>

      <div onClick={stop}>
        {readOnly ? (
          <div className="inline-select readonly">
            <OwnerAvatar owner={item.owner} />
            <span className="owner-name">{owners.find(o => o.v === item.owner)?.label || "Unassigned"}</span>
          </div>
        ) : (
          <OwnerSelect
            value={item.owner || ""}
            onChange={(v) => patchMut.mutate({ owner: v || null })}
            testId={`select-owner-${item.id}`}
          />
        )}
      </div>

      <div onClick={stop}>
        {readOnly ? (
          <div className="inline-select readonly">
            <StatusTag status={item.status} />
          </div>
        ) : (
          <StatusSelect
            value={item.status as Status}
            onChange={(v) => patchMut.mutate({ status: v })}
            testId={`select-status-${item.id}`}
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }} onClick={stop}>
        {!readOnly && scope === "active" && (
          <>
            <button
              className="btn-icon-ghost"
              title="Archive"
              onClick={() => archiveMut.mutate()}
              disabled={archiveMut.isPending}
              data-testid={`button-archive-${item.id}`}
            >
              <Archive size={12} />
            </button>
            <button
              className="btn-icon-ghost"
              title="Move to trash"
              onClick={() => {
                if (confirm("Move this card to Trash? It will auto-purge after 30 days.")) {
                  softDeleteMut.mutate();
                }
              }}
              disabled={softDeleteMut.isPending}
              data-testid={`button-delete-${item.id}`}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
        {!readOnly && scope === "archived" && (
          <button
            className="btn-icon-ghost"
            title="Unarchive"
            onClick={() => unarchiveMut.mutate()}
            disabled={unarchiveMut.isPending}
            data-testid={`button-unarchive-${item.id}`}
          >
            <ArchiveRestore size={12} />
          </button>
        )}
        {!readOnly && scope === "trash" && (
          <>
            <button
              className="btn-icon-ghost"
              title="Restore"
              onClick={() => restoreMut.mutate()}
              disabled={restoreMut.isPending}
              data-testid={`button-restore-${item.id}`}
            >
              <RotateCcw size={12} />
            </button>
            <button
              className="btn-icon-ghost"
              title="Delete forever"
              onClick={() => {
                if (confirm("Delete this card forever? This cannot be undone.")) {
                  hardDeleteMut.mutate();
                }
              }}
              disabled={hardDeleteMut.isPending}
              data-testid={`button-hard-delete-${item.id}`}
              style={{ color: "var(--danger, #ff6b6b)" }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="btn-icon-ghost"
              onClick={stop}
              title="Activity log"
              data-testid={`button-activity-${item.id}`}
            >
              <Clock size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="p-0 border-0 bg-transparent shadow-none" onClick={stop}>
            <ActivityPopover itemId={item.id} />
          </PopoverContent>
        </Popover>
        <div className="row-expand" data-testid={`button-expand-${item.id}`}>▶</div>
      </div>

      {expanded && (
        <div className="row-expanded-content" onClick={stop}>
          {readOnly ? (
            <>
              <div className="subject-line">{item.subject}</div>
              <div className="context-block">
                <span dangerouslySetInnerHTML={{ __html: item.context }} />
                {item.email_url ? (
                  <div style={{ marginTop: 8 }}>
                    <a href={item.email_url} target="_blank" rel="noreferrer" className="read-email">
                      READ EMAIL →
                    </a>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <ContextEditor
              itemId={item.id}
              senderName={item.sender_name}
              senderOrg={item.sender_org}
              senderEmail={item.sender_email}
              dateReceived={item.date_received}
              subject={item.subject}
              context={item.context}
              emailUrl={item.email_url}
              onSave={(p) => patchMut.mutate(p)}
            />
          )}

          {readOnly ? (
            item.team_note_for_principal && (
              <div className="team-note">
                <span className="team-note-label">FROM&nbsp;TEAM</span>
                <span className="team-note-text">{item.team_note_for_principal}</span>
              </div>
            )
          ) : (
            <TeamNoteEditor
              itemId={item.id}
              value={item.team_note_for_principal}
              onSave={(v) => patchMut.mutate({ team_note_for_principal: v })}
            />
          )}

          {!readOnly && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: "Lemon Milk, sans-serif", fontSize: 10, letterSpacing: "0.14em", color: "var(--text-dim)", marginRight: 6 }}>
                SET JOE'S CALL:
              </span>
              {DECISIONS.map((d) => (
                <button
                  key={d.v}
                  className={`decision-tag ${d.v === "team_to_action" ? "action" : d.v === "team_to_decline" ? "decline" : d.v === "principal_to_respond" ? "respond" : "delegate"}`}
                  style={{ cursor: "pointer", border: "1px solid transparent", opacity: item.decision === d.v ? 1 : 0.65 }}
                  onClick={() => {
                    if (d.v === "delegate") {
                      const name = prompt("Delegate to whom?");
                      if (!name) return;
                      patchMut.mutate({ decision: d.v, delegate_to: name });
                    } else {
                      patchMut.mutate({ decision: d.v, delegate_to: null });
                    }
                  }}
                  data-testid={`set-decision-${d.v}-${item.id}`}
                >
                  {d.label.toUpperCase()}
                </button>
              ))}
              {item.decision && (
                <button
                  className="btn-undo-decision"
                  onClick={() => {
                    if (
                      confirm(
                        "Revert Joe's call back to awaiting Joe? This will be logged.",
                      )
                    ) {
                      patchMut.mutate({
                        decision: null,
                        delegate_to: null,
                      } as any);
                    }
                  }}
                  data-testid={`button-undo-decision-${item.id}`}
                  title="Revert to awaiting Joe"
                >
                  ↶ UNDO CALL
                </button>
              )}
            </div>
          )}

          {(() => {
            const humanNotes = (notesQ.data || []).filter((n) => n.author !== "system");
            return (
          <>
          <button
            className={`notes-toggle ${notesOpen ? "open" : ""}`}
            onClick={() => setNotesOpen((v) => !v)}
            data-testid={`button-notes-toggle-${item.id}`}
          >
            <span className="chevron">▶</span> NOTES{" "}
            {humanNotes.length > 0 ? (
              <span className="badge">{humanNotes.length}</span>
            ) : null}
          </button>

          {notesOpen && (
            <div className="notes-thread">
              {notesQ.isLoading ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading notes…</div>
              ) : humanNotes.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 10 }}>
                  No notes yet.
                </div>
              ) : (
                humanNotes.map((n) => (
                  <div className="note-item" key={n.id}>
                    <div className={`avatar ${n.author}`}>{n.author[0]?.toUpperCase() || "·"}</div>
                    <div className="note-body">
                      <div className="note-meta">
                        <b>{n.author.toUpperCase()}</b> · {fmtNoteDate(n.created_at)}
                      </div>
                      <div className="note-text">{n.body}</div>
                    </div>
                  </div>
                ))
              )}
              {!readOnly && (
                <div className="note-compose">
                  <input
                    placeholder={`Add a note${me.identity === "meghan" ? " for Alexandra" : me.identity === "alexandra" ? " for Meghan" : ""}…`}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && noteDraft.trim()) {
                        postNote.mutate(noteDraft.trim());
                      }
                    }}
                    data-testid={`input-note-${item.id}`}
                  />
                  <button
                    onClick={() => noteDraft.trim() && postNote.mutate(noteDraft.trim())}
                    disabled={!noteDraft.trim() || postNote.isPending}
                    data-testid={`button-post-note-${item.id}`}
                  >
                    POST
                  </button>
                </div>
              )}
            </div>
          )}
          </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

type ContextEditorPatch = {
  sender_name?: string;
  sender_org?: string | null;
  sender_email?: string | null;
  date_received?: string;
  subject?: string;
  context?: string;
  email_url?: string | null;
};

function ContextEditor({
  itemId,
  senderName,
  senderOrg,
  senderEmail,
  dateReceived,
  subject,
  context,
  emailUrl,
  onSave,
}: {
  itemId: string;
  senderName: string;
  senderOrg: string | null;
  senderEmail: string | null;
  dateReceived: string;
  subject: string;
  context: string;
  emailUrl: string | null;
  onSave: (patch: ContextEditorPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [senderNameDraft, setSenderNameDraft] = useState(senderName);
  const [senderOrgDraft, setSenderOrgDraft] = useState(senderOrg || "");
  const [senderEmailDraft, setSenderEmailDraft] = useState(senderEmail || "");
  const [dateReceivedDraft, setDateReceivedDraft] = useState(dateReceived);
  const [subjectDraft, setSubjectDraft] = useState(subject);
  const [contextDraft, setContextDraft] = useState(context);
  const [emailUrlDraft, setEmailUrlDraft] = useState(emailUrl || "");

  const enter = () => {
    setSenderNameDraft(senderName);
    setSenderOrgDraft(senderOrg || "");
    setSenderEmailDraft(senderEmail || "");
    setDateReceivedDraft(dateReceived);
    setSubjectDraft(subject);
    setContextDraft(context);
    setEmailUrlDraft(emailUrl || "");
    setEditing(true);
  };

  const nullable = (s: string) => (s.trim() ? s.trim() : null);

  const commit = () => {
    const patch: ContextEditorPatch = {};
    if (senderNameDraft.trim() && senderNameDraft.trim() !== senderName) {
      patch.sender_name = senderNameDraft.trim();
    }
    if (nullable(senderOrgDraft) !== (senderOrg || null)) {
      patch.sender_org = nullable(senderOrgDraft);
    }
    if (nullable(senderEmailDraft) !== (senderEmail || null)) {
      patch.sender_email = nullable(senderEmailDraft);
    }
    if (dateReceivedDraft && dateReceivedDraft !== dateReceived) {
      patch.date_received = dateReceivedDraft;
    }
    if (subjectDraft !== subject) patch.subject = subjectDraft.trim() || subject;
    if (contextDraft !== context) patch.context = contextDraft;
    const nextUrl = nullable(emailUrlDraft);
    if (nextUrl !== (emailUrl || null)) patch.email_url = nextUrl;
    if (Object.keys(patch).length > 0) onSave(patch);
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <div className="context-edit">
        <div className="context-edit-row">
          <div className="context-edit-field">
            <div className="context-edit-label">SENDER NAME</div>
            <input
              className="context-edit-input"
              value={senderNameDraft}
              onChange={(e) => setSenderNameDraft(e.target.value)}
              onKeyDown={onKey}
              data-testid={`input-sender-name-${itemId}`}
            />
          </div>
          <div className="context-edit-field">
            <div className="context-edit-label">ORGANIZATION</div>
            <input
              className="context-edit-input"
              value={senderOrgDraft}
              onChange={(e) => setSenderOrgDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder="e.g. Stanford"
              data-testid={`input-sender-org-${itemId}`}
            />
          </div>
        </div>
        <div className="context-edit-row">
          <div className="context-edit-field">
            <div className="context-edit-label">SENDER EMAIL</div>
            <input
              className="context-edit-input"
              value={senderEmailDraft}
              onChange={(e) => setSenderEmailDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder="name@company.com"
              data-testid={`input-sender-email-${itemId}`}
            />
          </div>
          <div className="context-edit-field context-edit-field-date">
            <div className="context-edit-label">DATE RECEIVED</div>
            <input
              type="date"
              className="context-edit-input"
              value={dateReceivedDraft}
              onChange={(e) => setDateReceivedDraft(e.target.value)}
              onKeyDown={onKey}
              data-testid={`input-date-received-${itemId}`}
            />
          </div>
        </div>
        <div className="context-edit-field">
          <div className="context-edit-label">SUBJECT</div>
          <input
            className="context-edit-input"
            value={subjectDraft}
            onChange={(e) => setSubjectDraft(e.target.value)}
            onKeyDown={onKey}
            data-testid={`input-subject-${itemId}`}
          />
        </div>
        <div className="context-edit-field">
          <div className="context-edit-label">
            CONTEXT <span className="context-edit-hint">HTML &lt;b&gt; allowed. End with one bolded yes/no question to Joe.</span>
          </div>
          <textarea
            className="context-edit-textarea"
            value={contextDraft}
            rows={5}
            onChange={(e) => setContextDraft(e.target.value)}
            onKeyDown={onKey}
            data-testid={`input-context-${itemId}`}
          />
        </div>
        <div className="context-edit-field">
          <div className="context-edit-label">EMAIL URL <span className="context-edit-hint">OPTIONAL</span></div>
          <input
            className="context-edit-input"
            value={emailUrlDraft}
            placeholder="https://mail.google.com/…"
            onChange={(e) => setEmailUrlDraft(e.target.value)}
            onKeyDown={onKey}
            data-testid={`input-email-url-${itemId}`}
          />
        </div>
        <div className="context-edit-actions">
          <button
            className="team-note-save"
            onClick={commit}
            data-testid={`button-save-context-${itemId}`}
          >
            SAVE
          </button>
          <button
            className="team-note-cancel"
            onClick={cancel}
            data-testid={`button-cancel-context-${itemId}`}
          >
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="context-clickable"
      onClick={enter}
      data-testid={`button-edit-context-${itemId}`}
      title="Click to edit subject, context, or email link"
    >
      <div className="subject-line">
        {subject}
        <span className="context-edit-pencil">EDIT</span>
      </div>
      <div className="context-block">
        <span dangerouslySetInnerHTML={{ __html: context }} />
        {emailUrl ? (
          <div style={{ marginTop: 8 }}>
            <a
              href={emailUrl}
              target="_blank"
              rel="noreferrer"
              className="read-email"
              onClick={(e) => e.stopPropagation()}
            >
              READ EMAIL →
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TeamNoteEditor({
  itemId,
  value,
  onSave,
}: {
  itemId: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  // Sync draft when external value changes (after save) and we're not editing.
  if (!editing && draft !== (value || "") && document.activeElement?.tagName !== "TEXTAREA") {
    // no-op; we update via setDraft on entering edit mode
  }

  const commit = () => {
    const trimmed = draft.trim();
    onSave(trimmed ? trimmed : null);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value || "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="team-note team-note-edit">
        <span className="team-note-label">FROM&nbsp;TEAM</span>
        <textarea
          className="team-note-textarea"
          value={draft}
          autoFocus
          rows={2}
          placeholder="Add a note for Joe…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          data-testid={`input-team-note-${itemId}`}
        />
        <div className="team-note-actions">
          <button
            className="team-note-save"
            onClick={commit}
            data-testid={`button-save-team-note-${itemId}`}
          >
            SAVE
          </button>
          <button
            className="team-note-cancel"
            onClick={cancel}
            data-testid={`button-cancel-team-note-${itemId}`}
          >
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  if (value) {
    return (
      <div
        className="team-note team-note-clickable"
        onClick={() => { setDraft(value); setEditing(true); }}
        data-testid={`button-edit-team-note-${itemId}`}
        title="Click to edit note for Joe"
      >
        <span className="team-note-label">FROM&nbsp;TEAM</span>
        <span className="team-note-text">{value}</span>
        <span className="team-note-edit-hint">EDIT</span>
      </div>
    );
  }

  return (
    <button
      className="team-note-add"
      onClick={() => { setDraft(""); setEditing(true); }}
      data-testid={`button-add-team-note-${itemId}`}
    >
      + ADD NOTE FOR JOE
    </button>
  );
}

const owners = [
  { v: "", label: "Unassigned" },
  { v: "meghan", label: "Meghan" },
  { v: "alexandra", label: "Alexandra" },
];

function OwnerSelect({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="inline-select" data-testid={testId}>
          <OwnerAvatar owner={value} />
          <span className="owner-name">
            {owners.find((o) => o.v === value)?.label || "Unassigned"}
          </span>
          <span className="caret">▾</span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 border-0 bg-transparent shadow-none">
        <div className="lm-dropdown">
          {owners.map((o) => (
            <div
              key={o.v || "none"}
              className={`opt ${o.v === value ? "selected" : ""}`}
              onClick={() => onChange(o.v)}
              data-testid={`option-owner-${o.v || "none"}`}
            >
              <OwnerAvatar owner={o.v || null} />
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CategorySelect({
  value,
  onChange,
  testId,
}: {
  value: Category;
  onChange: (v: Category) => void;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="category-pill-trigger" data-testid={testId} title="Click to change category">
          <CategoryPill category={value} />
          <span className="caret">▾</span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 border-0 bg-transparent shadow-none">
        <div className="lm-dropdown">
          {CATEGORIES.map((c) => (
            <div
              key={c}
              className={`opt ${c === value ? "selected" : ""}`}
              onClick={() => onChange(c)}
              data-testid={`option-category-${c}`}
            >
              <CategoryPill category={c} />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatusSelect({
  value,
  onChange,
  testId,
}: {
  value: Status;
  onChange: (v: Status) => void;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="inline-select" data-testid={testId}>
          <StatusTag status={value} />
          <span className="caret">▾</span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 border-0 bg-transparent shadow-none">
        <div className="lm-dropdown">
          {STATUSES.map((s) => (
            <div
              key={s}
              className={`opt ${s === value ? "selected" : ""}`}
              onClick={() => onChange(s)}
              data-testid={`option-status-${s}`}
            >
              <span className={`status-tag ${STATUS_CLASS[s]}`}>
                <span className="dot" />
                {STATUS_LABEL[s]}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Resolve activity actor to a stable display label and bubble initial.
// 'joe' (principal), 'meghan' / 'alexandra' (team), or 'system' for anything else / unknown.
function actorDisplay(actor: string): { name: string; initial: string; key: string } {
  const a = (actor || "").toLowerCase();
  if (a === "joe") return { name: "JOE", initial: "J", key: "joe" };
  if (a === "meghan") return { name: "MEGHAN", initial: "M", key: "meghan" };
  if (a === "alexandra") return { name: "ALEXANDRA", initial: "A", key: "alexandra" };
  return { name: "SYSTEM", initial: "S", key: "system" };
}

const DECISION_LABELS: Record<string, string> = {
  team_to_action: "Team to action",
  team_to_decline: "Team to decline",
  principal_to_respond: "Joe to respond",
  delegate: "Delegate",
};

// Turn a raw activity row into a single human sentence.
// Best-effort: unknown event types fall through to a readable default.
function humanizeActivity(a: Activity): string {
  let detail: any = null;
  if (a.detail) {
    try { detail = JSON.parse(a.detail); } catch { detail = null; }
  }
  const who = actorDisplay(a.actor).name === "SYSTEM" ? "System" : actorDisplay(a.actor).name.charAt(0) + actorDisplay(a.actor).name.slice(1).toLowerCase();
  switch (a.event) {
    case "decision_made": {
      const label = DECISION_LABELS[detail?.decision] || "set a call";
      const dele = detail?.delegate_to ? ` (→ ${detail.delegate_to})` : "";
      return `${who} set Joe's call to ${label}${dele}.`;
    }
    case "decision_undone": {
      const from = DECISION_LABELS[detail?.from] || "the previous call";
      return `${who} reverted ${from} back to awaiting Joe.`;
    }
    case "principal_note_added":
      return `${who} added a note.`;
    case "team_note_changed": {
      const action = detail?.action || "updated";
      if (action === "cleared") return `${who} cleared the note for Joe.`;
      if (action === "added") return `${who} added a note for Joe.`;
      return `${who} updated the note for Joe.`;
    }
    case "note_added":
      return `${who} added a note.`;
    case "owner_changed": {
      const to = detail?.to ? detail.to : "unassigned";
      return `${who} assigned this to ${to.charAt(0).toUpperCase() + to.slice(1)}.`;
    }
    case "status_changed": {
      const to = (detail?.to || "").replace(/_/g, " ");
      return to ? `${who} changed status to ${to}.` : `${who} changed status.`;
    }
    case "sent_to_meeting_tracker":
      return `Sent to Meeting Tracker${detail?.trackerId ? ` (id ${detail.trackerId})` : ""}.`;
    case "meeting_tracker_failed":
      return `Failed to send to Meeting Tracker${detail?.error ? `: ${detail.error}` : "."}`;
    case "skipped":
      return `${who} skipped this card.`;
    case "created_manual":
      return `${who} created this item.`;
    case "time_sensitive_changed": {
      if (detail?.to) return `${who} marked this time-sensitive.`;
      return `${who} removed the time-sensitive flag.`;
    }
    case "parsed":
      return `${who} parsed this from an email.`;
    case "category_changed": {
      const to = detail?.to;
      const label = to ? (CATEGORY_LABEL[to as Category] || String(to)) : "";
      return label ? `${who} changed category to ${label}.` : `${who} changed the category.`;
    }
    case "context_edited": {
      const fields: string[] = Array.isArray(detail?.fields) ? detail.fields : [];
      const FIELD_LABEL: Record<string, string> = {
        sender_name: "sender name",
        sender_org: "organization",
        sender_email: "sender email",
        date_received: "date received",
        subject: "subject",
        context: "context",
        email_url: "email link",
      };
      const pretty = fields.map((f) => FIELD_LABEL[f] || f).join(", ");
      return pretty
        ? `${who} edited the ${pretty}.`
        : `${who} edited the context.`;
    }
    default:
      return `${who} — ${a.event.replace(/_/g, " ")}`;
  }
}

function ActivityPopover({ itemId }: { itemId: string }) {
  const q = useQuery<Activity[]>({
    queryKey: ["/api/items", itemId, "activity"],
  });
  const entries = q.data || [];
  return (
    <div className="activity-pop activity-pop-v2" data-testid={`activity-pop-${itemId}`}>
      <div className="lbl">ACTIVITY</div>
      {q.isLoading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No activity yet.</div>
      ) : (
        entries.map((a) => {
          const who = actorDisplay(a.actor);
          // The 'note_added' event already shows in the Notes thread; in the
          // activity log we still surface it but make clear it was a note.
          return (
            <div className="note-item activity-as-note" key={a.id}>
              <div className={`avatar ${who.key}`}>{who.initial}</div>
              <div className="note-body">
                <div className="note-meta">
                  <b>{who.name}</b> · {fmtNoteDate(a.created_at)}
                </div>
                <div className="note-text">{humanizeActivity(a)}</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
