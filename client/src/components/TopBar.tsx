import { useLocation } from "wouter";
import { Sun, Moon, LogOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";

export function TopBar() {
  const { theme, toggle } = useTheme();
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
      <div className="brand" onClick={() => navigate(me.role === "team" ? "/workspace" : "/answer")} style={{ cursor: "pointer" }} data-testid="brand">
        <div className="brand-mark">L</div>
        <div className="brand-name">THE LEDGER</div>
      </div>
      <div className="topbar-right">
        {isPrincipal && (
          <div className="view-switcher" data-testid="view-switcher">
            <button
              className={onAnswer ? "active" : ""}
              onClick={() => navigate("/answer")}
              data-testid="button-view-answer"
            >
              ANSWER
            </button>
            <button
              className={onStatus ? "active" : ""}
              onClick={() => navigate("/status")}
              data-testid="button-view-status"
            >
              STATUS
            </button>
          </div>
        )}
        {me.role && (
          <div className="who-badge" data-testid="who-badge">
            <span className="dot" />
            {me.identity === "joe" ? "JOE" : (me.identity || "").toUpperCase()}
          </div>
        )}
        <button
          className="theme-toggle"
          onClick={toggle}
          title="Toggle theme"
          aria-label="Toggle theme"
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
        {me.role && (
          <button
            className="theme-toggle"
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
