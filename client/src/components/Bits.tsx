import flameUrl from "@assets/time_sensitive_flame.png";
import { CATEGORY_LABEL, CATEGORY_VAR, STATUS_CLASS, STATUS_LABEL, DECISION_LABEL, DECISION_CLASS, decisionTagLabel } from "@/lib/labels";
import type { Category, Decision, Status } from "@shared/schema";

export function FlameIcon({
  className = "flame-icon",
  title,
  size,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <span
      className={className}
      aria-label={title || "Time sensitive"}
      title={title || "Time sensitive"}
      data-testid="flame-icon"
      style={style}
    >
      <img src={flameUrl} alt="" />
    </span>
  );
}

// Backwards-compat: same icon, just bigger. Used on cards.
export function FlameTag() {
  return <FlameIcon className="flame-icon flame-icon-lg" />;
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
  customLabel,
}: {
  decision: string | null | undefined;
  delegateTo: string | null | undefined;
  customLabel?: string | null;
}) {
  const cls = decision ? DECISION_CLASS[decision as Decision] : "pending";
  const routeLabel = decisionTagLabel(decision, delegateTo);
  if (customLabel && decision) {
    return (
      <span
        className={`decision-tag ${cls || "pending"} has-custom-label`}
        data-testid={`decision-${decision}`}
        title={routeLabel}
      >
        <span className="decision-custom">{customLabel.toUpperCase()}</span>
        <span className="decision-route">{routeLabel}</span>
      </span>
    );
  }
  return (
    <span className={`decision-tag ${cls || "pending"}`} data-testid={`decision-${decision || "pending"}`}>
      {routeLabel}
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
        ?
      </span>
    );
  }
  const cls = owner === "alexandra" ? "alex" : owner === "meghan" ? "meghan" : "";
  const letter = owner[0]?.toUpperCase() || "?";
  return <span className={`owner-avatar ${cls}`}>{letter}</span>;
}
