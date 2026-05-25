import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "@/components/TopBar";
import { CategoryPill, FlameIcon, FlameTag } from "@/components/Bits";
import { CATEGORY_VAR } from "@/lib/labels";
import type { Category } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Item } from "@shared/schema";

type Pile = "one" | "category" | "intext" | "ts";
const PILE_LABEL: Record<Pile, string> = {
  one: "ONE PILE",
  category: "BY CATEGORY",
  intext: "BY INTERNAL/EXTERNAL",
  ts: "TIME SENSITIVE FIRST",
};

const DECISION_DOT: Record<string, string> = {
  team_to_action: "action",
  team_to_decline: "decline",
  principal_to_respond: "respond",
  delegate: "delegate",
};
const DECISION_SHORT: Record<string, string> = {
  team_to_action: "TEAM TO ACTION",
  team_to_decline: "TEAM TO DECLINE",
  principal_to_respond: "I'LL RESPOND",
  delegate: "DELEGATE",
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "S"}`;
}

export default function AnswerPage() {
  const [pile, setPile] = useState<Pile>("one");
  // Session-local order: ids of cards that have been skipped (sent to back).
  const [skipOrder, setSkipOrder] = useState<string[]>([]);
  // Session-local order of decisions (so the shelf shows them in the order Joe answered).
  const [answeredOrder, setAnsweredOrder] = useState<string[]>([]);
  const [delegating, setDelegating] = useState<string | null>(null);
  const [delegateName, setDelegateName] = useState("");

  const itemsQ = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const cfgQ = useQuery<{ internalDomains: string[] }>({ queryKey: ["/api/config"] });

  const isInternal = (email: string | null | undefined) => {
    if (!email) return false;
    const m = email.toLowerCase().match(/@([^\s>]+)$/);
    if (!m) return false;
    const domain = m[1];
    return (cfgQ.data?.internalDomains || []).some(
      (d) => domain === d.toLowerCase() || domain.endsWith("." + d.toLowerCase()),
    );
  };

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const r = await apiRequest("PATCH", `/api/items/${id}`, patch);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    },
  });

  const skipMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/items/${id}/skip`);
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/items"] }),
  });

  const allItems = itemsQ.data || [];

  // Pending = no decision yet. Order: base order, but with skipped IDs moved to the back
  // in the order they were skipped.
  const pending = useMemo(() => {
    const base = allItems.filter((i) => !i.decision);
    const skipSet = new Set(skipOrder);
    const head = base.filter((i) => !skipSet.has(i.id));
    const tail = skipOrder
      .map((id) => base.find((i) => i.id === id))
      .filter((x): x is Item => !!x);
    return [...head, ...tail];
  }, [allItems, skipOrder]);

  // Answered cards Joe has decided on this session (oldest decision first).
  const answered = useMemo(() => {
    const map = new Map(allItems.map((i) => [i.id, i]));
    return answeredOrder
      .map((id) => map.get(id))
      .filter((x): x is Item => !!x && !!x.decision);
  }, [allItems, answeredOrder]);

  const piles = useMemo<{ label: string; items: Item[]; category?: string }[]>(() => {
    if (pending.length === 0) return [];
    if (pile === "one") return [{ label: "ALL", items: pending }];
    if (pile === "ts") {
      const sorted = [...pending].sort(
        (a, b) => (b.is_time_sensitive ? 1 : 0) - (a.is_time_sensitive ? 1 : 0),
      );
      return [{ label: "ALL", items: sorted }];
    }
    if (pile === "intext") {
      const internal = pending.filter((i) => isInternal(i.sender_email));
      const external = pending.filter((i) => !isInternal(i.sender_email));
      const r: { label: string; items: Item[] }[] = [];
      if (internal.length) r.push({ label: "INTERNAL", items: internal });
      if (external.length) r.push({ label: "EXTERNAL", items: external });
      return r;
    }
    const groups: Record<string, Item[]> = {};
    for (const i of pending) (groups[i.category] = groups[i.category] || []).push(i);
    return Object.entries(groups).map(([cat, items]) => ({
      label: cat.replace(/_/g, " ").toUpperCase(),
      items,
      category: cat,
    }));
  }, [pending, pile, cfgQ.data]);

  const recordAnswered = useCallback((id: string) => {
    setAnsweredOrder((prev) => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
  }, []);

  const handleDecision = (item: Item, decision: string, note?: string) => {
    if (decision === "delegate") {
      setDelegating(item.id);
      setDelegateName("");
      return;
    }
    const patch: any = { decision, delegate_to: null };
    if (note && note.trim()) patch.principal_note = note.trim();
    patchMut.mutate({ id: item.id, patch });
    recordAnswered(item.id);
  };

  const confirmDelegate = (item: Item, note?: string) => {
    if (!delegateName.trim()) return;
    const patch: any = {
      decision: "delegate",
      delegate_to: delegateName.trim(),
    };
    if (note && note.trim()) patch.principal_note = note.trim();
    patchMut.mutate({ id: item.id, patch });
    recordAnswered(item.id);
    setDelegating(null);
    setDelegateName("");
  };

  const handleSkip = (item: Item) => {
    setSkipOrder((prev) => {
      // remove if already in queue, then push to back
      const filtered = prev.filter((id) => id !== item.id);
      return [...filtered, item.id];
    });
    skipMut.mutate(item.id);
  };

  const handleReopen = (item: Item) => {
    // Clear decision on the server, drop from answered-order so it falls back into pending.
    patchMut.mutate({
      id: item.id,
      patch: { decision: null, delegate_to: null },
    });
    setAnsweredOrder((prev) => prev.filter((id) => id !== item.id));
    // Move to front of pending: remove from skipOrder if present.
    setSkipOrder((prev) => prev.filter((id) => id !== item.id));
  };

  const decidedToday = answered.length;
  const totalToday = pending.length + decidedToday;
  const progressPct = totalToday > 0 ? (decidedToday / totalToday) * 100 : 0;

  return (
    <>
      <TopBar />
      <div className="section">
        <div className="section-eyebrow">VIEW 01 · PRINCIPAL</div>
        <div className="section-title">ANSWER MODE</div>
        <div className="section-sub">
          Card stack for clearing the queue. Tap a decision, next card appears.
          Skip moves the card to the back of the deck. Answered cards stack to
          the side. Click one to change your call.
        </div>
      </div>

      <div className="answer-stage">
        <div>
          <div className="queue-meta queue-meta-row" data-testid="queue-meta">
            <span className="queue-meta-text">
              <span className="count">{plural(pending.length, "ITEM")}</span> AWAITING YOUR CALL
            </span>
            <div className="queue-progress" data-testid="queue-progress">
              <div className="queue-progress-label">
                TODAY'S PROGRESS
                <b>{decidedToday} / {totalToday}</b>
              </div>
              <div className="queue-progress-bar">
                <div
                  className="queue-progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="pile-picker" data-testid="pile-picker">
            {(Object.keys(PILE_LABEL) as Pile[]).map((p) => (
              <button
                key={p}
                className={`pile-chip ${pile === p ? "active" : ""}`}
                onClick={() => setPile(p)}
                data-testid={`pile-${p}`}
              >
                {p === "ts" && <FlameIcon className="flame-icon pile-chip-flame" size={14} />}
                {PILE_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="stack-area">
            {itemsQ.isLoading ? (
              <div className="empty-state">
                <div className="eb">LOADING…</div>
              </div>
            ) : pending.length === 0 ? (
              <div className="empty-state" data-testid="empty-queue">
                <div className="eb">QUEUE CLEAR</div>
                <div className="sb">Every item has a call. Nice work.</div>
              </div>
            ) : pile === "one" || pile === "ts" ? (
              <CardStack
                items={piles[0]?.items || []}
                onDecide={handleDecision}
                onSkip={handleSkip}
                delegating={delegating}
                delegateName={delegateName}
                setDelegateName={setDelegateName}
                confirmDelegate={confirmDelegate}
                cancelDelegate={() => setDelegating(null)}
                index={0}
                total={piles[0]?.items.length || 0}
              />
            ) : (
              <div className="pile-grid" data-testid="pile-grid">
                {piles.map((p) => {
                  const catVar = p.category ? CATEGORY_VAR[p.category as Category] : null;
                  const labelStyle = catVar
                    ? { background: catVar.bg, color: catVar.fg, borderColor: "transparent" }
                    : undefined;
                  return (
                  <div className="pile-col" key={p.label}>
                    <span className="pile-col-label" style={labelStyle}>{p.label} · {p.items.length}</span>
                    <CardStack
                      items={p.items}
                      onDecide={handleDecision}
                      onSkip={handleSkip}
                      delegating={delegating}
                      delegateName={delegateName}
                      setDelegateName={setDelegateName}
                      confirmDelegate={confirmDelegate}
                      cancelDelegate={() => setDelegating(null)}
                      compact
                    />
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {answered.length > 0 && (
            <div className="answered-shelf" data-testid="answered-shelf">
              <div className="answered-shelf-label">
                ANSWERED THIS SESSION · {answered.length} · CLICK TO CHANGE
              </div>
              <div className="answered-row">
                {answered.map((item) => {
                  const dotClass = item.decision
                    ? DECISION_DOT[item.decision] || "action"
                    : "action";
                  const short = item.decision
                    ? DECISION_SHORT[item.decision] || ""
                    : "";
                  return (
                    <div
                      key={item.id}
                      className="answered-chip"
                      onClick={() => handleReopen(item)}
                      title="Click to bring this card back and change your call"
                      data-testid={`answered-chip-${item.id}`}
                    >
                      <span className={`answered-chip-dot ${dotClass}`} />
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="answered-chip-name">{item.sender_name}</span>
                        <span className="answered-chip-dec">
                          {short}
                          {item.decision === "delegate" && item.delegate_to
                            ? ` → ${item.delegate_to.toUpperCase()}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CardStack({
  items,
  onDecide,
  onSkip,
  delegating,
  delegateName,
  setDelegateName,
  confirmDelegate,
  cancelDelegate,
  compact = false,
  index = 0,
  total,
}: {
  items: Item[];
  onDecide: (item: Item, decision: string, note?: string) => void;
  onSkip: (item: Item) => void;
  delegating: string | null;
  delegateName: string;
  setDelegateName: (v: string) => void;
  confirmDelegate: (item: Item, note?: string) => void;
  cancelDelegate: () => void;
  compact?: boolean;
  index?: number;
  total?: number;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "40px 16px" }}>
        <div className="eb">EMPTY</div>
      </div>
    );
  }
  const front = items[0];
  const behind1 = items[1];
  const behind2 = items[2];

  const positionStr = total
    ? `CARD ${index + 1} / ${total}`
    : `${plural(items.length, "CARD")} TO GO`;

  return (
    <div className="card-stack" data-testid="card-stack" style={compact ? { maxWidth: 480 } : undefined}>
      {behind2 ? <div className="card behind-2" /> : null}
      {behind1 ? <div className="card behind-1" /> : null}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={front.id}
          className="card front"
          initial={{ y: -10, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ x: 40, opacity: 0, scale: 0.96, transition: { duration: 0.22 } }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          data-testid={`card-${front.id}`}
        >
          <CardFront
            item={front}
            position={positionStr}
            onDecide={onDecide}
            onSkip={onSkip}
            delegating={delegating === front.id}
            delegateName={delegateName}
            setDelegateName={setDelegateName}
            confirmDelegate={(note) => confirmDelegate(front, note)}
            cancelDelegate={cancelDelegate}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CardFront({
  item,
  position,
  onDecide,
  onSkip,
  delegating,
  delegateName,
  setDelegateName,
  confirmDelegate,
  cancelDelegate,
}: {
  item: Item;
  position: string;
  onDecide: (item: Item, decision: string, note?: string) => void;
  onSkip: (item: Item) => void;
  delegating: boolean;
  delegateName: string;
  setDelegateName: (v: string) => void;
  confirmDelegate: (note?: string) => void;
  cancelDelegate: () => void;
}) {
  const [note, setNote] = useState(item.principal_note || "");

  let implied: Record<string, string> = {};
  try {
    implied = item.implied_action ? JSON.parse(item.implied_action) : {};
  } catch {}
  const received = new Date(item.date_received + "T00:00:00").toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
  }).toUpperCase();

  return (
    <>
      <div className="card-head">
        <div className="card-head-left">
          <CategoryPill category={item.category} />
          {item.is_time_sensitive ? <FlameTag /> : null}
        </div>
        <div className="card-meta-row">
          <span className="received">RECEIVED {received}</span>
          <span className="position">{position}</span>
        </div>
      </div>

      <div className="card-from">
        FROM <b>{item.sender_name}</b>
        {item.sender_org ? `, ${item.sender_org}` : ""}
      </div>
      <div className="card-subject">{item.subject}</div>

      <div className="card-context">
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

      <div className="principal-note-block">
        <label htmlFor={`pn-${item.id}`}>NOTES FOR THE TEAM (OPTIONAL)</label>
        <textarea
          id={`pn-${item.id}`}
          placeholder="Anything they should know before they action this?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid={`input-principal-note-${item.id}`}
        />
      </div>

      <div className="decision-row">
        <button
          className="btn-decide action"
          onClick={() => onDecide(item, "team_to_action", note)}
          data-testid={`decide-action-${item.id}`}
        >
          <div className="btn-decide-stack">
            <span className="btn-decide-label">TEAM TO ACTION</span>
            {implied.team_to_action && <span className="btn-decide-sub">{implied.team_to_action}</span>}
          </div>
          <span className="arrow">→</span>
        </button>
        <button
          className="btn-decide decline"
          onClick={() => onDecide(item, "team_to_decline", note)}
          data-testid={`decide-decline-${item.id}`}
        >
          <div className="btn-decide-stack">
            <span className="btn-decide-label">TEAM TO DECLINE</span>
            {implied.team_to_decline && <span className="btn-decide-sub">{implied.team_to_decline}</span>}
          </div>
          <span className="arrow">→</span>
        </button>
        <button
          className="btn-decide respond"
          onClick={() => onDecide(item, "principal_to_respond", note)}
          data-testid={`decide-respond-${item.id}`}
        >
          <div className="btn-decide-stack">
            <span className="btn-decide-label">I'LL RESPOND</span>
            {implied.principal_to_respond && <span className="btn-decide-sub">{implied.principal_to_respond}</span>}
          </div>
          <span className="arrow">→</span>
        </button>
        <button
          className="btn-decide delegate"
          onClick={() => onDecide(item, "delegate", note)}
          data-testid={`decide-delegate-${item.id}`}
        >
          <div className="btn-decide-stack">
            <span className="btn-decide-label">DELEGATE TO…</span>
            {implied.delegate && <span className="btn-decide-sub">{implied.delegate}</span>}
          </div>
          <span className="arrow">→</span>
        </button>
      </div>

      {delegating && (
        <div className="delegate-input-row">
          <input
            placeholder="Type a name (e.g. Eliot)"
            value={delegateName}
            onChange={(e) => setDelegateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmDelegate(note);
              if (e.key === "Escape") cancelDelegate();
            }}
            autoFocus
            data-testid={`input-delegate-${item.id}`}
          />
          <button onClick={() => confirmDelegate(note)} data-testid={`confirm-delegate-${item.id}`}>CONFIRM</button>
        </div>
      )}

      <div className="skip-row">
        <button className="btn-skip" onClick={() => onSkip(item)} data-testid={`button-skip-${item.id}`}>
          <span className="icon">↻</span> SKIP FOR NOW
        </button>
      </div>
    </>
  );
}
