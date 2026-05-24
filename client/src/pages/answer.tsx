import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "@/components/TopBar";
import { CategoryPill, FlameTag, FlameIcon } from "@/components/Bits";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Item } from "@shared/schema";

type Pile = "one" | "category" | "intext" | "ts";
const PILE_LABEL: Record<Pile, string> = {
  one: "ONE PILE",
  category: "BY CATEGORY",
  intext: "BY INTERNAL/EXTERNAL",
  ts: "TIME SENSITIVE FIRST",
};

export default function AnswerPage() {
  const [pile, setPile] = useState<Pile>("one");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [delegating, setDelegating] = useState<string | null>(null);
  const [delegateName, setDelegateName] = useState("");
  const [decidedToday, setDecidedToday] = useState(0);

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
      setDecidedToday((n) => n + 1);
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

  // Pending items (no decision yet, not skipped in this session)
  const pending = useMemo(
    () =>
      (itemsQ.data || []).filter(
        (i) => !i.decision && !skipped.has(i.id),
      ),
    [itemsQ.data, skipped],
  );

  const piles = useMemo<{ label: string; items: Item[] }[]>(() => {
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
    // by category
    const groups: Record<string, Item[]> = {};
    for (const i of pending) (groups[i.category] = groups[i.category] || []).push(i);
    return Object.entries(groups).map(([cat, items]) => ({
      label: cat.replace(/_/g, " ").toUpperCase(),
      items,
    }));
  }, [pending, pile, cfgQ.data]);

  const handleDecision = (item: Item, decision: string) => {
    if (decision === "delegate") {
      setDelegating(item.id);
      setDelegateName("");
      return;
    }
    patchMut.mutate({ id: item.id, patch: { decision, delegate_to: null } });
  };

  const confirmDelegate = (item: Item) => {
    if (!delegateName.trim()) return;
    patchMut.mutate({
      id: item.id,
      patch: { decision: "delegate", delegate_to: delegateName.trim() },
    });
    setDelegating(null);
    setDelegateName("");
  };

  const handleSkip = (item: Item) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
    skipMut.mutate(item.id);
  };

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
          Skip moves the card to the back.
        </div>
      </div>

      <div className="answer-stage">
        <div>
          <div className="queue-meta" data-testid="queue-meta">
            <span>
              <span className="count">{pending.length} ITEMS</span> AWAITING YOUR CALL
            </span>
          </div>
          <div className="pile-picker" data-testid="pile-picker">
            {(Object.keys(PILE_LABEL) as Pile[]).map((p) => (
              <button
                key={p}
                className={`pile-chip ${pile === p ? "active" : ""}`}
                onClick={() => setPile(p)}
                data-testid={`pile-${p}`}
              >
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
                {piles.map((p) => (
                  <div className="pile-col" key={p.label}>
                    <span className="pile-col-label">{p.label} · {p.items.length}</span>
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
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="side-rail">
          <div className="rail-card">
            <div className="rail-label">TODAY'S PROGRESS</div>
            <div className="rail-progress-bar">
              <div
                className="rail-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="rail-progress-text">
              <span>Decisions made</span>
              <b>{decidedToday} / {totalToday}</b>
            </div>
          </div>
        </aside>
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
  onDecide: (item: Item, decision: string) => void;
  onSkip: (item: Item) => void;
  delegating: string | null;
  delegateName: string;
  setDelegateName: (v: string) => void;
  confirmDelegate: (item: Item) => void;
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
            position={total ? `CARD ${index + 1} / ${total}` : `${items.length} TO GO`}
            onDecide={onDecide}
            onSkip={onSkip}
            delegating={delegating === front.id}
            delegateName={delegateName}
            setDelegateName={setDelegateName}
            confirmDelegate={() => confirmDelegate(front)}
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
  onDecide: (item: Item, decision: string) => void;
  onSkip: (item: Item) => void;
  delegating: boolean;
  delegateName: string;
  setDelegateName: (v: string) => void;
  confirmDelegate: () => void;
  cancelDelegate: () => void;
}) {
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

      <div className="decision-row">
        <button
          className="btn-decide action"
          onClick={() => onDecide(item, "team_to_action")}
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
          onClick={() => onDecide(item, "team_to_decline")}
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
          onClick={() => onDecide(item, "principal_to_respond")}
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
          onClick={() => onDecide(item, "delegate")}
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
              if (e.key === "Enter") confirmDelegate();
              if (e.key === "Escape") cancelDelegate();
            }}
            autoFocus
            data-testid={`input-delegate-${item.id}`}
          />
          <button onClick={confirmDelegate} data-testid={`confirm-delegate-${item.id}`}>CONFIRM</button>
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
