import { useState } from "react";
import { useLocation } from "wouter";
import { GoogleLogin } from "@react-oauth/google";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const { setMe } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleGoogleCredential = async (credential: string) => {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/auth/google", { credential });
      const data = await res.json();
      if (data?.token) setAuthToken(data.token);

      setMe({ role: data.role, identity: data.identity });
      queryClient.setQueryData(["/api/auth/me"], {
        role: data.role,
        identity: data.identity,
      });

      await new Promise((r) => setTimeout(r, 0));
      navigate(data.role === "principal" ? "/answer" : "/workspace");
    } catch (err: any) {
      const detail = err?.message?.split(":").slice(1).join(":").trim();
      toast({
        title: "Sign-in failed",
        description: detail || "This account isn't authorized for The Ledger.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-stage">
      <div
        className="login-card"
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

        <div
          style={{
            marginTop: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            opacity: busy ? 0.6 : 1,
            pointerEvents: busy ? "none" : "auto",
          }}
        >
          <GoogleLogin
            onSuccess={(cred) => {
              if (cred.credential) handleGoogleCredential(cred.credential);
            }}
            onError={() => {
              toast({
                title: "Google sign-in failed",
                description: "Try again, or check that pop-ups aren't blocked.",
                variant: "destructive",
              });
            }}
            theme="filled_black"
            size="large"
            shape="rectangular"
            text="signin_with"
            useOneTap={false}
          />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              textAlign: "center",
              maxWidth: 260,
              lineHeight: 1.5,
            }}
          >
            Sign in with your Alpha School or Trilogy Google account.
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
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
      </div>
    </div>
  );
}
