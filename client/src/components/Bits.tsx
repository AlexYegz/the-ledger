import flameUrl from "@assets/time_sensitive_flame.png";
import { CATEGORY_LABEL, CATEGORY_VAR, STATUS_CLASS, STATUS_LABEL, DECISION_LABEL, DECISION_CLASS, decisionTagLabel } from "@/lib/labels";
import type { Category, Decision, Status } from "@shared/schema";

export function FlameIcon({ className = "flame-icon", title }: { className?: string; title?: string }) {
  return (
    <span className={className} aria-label={title || "Time sensitive"} title={title || "Time sensitive"}>
      <img src={flameUrl} alt="" />
    </span>
  );
}

export function FlameTag() {
  return (
    <span className="flame-tag" data-testid="flame-tag">
      <FlameIcon />
      TIME SENSITIVE
    </span>
  );
}

export function CategoryPill({ category }: { category: string }) {
  const c = category as Category;
  const v = CATEGORY_VAR[c] || CATEGORY_VAR.other;
  return (
    <span
      className="category-pill"
      style={{ background: v.bg, color: v.fg }}
      data-testid={`category-${c}`}
    >
      {CATEGORY_LABEL[c] || category.toUpperCase()}
    </span>
  );
}

export function DecisionTag({
  decision,
  delegateTo,
}: {
  decision: string | null | undefined;
  delegateTo: string | null | undefined;
}) {
  const cls = decision ? DECISION_CLASS[decision as Decision] : "pending";
  return (
    <span className={`decision-tag ${cls || "pending"}`} data-testid={`decision-${decision || "pending"}`}>
      {decisionTagLabel(decision, delegateTo)}
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  const s = status as Status;
  return (
    <span className={`status-tag ${STATUS_CLASS[s]}`} data-testid={`status-${s}`}>
      <span className="dot" />
      {STATUS_LABEL[s]}
    </span>
  );
}

export function OwnerAvatar({ owner }: { owner: string | null | undefined }) {
  if (!owner) {
    return (
      <span className="owner-avatar" style={{ opacity: 0.5 }}>
        —
      </span>
    );
  }
  const cls = owner === "alexandra" ? "alex" : owner === "meghan" ? "meghan" : "";
  const letter = owner[0]?.toUpperCase() || "?";
  return <span className={`owner-avatar ${cls}`}>{letter}</span>;
}
