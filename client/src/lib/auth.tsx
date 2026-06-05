import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type AuthMe = {
  role: "principal" | "team" | null;
  identity: "joe" | "meghan" | "alexandra" | null;
};

// localStorage flag for "recording for Joe" mode. Only meaningful for
// team users; principals ignore it. We persist it so a page refresh
// during a screen-share doesn't drop you out of capture mode.
const ACT_AS_JOE_KEY = "the-ledger.act-as-joe";
export function readActAsJoe(): boolean {
  try {
    return localStorage.getItem(ACT_AS_JOE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeActAsJoe(on: boolean) {
  try {
    if (on) localStorage.setItem(ACT_AS_JOE_KEY, "1");
    else localStorage.removeItem(ACT_AS_JOE_KEY);
  } catch {}
}

type Ctx = {
  me: AuthMe;
  isLoading: boolean;
  refetch: () => Promise<AuthMe | undefined>;
  // Set auth directly from the login response so navigation can
  // happen on the very next render without waiting for react-query
  // to flush an observer notification through the AuthProvider.
  setMe: (me: AuthMe) => void;
  // "Recording for Joe" capture mode (team only).
  actAsJoe: boolean;
  setActAsJoe: (on: boolean) => void;
};

const AuthCtx = createContext<Ctx>({
  me: { role: null, identity: null },
  isLoading: false,
  refetch: async () => undefined,
  setMe: () => {},
  actAsJoe: false,
  setActAsJoe: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  // Local mirror of the auth state. When set via setMe (after login),
  // it takes precedence over the query result so the next render of
  // any consumer (e.g. ProtectedRoute) sees the new role synchronously.
  const [override, setOverride] = useState<AuthMe | null>(null);
  const [actAsJoe, setActAsJoeState] = useState<boolean>(readActAsJoe());
  const qc = useQueryClient();

  const q = useQuery<AuthMe>({
    queryKey: ["/api/auth/me"],
    staleTime: 5_000,
    // While we have a logged-in override, don't auto-clear it from
    // a stale background fetch.
    enabled: override === null,
  });

  const setMe = useCallback((me: AuthMe) => {
    setOverride(me);
    // If they signed in as someone who isn't a team member, force
    // capture mode off so principals don't get a stray header.
    if (me.role !== "team" && readActAsJoe()) {
      writeActAsJoe(false);
      setActAsJoeState(false);
    }
  }, []);

  const setActAsJoe = useCallback(
    (on: boolean) => {
      writeActAsJoe(on);
      setActAsJoeState(on);
      // Invalidate item/activity caches so the views refetch with the
      // new actor-attribution context. Cheap and avoids stale optimistic
      // updates from carrying the wrong actor label.
      qc.invalidateQueries({ queryKey: ["/api/items"] });
      qc.invalidateQueries({ queryKey: ["/api/activity"] });
    },
    [qc],
  );

  const me = override || q.data || { role: null, identity: null };
  const isLoading = override === null && q.isLoading;

  // Belt-and-suspenders: if the user becomes a principal, ensure capture
  // mode is off.
  useEffect(() => {
    if (me.role === "principal" && actAsJoe) {
      writeActAsJoe(false);
      setActAsJoeState(false);
    }
  }, [me.role, actAsJoe]);

  return (
    <AuthCtx.Provider
      value={{
        me,
        isLoading,
        refetch: async () => (await q.refetch()).data,
        setMe,
        actAsJoe: me.role === "team" && actAsJoe,
        setActAsJoe,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
