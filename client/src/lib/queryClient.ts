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

// Token persistence: when the app runs on its own origin (Railway), localStorage
// works fine. When it runs inside the sandboxed iframe preview, localStorage may
// throw — we catch and degrade to in-memory only.
const TOKEN_STORAGE_KEY = "ledger.auth_token";
function safeStorageGet(): string | null {
  try { return window.localStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
}
function safeStorageSet(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch { /* sandboxed — ignore */ }
}
let AUTH_TOKEN: string | null = safeStorageGet();

export function setAuthToken(token: string | null) {
  AUTH_TOKEN = token;
  safeStorageSet(token);
}

export function getAuthToken(): string | null {
  return AUTH_TOKEN;
}

// Read "acting as Joe" flag from localStorage on every request so the
// auth.tsx toggle and any other tab stay in sync without prop-drilling.
const ACT_AS_JOE_KEY = "the-ledger.act-as-joe";
function actingAsJoe(): boolean {
  try {
    return window.localStorage.getItem(ACT_AS_JOE_KEY) === "1";
  } catch {
    return false;
  }
}

function authHeader(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  if (actingAsJoe()) headers["X-Acting-As"] = "joe";
  return headers;
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
