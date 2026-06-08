// Sticky floating bar shown in the workspace whenever 1+ rows are
// selected. Bulk actions are tab-aware: Active/Archived tabs offer
// Archive/Unarchive + Delete; Trash tab offers Restore + permanent
// delete (still a soft action server-side — items just stay in trash).
//
// Delete always confirms. Other actions fire immediately and are
// recoverable from the activity log / trash.

import { useState } from "react";
import { Archive, ArchiveRestore, Trash2, X, RotateCcw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSelection } from "@/lib/selection";
import { useToast } from "@/hooks/use-toast";

type Tab = "active" | "archived" | "trash";

export function BulkActionBar({ tab }: { tab: Tab }) {
  const { selected, count, clear } = useSelection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();

  const bulkMut = useMutation({
    mutationFn: async (action: "archive" | "unarchive" | "delete" | "restore") => {
      const ids = Array.from(selected);
      const r = await apiRequest("POST", "/api/items/bulk", { ids, action });
      return (await r.json()) as { ok: boolean; updated: number; skipped: number };
    },
    onSuccess: (data, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      const word =
        action === "archive" ? "archived"
        : action === "unarchive" ? "unarchived"
        : action === "delete" ? "moved to trash"
        : "restored";
      toast({
        title: `${data.updated} item${data.updated === 1 ? "" : "s"} ${word}`,
        description: data.skipped
          ? `${data.skipped} skipped (already in that state)`
          : undefined,
      });
      clear();
      setConfirmOpen(false);
    },
    onError: () => {
      toast({
        title: "Bulk action failed",
        description: "Please try again. If it keeps failing, refresh.",
        variant: "destructive",
      });
    },
  });

  if (count === 0) return null;

  const isTrashTab = tab === "trash";
  const isArchivedTab = tab === "archived";

  return (
    <>
      <div className="bulk-bar" data-testid="bulk-bar">
        <div className="count">
          {count} SELECTED
        </div>

        {!isTrashTab && !isArchivedTab && (
          <button
            onClick={() => bulkMut.mutate("archive")}
            disabled={bulkMut.isPending}
            title="Archive selected"
            data-testid="bulk-archive"
          >
            <Archive size={14} /> Archive
          </button>
        )}

        {isArchivedTab && (
          <button
            className="primary"
            onClick={() => bulkMut.mutate("unarchive")}
            disabled={bulkMut.isPending}
            title="Move back to active"
            data-testid="bulk-unarchive"
          >
            <ArchiveRestore size={14} /> Unarchive
          </button>
        )}

        {isTrashTab && (
          <button
            className="primary"
            onClick={() => bulkMut.mutate("restore")}
            disabled={bulkMut.isPending}
            title="Restore selected from trash"
            data-testid="bulk-restore"
          >
            <RotateCcw size={14} /> Restore
          </button>
        )}

        {!isTrashTab && (
          <button
            className="danger"
            onClick={() => setConfirmOpen(true)}
            disabled={bulkMut.isPending}
            title="Move to trash"
            data-testid="bulk-delete"
          >
            <Trash2 size={14} /> Delete
          </button>
        )}

        <div className="divider" />
        <button
          onClick={clear}
          title="Clear selection (Esc)"
          data-testid="bulk-clear"
        >
          <X size={14} /> Clear
        </button>
      </div>

      {confirmOpen && (
        <div
          className="bulk-confirm-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false);
          }}
        >
          <div className="bulk-confirm" data-testid="bulk-confirm-dialog">
            <h3>
              Delete {count} item{count === 1 ? "" : "s"}?
            </h3>
            <p>
              {count === 1 ? "This item" : `These ${count} items`} will move
              to Trash and auto-purge after 30 days. You can restore from
              Trash any time before then.
            </p>
            <div className="actions">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={bulkMut.isPending}
                data-testid="bulk-confirm-cancel"
              >
                Cancel
              </button>
              <button
                className="danger"
                onClick={() => bulkMut.mutate("delete")}
                disabled={bulkMut.isPending}
                data-testid="bulk-confirm-delete"
              >
                {bulkMut.isPending ? "Deleting…" : "Move to Trash"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
