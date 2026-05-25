import { useState } from "react";
import { useLocation } from "wouter";
import { Sun, Moon } from "lucide-react";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [role, setRole] = useState<"principal" | "team">("principal");
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState<"meghan" | "alexandra">("meghan");
  const [busy, setBusy] = useState(false);
  const { refetch } = useAuth();
  const { theme, toggle } = useTheme();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { role, password };
      if (role === "team") body.identity = identity;
      const res = await apiRequest("POST", "/api/auth/login", body);
      const data = await res.json();
      if (data?.token) setAuthToken(data.token);
      // Force a fresh /api/auth/me read with the new token before navigating.
      // (Without awaiting actual data, the route guard sees null role and bounces back.)
      const fresh = await refetch();
      const targetRole = fresh?.role || data.role;
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
      <div style={{ position: "fixed", top: 20, right: 20 }}>
        <button
          className="theme-toggle"
          onClick={toggle}
          title="Toggle theme"
          aria-label="Toggle theme"
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
      </div>
      <form className="login-card" onSubmit={submit} data-testid="login-form">
        <div className="brand" style={{ marginBottom: 18 }}>
          <div className="brand-mark">L</div>
          <div className="brand-name">THE LEDGER</div>
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

        <div className="login-field">
          <label>PASSWORD</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            data-testid="input-password"
          />
        </div>

        <button
          type="submit"
          className="btn-primary"
          style={{ width: "100%", justifyContent: "center", padding: "12px 18px" }}
          disabled={busy}
          data-testid="button-sign-in"
        >
          {busy ? "SIGNING IN…" : "SIGN IN"}
        </button>

        <div
          style={{
            marginTop: 18,
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "Lemon Milk, sans-serif",
            letterSpacing: "0.1em",
            textAlign: "center",
          }}
        >
          OFFICE OF JOE LIEMANDT · DECISION TRACKER
        </div>
      </form>
    </div>
  );
}
