import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type AuthMe = {
  role: "principal" | "team" | null;
  identity: "joe" | "meghan" | "alexandra" | null;
};

type Ctx = {
  me: AuthMe;
  isLoading: boolean;
  refetch: () => void;
};

const AuthCtx = createContext<Ctx>({
  me: { role: null, identity: null },
  isLoading: false,
  refetch: () => {},
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
        refetch: () => q.refetch(),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
