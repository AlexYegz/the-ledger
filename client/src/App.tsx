import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import WorkspacePage from "@/pages/workspace";
import StatusPage from "@/pages/status";
import AnswerPage from "@/pages/answer";

function HomeRedirect() {
  const { me, isLoading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (isLoading) return;
    if (!me.role) navigate("/login");
    else if (me.role === "principal") navigate("/answer");
    else navigate("/workspace");
  }, [me, isLoading, navigate]);
  return null;
}

function ProtectedRoute({
  children,
  needs,
}: {
  children: React.ReactNode;
  needs?: "principal" | "team";
}) {
  const { me, isLoading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (isLoading) return;
    if (!me.role) navigate("/login");
    else if (needs && me.role !== needs) {
      navigate(me.role === "principal" ? "/answer" : "/workspace");
    }
  }, [me, isLoading, needs, navigate]);
  if (isLoading || !me.role) return null;
  if (needs && me.role !== needs) return null;
  return <>{children}</>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/login" component={LoginPage} />
      <Route path="/answer">
        <ProtectedRoute needs="principal">
          <AnswerPage />
        </ProtectedRoute>
      </Route>
      <Route path="/status">
        <ProtectedRoute needs="principal">
          <StatusPage />
        </ProtectedRoute>
      </Route>
      <Route path="/workspace">
        <ProtectedRoute needs="team">
          <WorkspacePage />
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
