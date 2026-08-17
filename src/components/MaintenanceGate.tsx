import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Clock3, Loader2, LogIn, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import logo from "@/assets/tpp-logo.svg";

function formatRemaining(totalSeconds: number) {
  const minutes = Math.ceil(totalSeconds / 60);
  return `${minutes}min`;
}

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, loading: authLoading, logout } = useAuth();
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const maintenance = useMaintenanceMode();

  if (maintenance.loading || authLoading || (user && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Carregando" />
      </div>
    );
  }

  // O login precisa continuar acessivel para um administrador entrar durante o bloqueio.
  // O consentimento OAuth tambem: e o fluxo de conexao dos clientes MCP.
  if (
    !maintenance.active ||
    isAdmin ||
    location.pathname === "/login" ||
    location.pathname === "/.lovable/oauth/consent"
  ) return children;


  const leaveAccount = async () => {
    await logout();
    window.location.assign("/login");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4 py-10 text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(201,148,61,0.12),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(30,58,110,0.06),transparent_35%)]" />
      <section className="relative w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-2xl sm:p-10">
        <div className="mx-auto mb-7 flex w-fit rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-lg">
          <img src={logo} alt="TudoPraPet" className="h-auto w-52 sm:w-60" />
        </div>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f1c548] text-[#0a1931] shadow-lg">
          <Wrench className="h-8 w-8" />
        </span>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-[#c9943d]">Aviso importante</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Site em manutenção</h1>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-slate-600">
          Estamos fazendo alguns ajustes para deixar sua experiência ainda melhor. Voltaremos em breve.
        </p>
        <div className="mx-auto mt-7 flex w-fit items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3">
          <Clock3 className="h-5 w-5 text-[#c9943d]" />
          <div className="text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tempo restante</p>
            <p className="font-mono text-lg font-bold text-slate-900">{formatRemaining(maintenance.remainingSeconds)}</p>
          </div>
        </div>
        <div className="mt-8">
          {user ? (
            <Button onClick={leaveAccount} variant="secondary" className="gap-2 bg-[#1e3a6e] text-white hover:bg-[#1e3a6e]/90">
              <LogIn className="h-4 w-4" />
              Entrar com outra conta
            </Button>
          ) : (
            <Button asChild variant="secondary" className="gap-2 bg-[#1e3a6e] text-white hover:bg-[#1e3a6e]/90">
              <Link to="/login"><ShieldCheck className="h-4 w-4" /> Acesso do administrador</Link>
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
