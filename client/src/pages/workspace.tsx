import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { HeroBanner } from "@/components/HeroBanner";
import { LedgerRow } from "@/components/LedgerRow";
import { ParserModal } from "@/components/ParserModal";
import type { Item } from "@shared/schema";

type Tab = "active" | "archived" | "trash";

type SortKey = "date" | "decision" | "sender" | "status" | "owner" | "internal";
const SORT_LABEL: Record<SortKey, string> = {
  date: "DATE",
  decision: "DECISION",
  sender: "SENDER",
  status: "STATUS",
  owner: "OWNER",
  internal: "INT/EXT",
};

export default function WorkspacePage({ readOnly = false }: { readOnly?: boolean }) {
  // Status (Joe's read-only) view sees active + archived together; team sees one tab at a time.
  const [tab, setTab] = useState<Tab>("active");
  const scope = readOnly ? "all_visible" : tab;
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string | "">("");
  const [filterDec, setFilterDec] = useState<string | "">("");
  const [filterStatus, setFilterStatus] = useState<string | "">("");
  const [filterOwner, setFilterOwner] = useState<string | "">("");
  const [filterIntExt, setFilterIntExt] = useState<"" | "internal" | "external">("");
  const [filterTS, setFilterTS] = useState<"" | "ts">("");
  const [parserOpen, setParserOpen] = useState(false);

  // Custom queryFn because the default joins queryKey parts into the URL path,
  // which doesn't play nice with query-string scopes. We want /api/items?scope=...
  const itemsQ = useQuery<Item[]>({
    queryKey: ["/api/items", { scope }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/items?scope=${scope}`);
      return res.json();
    },
  });
  const cfgQ = useQuery<{ internalDomains: string[] }>({ queryKey: ["/api/config"] });

  const isInternal = (email: string | null | undefined) => {
    if (!email) return false;
    const m = email.toLowerCase().match(/@([^\s>]+)$/);
    if (!m) return false;
    const domain = m[1].trim();
    return (cfgQ.data?.internalDomains || []).some(
      (d) => domain === d.toLowerCase() || domain.endsWith("." + d.toLowerCase()),
    );
  };

  const items = useMemo(() => {
    let arr = itemsQ.data || [];
    if (search.trim()) {
      const s = search.toLowerCase();
      arr = arr.filter(
        (i) =>
          i.sender_name.toLowerCase().includes(s) ||
          (i.sender_org || "").toLowerCase().includes(s) ||
          i.subject.toLowerCase().includes(s) ||
          (i.context || "").toLowerCase().includes(s),
      );
    }
    if (filterCat) arr = arr.filter((i) => i.category === filterCat);
    if (filterDec) {
      if (filterDec === "pending") arr = arr.filter((i) => !i.decision);
      else arr = arr.filter((i) => i.decision === filterDec);
    }
    if (filterStatus) arr = arr.filter((i) => i.status === filterStatus);
    if (filterOwner) {
      if (filterOwner === "unassigned") arr = arr.filter((i) => !i.owner);
      else arr = arr.filter((i) => i.owner === filterOwner);
    }
    if (filterIntExt) {
      arr = arr.filter((i) =>
        filterIntExt === "internal"
          ? isInternal(i.sender_email)
          : !isInternal(i.sender_email),
      );
    }
    if (filterTS) arr = arr.filter((i) => i.is_time_sensitive);

    const cmp = (a: Item, b: Item) => {
      let r = 0;
      switch (sort) {
        case "date":
          r = a.date_received.localeCompare(b.date_received);
          break;
        case "decision":
          r = (a.decision || "").localeCompare(b.decision || "");
          break;
        case "sender":
          r = a.sender_name.localeCompare(b.sender_name);
          break;
        case "status":
          r = a.status.localeCompare(b.status);
          break;
        case "owner":
          r = (a.owner || "").localeCompare(b.owner || "");
          break;
        case "internal":
          r =
            (isInternal(a.sender_email) ? 1 : 0) -
            (isInternal(b.sender_email) ? 1 : 0);
          break;
      }
      return dir === "desc" ? -r : r;
    };
    return [...arr].sort(cmp);
  }, [itemsQ.data, search, sort, dir, filterCat, filterDec, filterStatus, filterOwner, filterIntExt, filterTS, cfgQ.data]);

  const exportCsv = () => {
    const rows = [
      ["date", "sender", "org", "email", "subject", "category", "decision", "owner", "status", "time_sensitive"],
      ...items.map((i) => [
        i.date_received,
        i.sender_name,
        i.sender_org || "",
        i.sender_email || "",
        i.subject,
        i.category,
        i.decision || "",
        i.owner || "",
        i.status,
        i.is_time_sensitive ? "yes" : "no",
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((c) => {
            const s = String(c).replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <TopBar />
      <HeroBanner
        title={readOnly ? "Status" : "Workspace"}
        subtitle={
          readOnly
            ? "Read-only view of every item in flight. Click a row to drill into context and history."
            : "Sortable list. Click a row to expand context, notes, and the notes thread."
        }
      />

      <div className="workspace">
        {!readOnly && (
          <div className="ws-tabs" data-testid="workspace-tabs">
            <button
              className={`ws-tab ${tab === "active" ? "active" : ""}`}
              onClick={() => setTab("active")}
              data-testid="tab-active"
            >
              ACTIVE
            </button>
            <button
              className={`ws-tab ${tab === "archived" ? "active" : ""}`}
              onClick={() => setTab("archived")}
              data-testid="tab-archived"
            >
              ARCHIVE
            </button>
            <button
              className={`ws-tab ${tab === "trash" ? "active" : ""}`}
              onClick={() => setTab("trash")}
              data-testid="tab-trash"
            >
              TRASH
            </button>
          </div>
        )}

        <div className="workspace-toolbar">
          <div className="toolbar-left">
            {!readOnly && tab === "active" && (
              <button
                className="btn-primary"
                onClick={() => setParserOpen(true)}
                data-testid="button-add-to-ledger"
              >
                <span className="icon">+</span> ADD TO LEDGER
              </button>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <div className="sort-pill" data-testid="button-sort">
                  SORT: {SORT_LABEL[sort]} <span className="arrow">{dir === "desc" ? "↓" : "↑"}</span>
                </div>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0 border-0 bg-transparent shadow-none">
                <div className="lm-dropdown">
                  <div className="sub-lbl">SORT BY</div>
                  {(["date", "decision", "sender", "status", "owner", "internal"] as SortKey[]).map(
                    (k) => (
                      <div
                        key={k}
                        className={`opt ${sort === k ? "selected" : ""}`}
                        onClick={() => setSort(k)}
                        data-testid={`option-sort-${k}`}
                      >
                        {SORT_LABEL[k]}
                      </div>
                    ),
                  )}
                  <div className="sub-lbl" style={{ marginTop: 6 }}>DIRECTION</div>
                  <div className={`opt ${dir === "desc" ? "selected" : ""}`} onClick={() => setDir("desc")} data-testid="option-dir-desc">DESCENDING ↓</div>
                  <div className={`opt ${dir === "asc" ? "selected" : ""}`} onClick={() => setDir("asc")} data-testid="option-dir-asc">ASCENDING ↑</div>
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <div className="sort-pill" data-testid="button-filter">
                  FILTER {anyFilter(filterCat, filterDec, filterStatus, filterOwner, filterIntExt, filterTS) ? <span style={{ color: "var(--neon)" }}>·</span> : null}
                  <span className="arrow">▾</span>
                </div>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0 border-0 bg-transparent shadow-none">
                <div className="lm-dropdown" style={{ minWidth: 260, padding: 12 }}>
                  <div className="sub-lbl">CATEGORY</div>
                  <select
                    value={filterCat}
                    onChange={(e) => setFilterCat(e.target.value)}
                    style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border-c)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "Inter, sans-serif", fontSize: 12 }}
                    data-testid="filter-category"
                  >
                    <option value="">All</option>
                    <option value="meeting_request">Meeting request</option>
                    <option value="approval">Approval</option>
                    <option value="response_needed">Response needed</option>
                    <option value="invitation">Invitation</option>
                    <option value="intro">Intro</option>
                    <option value="funding">Funding</option>
                    <option value="sales">Sales</option>
                    <option value="other">Other</option>
                  </select>

                  <div className="sub-lbl" style={{ marginTop: 10 }}>JOE'S CALL</div>
                  <select value={filterDec} onChange={(e) => setFilterDec(e.target.value)} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border-c)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "Inter, sans-serif", fontSize: 12 }} data-testid="filter-decision">
                    <option value="">All</option>
                    <option value="pending">Awaiting Joe</option>
                    <option value="team_to_action">Team to action</option>
                    <option value="team_to_decline">Team to decline</option>
                    <option value="principal_to_respond">Joe to respond</option>
                    <option value="delegate">Delegate</option>
                  </select>

                  <div className="sub-lbl" style={{ marginTop: 10 }}>STATUS</div>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border-c)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "Inter, sans-serif", fontSize: 12 }} data-testid="filter-status">
                    <option value="">All</option>
                    <option value="not_started">Not started</option>
                    <option value="in_progress">In progress</option>
                    <option value="waiting">Waiting</option>
                    <option value="complete">Complete</option>
                    <option value="canceled">Canceled</option>
                  </select>

                  <div className="sub-lbl" style={{ marginTop: 10 }}>OWNER</div>
                  <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border-c)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "Inter, sans-serif", fontSize: 12 }} data-testid="filter-owner">
                    <option value="">All</option>
                    <option value="unassigned">Unassigned</option>
                    <option value="meghan">Meghan</option>
                    <option value="alexandra">Alexandra</option>
                  </select>

                  <div className="sub-lbl" style={{ marginTop: 10 }}>INTERNAL / EXTERNAL</div>
                  <select value={filterIntExt} onChange={(e) => setFilterIntExt(e.target.value as any)} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border-c)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "Inter, sans-serif", fontSize: 12 }} data-testid="filter-internal">
                    <option value="">All</option>
                    <option value="internal">Internal</option>
                    <option value="external">External</option>
                  </select>

                  <div className="opt" onClick={() => setFilterTS(filterTS ? "" : "ts")} data-testid="filter-time-sensitive" style={{ marginTop: 10 }}>
                    {filterTS ? "✓ " : ""}TIME-SENSITIVE ONLY
                  </div>

                  <div className="opt" style={{ color: "var(--text-dim)", marginTop: 6 }} onClick={() => { setFilterCat(""); setFilterDec(""); setFilterStatus(""); setFilterOwner(""); setFilterIntExt(""); setFilterTS(""); }} data-testid="filter-clear">
                    CLEAR ALL
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="toolbar-right">
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }} />
              <input
                className="search-input"
                placeholder="Search…"
                style={{ paddingLeft: 30 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search"
              />
            </div>
            <button className="btn-ghost" onClick={exportCsv} data-testid="button-export">EXPORT</button>
          </div>
        </div>

        <div className="ledger-list" data-testid="ledger-list">
          <div className="ledger-row head">
            <div className="sortable" onClick={() => { setSort("date"); setDir(sort === "date" && dir === "desc" ? "asc" : "desc"); }}>DATE {sort === "date" && <span className="arrow">{dir === "desc" ? "↓" : "↑"}</span>}</div>
            <div className="sortable" onClick={() => { setSort("sender"); setDir(sort === "sender" && dir === "asc" ? "desc" : "asc"); }}>NAME / CATEGORY</div>
            <div className="sortable" onClick={() => { setSort("decision"); setDir(sort === "decision" && dir === "asc" ? "desc" : "asc"); }}>JOE'S CALL</div>
            <div className="sortable" onClick={() => { setSort("owner"); setDir(sort === "owner" && dir === "asc" ? "desc" : "asc"); }}>OWNER</div>
            <div className="sortable" onClick={() => { setSort("status"); setDir(sort === "status" && dir === "asc" ? "desc" : "asc"); }}>STATUS</div>
            <div />
          </div>

          {itemsQ.isLoading ? (
            <div className="empty-state">
              <div className="eb">LOADING…</div>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state" data-testid="empty-state">
              <div className="eb">
                {(itemsQ.data || []).length === 0
                  ? tab === "archived"
                    ? "ARCHIVE IS EMPTY"
                    : tab === "trash"
                    ? "TRASH IS EMPTY"
                    : "NO ITEMS YET"
                  : "NO MATCHES"}
              </div>
              <div className="sb">
                {(itemsQ.data || []).length === 0
                  ? readOnly
                    ? "Items will appear here once Meghan or Alexandra adds them."
                    : tab === "archived"
                    ? "Archive cards from the Active tab to file them here."
                    : tab === "trash"
                    ? "Items deleted from the Active tab live here for 30 days, then are permanently removed."
                    : "Click ADD TO LEDGER to parse an email or add a row manually."
                  : "Try clearing filters or adjusting your search."}
              </div>
            </div>
          ) : (
            items.map((item) => (
              <LedgerRow
                key={item.id}
                item={item}
                isInternal={isInternal(item.sender_email)}
                readOnly={readOnly}
                scope={readOnly ? "all_visible" : tab}
              />
            ))
          )}
        </div>
      </div>

      <ParserModal open={parserOpen} onClose={() => setParserOpen(false)} />
    </>
  );
}

function anyFilter(...vals: any[]) {
  return vals.some((v) => v);
}
