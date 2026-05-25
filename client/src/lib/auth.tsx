import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type AuthMe = {
  role: "principal" | "team" | null;
  identity: "joe" | "meghan" | "alexandra" | null;
};

type Ctx = {
  me: AuthMe;
  isLoading: boolean;
  refetch: () => Promise<AuthMe | undefined>;
};

const AuthCtx = createContext<Ctx>({
  me: { role: null, identity: null },
  isLoading: false,
  refetch: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const q = useQuery<AuthMe>({
    queryKey: ["/api/auth/me"],
    staleTime: 5_000,
  });
  return (
    <AuthCtx.Provider
      value={{
        me: q.data || { role: null, identity: null },
        isLoading: q.isLoading,
        refetch: async () => (await q.refetch()).data,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
