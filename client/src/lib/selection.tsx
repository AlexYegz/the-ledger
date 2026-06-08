// Cross-section multi-select for workspace bulk actions.
//
// Selection is stored as a Set of item ids in a React context so any row
// and the bulk-action bar can read/write without prop-drilling. Lives only
// while the Workspace is mounted — selection is intentionally cleared on
// route change (no surprises later).
//
// Range-select: the row passes the *ordered list of visible ids* and its
// own id on click. We remember the last-clicked id; on shift-click, we
// toggle every id between the anchor and the new click.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  selected: Set<string>;
  count: number;
  has: (id: string) => boolean;
  toggle: (id: string, opts?: { range?: boolean; visibleIds?: string[] }) => void;
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const SelectionCtx = createContext<Ctx>({
  selected: new Set(),
  count: 0,
  has: () => false,
  toggle: () => {},
  setMany: () => {},
  clear: () => {},
});

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  const has = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback(
    (id: string, opts?: { range?: boolean; visibleIds?: string[] }) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (opts?.range && anchorRef.current && opts.visibleIds?.length) {
          const ids = opts.visibleIds;
          const a = ids.indexOf(anchorRef.current);
          const b = ids.indexOf(id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            // Range action follows the anchor's current state: if the
            // anchor is selected, the range is selected too; if not,
            // the range is deselected. Matches Gmail/Finder behavior.
            const turnOn = prev.has(anchorRef.current!);
            for (let i = lo; i <= hi; i++) {
              if (turnOn) next.add(ids[i]);
              else next.delete(ids[i]);
            }
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchorRef.current = id;
        return next;
      });
    },
    [],
  );

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const value = useMemo<Ctx>(
    () => ({ selected, count: selected.size, has, toggle, setMany, clear }),
    [selected, has, toggle, setMany, clear],
  );

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

export function useSelection() {
  return useContext(SelectionCtx);
}
