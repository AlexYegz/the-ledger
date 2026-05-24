import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CategoryPill, DecisionTag, FlameIcon, OwnerAvatar, StatusTag } from "@/components/Bits";
import { STATUS_LABEL, STATUS_CLASS, fmtDate, fmtNoteDate, relTime } from "@/lib/labels";
import type { Item, Note, Activity, Status, Decision } from "@shared/schema";
import { useAuth } from "@/lib/auth";

const STATUSES: Status[] = ["not_started", "in_progress", "waiting", "complete", "canceled"];
const DECISIONS: { v: Decision; label: string }[] = [
  { v: "team_to_action", label: "Team to action" },
  { v: "team_to_decline", label: "Team to decline" },
  { v: "principal_to_respond", label: "Joe to respond" },
  { v: "delegate", label: "Delegate" },
];

export function LedgerRow({
  item,
  isInternal,
  readOnly = false,
}: {
  item: Item;
  isInternal: boolean;
  readOnly?: boolean;
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
        {item.is_time_sensitive ? <FlameIcon className="row-flame" /> : null}
        {fmtDate(item.date_received)}
      </div>

      <div className="row-main">
        <div className="sender">
          <b>{item.sender_name}</b>
          {item.sender_org ? `, ${item.sender_org}` : ""}
        </div>
        <div className="row-pills">
          <CategoryPill category={item.category} />
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

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
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

          {item.team_note_for_principal && (
            <div className="team-note">
              <span className="team-note-label">FROM&nbsp;TEAM</span>
              <span className="team-note-text">{item.team_note_for_principal}</span>
            </div>
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
            </div>
          )}

          <button
            className={`notes-toggle ${notesOpen ? "open" : ""}`}
            onClick={() => setNotesOpen((v) => !v)}
            data-testid={`button-notes-toggle-${item.id}`}
          >
            <span className="chevron">▶</span> NOTES{" "}
            {notesQ.data && notesQ.data.length > 0 ? (
              <span className="badge">{notesQ.data.length}</span>
            ) : null}
          </button>

          {notesOpen && (
            <div className="notes-thread">
              {notesQ.isLoading ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading notes…</div>
              ) : (notesQ.data || []).length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 10 }}>
                  No notes yet.
                </div>
              ) : (
                (notesQ.data || []).map((n) => (
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
        </div>
      )}
    </div>
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

function ActivityPopover({ itemId }: { itemId: string }) {
  const q = useQuery<Activity[]>({
    queryKey: ["/api/items", itemId, "activity"],
  });
  return (
    <div className="activity-pop" data-testid={`activity-pop-${itemId}`}>
      <div className="lbl">ACTIVITY</div>
      {q.isLoading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading…</div>
      ) : (q.data || []).length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No activity yet.</div>
      ) : (
        (q.data || []).map((a) => (
          <div className="activity-entry" key={a.id}>
            <div className="ico">·</div>
            <div>
              <div className="meta">
                {a.actor.toUpperCase()} · {a.event.replace(/_/g, " ")}
              </div>
              <div className="when">{relTime(a.created_at)}</div>
              {a.detail ? <div className="det">{a.detail}</div> : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
