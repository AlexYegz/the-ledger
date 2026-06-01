import { useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";

export function TopBar() {
  const { me, refetch } = useAuth();
  const [location, navigate] = useLocation();

  const isPrincipal = me.role === "principal";
  const onAnswer = location === "/answer" || location === "/";
  const onStatus = location === "/status";

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
    setAuthToken(null);
    queryClient.clear();
    await refetch();
    navigate("/login");
  };

  return (
    <div className="topbar" data-testid="topbar">
      <div
        className="brand"
        onClick={() => navigate(me.role === "team" ? "/workspace" : "/answer")}
        style={{ cursor: "pointer" }}
        data-testid="brand"
      >
        <div className="brand-mark">L</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div className="brand-name">The Ledger</div>
          <div className="brand-eyebrow">Office of Joe Liemandt</div>
        </div>
      </div>
      <div className="topbar-right">
        {isPrincipal && (
          <div className="view-switcher" data-testid="view-switcher">
            <button
              className={onAnswer ? "active" : ""}
              onClick={() => navigate("/answer")}
              data-testid="button-view-answer"
            >
              Answer
            </button>
            <button
              className={onStatus ? "active" : ""}
              onClick={() => navigate("/status")}
              data-testid="button-view-status"
            >
              Status
            </button>
          </div>
        )}
        {me.role && (
          <div className="who-badge" data-testid="who-badge">
            <span className="dot" />
            {me.identity === "joe" ? "JOE" : (me.identity || "").toUpperCase()}
          </div>
        )}
        {me.role && (
          <button
            className="sign-out-btn"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            data-testid="button-logout"
          >
            <LogOut />
          </button>
        )}
      </div>
    </div>
  );
}
