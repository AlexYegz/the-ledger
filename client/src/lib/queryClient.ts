import { QueryClient, QueryFunction } from "@tanstack/react-query";

// API base resolution order:
//   1. VITE_API_BASE if set at build time (deployed frontend points at Railway)
//   2. __PORT_5000__ placeholder if rewritten by deploy_website
//   3. empty string (same-origin) for local dev
const PORT_PLACEHOLDER = "__PORT_5000__";
const ENV_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";
const API_BASE = ENV_BASE
  ? ENV_BASE.replace(/\/$/, "")
  : PORT_PLACEHOLDER.startsWith("__")
    ? ""
    : PORT_PLACEHOLDER;

// Token is stored in module scope (and mirrored into the AuthProvider for re-renders).
// localStorage/sessionStorage are blocked in the sandboxed iframe, and cookies
// don't survive the proxy, so the token must live in memory only.
let AUTH_TOKEN: string | null = null;

export function setAuthToken(token: string | null) {
  AUTH_TOKEN = token;
}

export function getAuthToken(): string | null {
  return AUTH_TOKEN;
}

function authHeader(): Record<string, string> {
  return AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = { ...authHeader() };
  if (data) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: { ...authHeader() },
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
