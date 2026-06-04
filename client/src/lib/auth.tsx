import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type AuthMe = {
  role: "principal" | "team" | null;
  identity: "joe" | "meghan" | "alexandra" | null;
};

type Ctx = {
  me: AuthMe;
  isLoading: boolean;
  refetch: () => Promise<AuthMe | undefined>;
  // Set auth directly from the login response so navigation can
  // happen on the very next render without waiting for react-query
  // to flush an observer notification through the AuthProvider.
  setMe: (me: AuthMe) => void;
};

const AuthCtx = createContext<Ctx>({
  me: { role: null, identity: null },
  isLoading: false,
  refetch: async () => undefined,
  setMe: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  // Local mirror of the auth state. When set via setMe (after login),
  // it takes precedence over the query result so the next render of
  // any consumer (e.g. ProtectedRoute) sees the new role synchronously.
  const [override, setOverride] = useState<AuthMe | null>(null);

  const q = useQuery<AuthMe>({
    queryKey: ["/api/auth/me"],
    staleTime: 5_000,
    // While we have a logged-in override, don't auto-clear it from
    // a stale background fetch.
    enabled: override === null,
  });

  const setMe = useCallback((me: AuthMe) => {
    setOverride(me);
  }, []);

  const me = override || q.data || { role: null, identity: null };
  const isLoading = override === null && q.isLoading;

  return (
    <AuthCtx.Provider
      value={{
        me,
        isLoading,
        refetch: async () => (await q.refetch()).data,
        setMe,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
