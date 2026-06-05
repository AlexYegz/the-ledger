import { useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";

export function TopBar() {
  const { me, refetch, actAsJoe, setActAsJoe } = useAuth();
  const [location, navigate] = useLocation();

  const isPrincipal = me.role === "principal";
  const isTeam = me.role === "team";
  const onAnswer = location === "/answer" || (isPrincipal && location === "/");
  const onStatus = location === "/status";
  const onWorkspace = location === "/workspace";

  // Show the view switcher to principals (always) and to team members
  // who are currently looking at one of Joe's views.
  const showViewSwitcher = isPrincipal || (isTeam && (onAnswer || onStatus));

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
    setAuthToken(null);
    // Make sure we leave capture mode on the way out.
    setActAsJoe(false);
    queryClient.clear();
    await refetch();
    navigate("/login");
  };

  const goToJoesView = () => {
    setActAsJoe(true);
    navigate("/answer");
  };

  const exitCaptureMode = () => {
    setActAsJoe(false);
    navigate("/workspace");
  };

  const homePath = isPrincipal ? "/answer" : actAsJoe ? "/answer" : "/workspace";

  return (
    <>
      <div className="topbar" data-testid="topbar">
        <div
          className="brand"
          onClick={() => navigate(homePath)}
          style={{ cursor: "pointer" }}
          data-testid="brand"
        >
          <div className="brand-mark">
            <img src="icons/icon-ledger.png" alt="" aria-hidden="true" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div className="brand-name">The Ledger</div>
            <div className="brand-eyebrow">Action Tracker</div>
          </div>
        </div>
        <div className="topbar-right">
          {showViewSwitcher && (
            <div className="view-switcher" data-testid="view-switcher">
              {isTeam && (
                <button
                  className={onWorkspace ? "active" : ""}
                  onClick={exitCaptureMode}
                  data-testid="button-view-workspace"
                >
                  Workspace
                </button>
              )}
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

          {/* Capture-mode toggle, team only. */}
          {isTeam && (
            <button
              className={`capture-toggle ${actAsJoe ? "on" : ""}`}
              onClick={() => (actAsJoe ? exitCaptureMode() : goToJoesView())}
              title={
                actAsJoe
                  ? "Stop recording decisions for Joe"
                  : "Open Joe's view and record decisions on his behalf"
              }
              data-testid="button-capture-toggle"
            >
              <span className="rec-dot" aria-hidden="true" />
              {actAsJoe ? "Recording for Joe" : "Record for Joe"}
            </button>
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
      {actAsJoe && (
        <div className="capture-banner" data-testid="capture-banner">
          <span className="rec-dot" aria-hidden="true" />
          Recording decisions on behalf of Joe — every click is logged as
          {" "}{(me.identity || "").toUpperCase()} (as Joe)
        </div>
      )}
    </>
  );
}
