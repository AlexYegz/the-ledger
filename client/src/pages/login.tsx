import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [role, setRole] = useState<"principal" | "team">("principal");
  const [identity, setIdentity] = useState<"meghan" | "alexandra">("meghan");
  const [busy, setBusy] = useState(false);
  const { refetch } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { role };
      if (role === "team") body.identity = identity;
      const res = await apiRequest("POST", "/api/auth/login", body);
      const data = await res.json();
      if (data?.token) setAuthToken(data.token);

      // CRITICAL: Pre-seed the auth query cache BEFORE navigating.
      // Otherwise ProtectedRoute mounts before AuthProvider re-renders,
      // sees role=null, and bounces back to /login. That was the
      // "have to log in twice" bug.
      queryClient.setQueryData(["/api/auth/me"], {
        role: data.role,
        identity: data.identity,
      });
      // Also refetch in the background to confirm against the server.
      // We've already seeded the cache, so don't await.
      refetch();

      const targetRole = data.role;
      navigate(targetRole === "principal" ? "/answer" : "/workspace");
    } catch (err: any) {
      toast({
        title: "Sign-in failed",
        description: err?.message?.split(":").slice(1).join(":").trim() || "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-stage">
      <form
        className="login-card"
        onSubmit={submit}
        data-testid="login-form"
        style={{ padding: "48px 32px 40px", borderRadius: 12 }}
      >
        <div className="login-brand-block">
          <div className="login-brand-mark-wrap">
            <div className="login-brand-mark">
              <img src="icons/icon-ledger.png" alt="" aria-hidden="true" />
            </div>
          </div>
          <div className="login-wordmark">The Ledger</div>
          <div className="login-eyebrow">Action Tracker</div>
          <div className="login-accent-bar" />
        </div>

        <div className="login-tabs">
          <button
            type="button"
            className={role === "principal" ? "active" : ""}
            onClick={() => setRole("principal")}
            data-testid="tab-role-principal"
          >
            PRINCIPAL
          </button>
          <button
            type="button"
            className={role === "team" ? "active" : ""}
            onClick={() => setRole("team")}
            data-testid="tab-role-team"
          >
            TEAM
          </button>
        </div>

        {role === "team" && (
          <div className="login-field">
            <label>SIGN IN AS</label>
            <div className="login-identity-row">
              <div
                className={`login-identity-pick ${identity === "meghan" ? "active" : ""}`}
                onClick={() => setIdentity("meghan")}
                data-testid="pick-meghan"
              >
                MEGHAN
              </div>
              <div
                className={`login-identity-pick ${identity === "alexandra" ? "active" : ""}`}
                onClick={() => setIdentity("alexandra")}
                data-testid="pick-alexandra"
              >
                ALEXANDRA
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          style={{ width: "100%", justifyContent: "center", padding: "12px 18px", marginTop: 18 }}
          disabled={busy}
          autoFocus
          data-testid="button-sign-in"
        >
          {busy ? "SIGNING IN..." : "SIGN IN"}
        </button>

        <div
          style={{
            marginTop: 18,
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "'Inter', sans-serif",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textAlign: "center",
          }}
        >
          OFFICE OF JOE LIEMANDT
        </div>
      </form>
    </div>
  );
}
