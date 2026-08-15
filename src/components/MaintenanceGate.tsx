import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Clock3, Loader2, LogIn, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import logo from "@/assets/tpp-logo.svg";

function formatRemaining(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}min`
    : `${minutes}min ${String(seconds).padStart(2, "0")}s`;
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
  if (!maintenance.active || isAdmin || location.pathname === "/login") return children;

  const leaveAccount = async () => {
    await logout();
    window.location.assign("/login");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b2854] px-4 py-10 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(241,197,72,0.2),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.1),transparent_35%)]" />
      <section className="relative w-full max-w-xl rounded-3xl border border-white/15 bg-white/10 p-7 text-center shadow-2xl backdrop-blur-sm sm:p-10">
        <div className="mx-auto mb-7 flex w-fit rounded-2xl bg-white px-5 py-3 shadow-lg">
          <img src={logo} alt="TudoPraPet" className="h-auto w-52 sm:w-60" />
        </div>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f1c548] text-[#0a1931] shadow-lg">
          <Wrench className="h-8 w-8" />
        </span>
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">Site em manutenção</h1>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-white/75">
          Estamos fazendo alguns ajustes para deixar sua experiência ainda melhor. Voltaremos em breve.
        </p>
        <div className="mx-auto mt-7 flex w-fit items-center gap-3 rounded-2xl border border-white/15 bg-black/15 px-5 py-3">
          <Clock3 className="h-5 w-5 text-[#f1c548]" />
          <div className="text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/55">Tempo restante</p>
            <p className="font-mono text-lg font-bold">{formatRemaining(maintenance.remainingSeconds)}</p>
          </div>
        </div>
        <div className="mt-8">
          {user ? (
            <Button onClick={leaveAccount} variant="secondary" className="gap-2 bg-white text-[#112f5f] hover:bg-white/90">
              <LogIn className="h-4 w-4" />
              Entrar com outra conta
            </Button>
          ) : (
            <Button asChild variant="secondary" className="gap-2 bg-white text-[#112f5f] hover:bg-white/90">
              <Link to="/login"><ShieldCheck className="h-4 w-4" /> Acesso do administrador</Link>
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
