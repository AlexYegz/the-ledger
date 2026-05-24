import { useState, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FlameIcon } from "@/components/Bits";
import { useToast } from "@/hooks/use-toast";

type Tab = "text" | "pdf" | "manual";

export function ParserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [emailUrl, setEmailUrl] = useState("");
  const [teamNote, setTeamNote] = useState("");
  const [timeSensitive, setTimeSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual form fields
  const [m, setM] = useState({
    date_received: new Date().toISOString().slice(0, 10),
    sender_name: "",
    sender_org: "",
    sender_email: "",
    subject: "",
    category: "other",
    context: "",
  });

  // PDF state
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);

  const { toast } = useToast();

  const parseMut = useMutation({
    mutationFn: async () => {
      setError(null);
      const r = await apiRequest("POST", "/api/items/parse", {
        mode: tab === "pdf" ? "pdf" : "text",
        content: tab === "pdf" ? pdfBase64 : text,
        emailUrl: emailUrl || null,
        teamNoteForPrincipal: teamNote || null,
        isTimeSensitive: timeSensitive,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      reset();
      onClose();
      toast({ title: "Item added", description: "Parsed and added to the ledger." });
    },
    onError: (e: any) => {
      setError(e?.message?.split(":").slice(1).join(":").trim() || "Failed to parse.");
    },
  });

  const manualMut = useMutation({
    mutationFn: async () => {
      setError(null);
      const r = await apiRequest("POST", "/api/items", {
        date_received: m.date_received,
        sender_name: m.sender_name,
        sender_org: m.sender_org || null,
        sender_email: m.sender_email || null,
        subject: m.subject,
        category: m.category,
        context: m.context,
        email_url: emailUrl || null,
        team_note_for_principal: teamNote || null,
        is_time_sensitive: timeSensitive ? 1 : 0,
        status: "not_started",
        skip_count: 0,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      reset();
      onClose();
      toast({ title: "Item added", description: "Manual item added to the ledger." });
    },
    onError: (e: any) => {
      setError(e?.message?.split(":").slice(1).join(":").trim() || "Failed to add.");
    },
  });

  const reset = () => {
    setText("");
    setEmailUrl("");
    setTeamNote("");
    setTimeSensitive(false);
    setPdfBase64(null);
    setPdfName(null);
    setError(null);
    setM({
      date_received: new Date().toISOString().slice(0, 10),
      sender_name: "",
      sender_org: "",
      sender_email: "",
      subject: "",
      category: "other",
      context: "",
    });
  };

  const onPdf = async (file: File) => {
    if (!file || file.type !== "application/pdf") {
      setError("Please drop a PDF file.");
      return;
    }
    setPdfName(file.name);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    setPdfBase64(btoa(binary));
  };

  const handleSubmit = () => {
    if (tab === "manual") {
      if (!m.sender_name || !m.subject || !m.context) {
        setError("Sender name, subject, and context are required.");
        return;
      }
      manualMut.mutate();
    } else {
      if (tab === "text" && !text.trim()) {
        setError("Paste an email to parse.");
        return;
      }
      if (tab === "pdf" && !pdfBase64) {
        setError("Upload a PDF first.");
        return;
      }
      parseMut.mutate();
    }
  };

  const busy = parseMut.isPending || manualMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent
        className="p-0 border-0 bg-transparent shadow-none max-w-2xl"
        data-testid="parser-modal"
      >
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-hi)",
            borderRadius: 16,
            padding: 28,
            boxShadow: "var(--shadow-card)",
            color: "var(--text)",
          }}
        >
          <div className="lemon" style={{ fontSize: 18, letterSpacing: "0.04em", marginBottom: 4 }}>
            ADD TO LEDGER
          </div>
          <div style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 20 }}>
            Paste an email, upload a PDF, or add manually.
          </div>

          <div className="parser-tabs">
            <button className={`parser-tab ${tab === "text" ? "active" : ""}`} onClick={() => setTab("text")} data-testid="tab-paste">PASTE TEXT</button>
            <button className={`parser-tab ${tab === "pdf" ? "active" : ""}`} onClick={() => setTab("pdf")} data-testid="tab-pdf">PDF UPLOAD</button>
            <button className={`parser-tab ${tab === "manual" ? "active" : ""}`} onClick={() => setTab("manual")} data-testid="tab-manual">MANUAL</button>
          </div>

          {error && <div className="parser-error" data-testid="parser-error">{error}</div>}

          {tab === "text" && (
            <textarea
              className="parser-textarea"
              placeholder="Paste the full email thread here. AI will parse the sender, date, subject, summary, and suggested action."
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="textarea-paste"
            />
          )}

          {tab === "pdf" && (
            <div
              ref={dropRef}
              className={`pdf-dropzone ${drag ? "drag" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) onPdf(f);
              }}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "application/pdf";
                input.onchange = () => input.files?.[0] && onPdf(input.files[0]);
                input.click();
              }}
              data-testid="pdf-dropzone"
            >
              <div className="lbl">{pdfName ? pdfName : "DROP A PDF HERE"}</div>
              <div className="sub">{pdfName ? "Click to replace" : "or click to choose a file"}</div>
            </div>
          )}

          {tab === "manual" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="parser-field">
                  <div className="parser-field-label">DATE RECEIVED</div>
                  <input type="date" value={m.date_received} onChange={(e) => setM({ ...m, date_received: e.target.value })} data-testid="manual-date" />
                </div>
                <div className="parser-field">
                  <div className="parser-field-label">CATEGORY</div>
                  <select value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })} data-testid="manual-category">
                    <option value="meeting_request">Meeting request</option>
                    <option value="approval">Approval</option>
                    <option value="response_needed">Response needed</option>
                    <option value="invitation">Invitation</option>
                    <option value="intro">Intro</option>
                    <option value="funding">Funding</option>
                    <option value="sales">Sales</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="parser-field">
                <div className="parser-field-label">SENDER NAME</div>
                <input value={m.sender_name} onChange={(e) => setM({ ...m, sender_name: e.target.value })} data-testid="manual-sender-name" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="parser-field">
                  <div className="parser-field-label">ORGANIZATION <span className="optional">OPTIONAL</span></div>
                  <input value={m.sender_org} onChange={(e) => setM({ ...m, sender_org: e.target.value })} data-testid="manual-sender-org" />
                </div>
                <div className="parser-field">
                  <div className="parser-field-label">SENDER EMAIL <span className="optional">OPTIONAL</span></div>
                  <input value={m.sender_email} onChange={(e) => setM({ ...m, sender_email: e.target.value })} data-testid="manual-sender-email" />
                </div>
              </div>
              <div className="parser-field">
                <div className="parser-field-label">SUBJECT</div>
                <input value={m.subject} onChange={(e) => setM({ ...m, subject: e.target.value })} data-testid="manual-subject" />
              </div>
              <div className="parser-field">
                <div className="parser-field-label">CONTEXT <span className="optional">2–3 SENTENCE SUMMARY · HTML &lt;b&gt; ALLOWED</span></div>
                <textarea value={m.context} onChange={(e) => setM({ ...m, context: e.target.value })} data-testid="manual-context" />
              </div>
            </>
          )}

          <div className="parser-field">
            <div className="parser-field-label">
              EMAIL URL <span className="optional">OPTIONAL · if Claude can't extract one</span>
            </div>
            <input value={emailUrl} onChange={(e) => setEmailUrl(e.target.value)} placeholder="https://mail.google.com/…" data-testid="input-email-url" />
          </div>

          <div className="parser-field">
            <div className="parser-field-label">
              NOTES FOR JOE <span className="optional">OPTIONAL · context he'll see on the card</span>
            </div>
            <textarea
              value={teamNote}
              onChange={(e) => setTeamNote(e.target.value)}
              placeholder="e.g. He's reached out twice before, last year he wanted to defer."
              data-testid="input-team-note"
            />
          </div>

          <div className="parser-options">
            <label
              className={`parser-toggle ${timeSensitive ? "checked" : ""}`}
              onClick={() => setTimeSensitive((v) => !v)}
              data-testid="toggle-time-sensitive"
            >
              <span className="checkbox" />
              <span className="flame-mini"><FlameIcon className="flame-icon" /></span>
              <span>Mark as time-sensitive</span>
            </label>
          </div>

          <div className="parser-actions">
            <button className="btn-ghost" onClick={() => { onClose(); reset(); }} data-testid="button-parser-cancel" disabled={busy}>CANCEL</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={busy} data-testid="button-parser-submit">
              {busy ? "WORKING…" : tab === "manual" ? "ADD ROW" : "PARSE & ADD ROW"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
