import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import logo from "@/assets/tpp-logo.svg";

function MaintenanceCountdown({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const endTime = endsAt ? new Date(endsAt).getTime() : now;
  const remaining = Math.max(0, endTime - now);
  const units = [
    { label: "dias", value: Math.floor(remaining / 86_400_000) },
    { label: "horas", value: Math.floor((remaining % 86_400_000) / 3_600_000) },
    { label: "min", value: Math.floor((remaining % 3_600_000) / 60_000) },
    { label: "seg", value: Math.floor((remaining % 60_000) / 1_000) },
  ];

  return (
    <div className="mt-8">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Tempo restante</p>
      <div
        className="mx-auto mt-4 flex max-w-lg items-start justify-center gap-4 sm:gap-8"
        aria-label="Tempo restante para o fim da manutenção"
      >
        {units.map((unit, index) => (
          <div key={unit.label} className="relative min-w-0 flex-1 text-[#112f5f]">
            <p className="font-mono text-2xl font-extrabold tabular-nums sm:text-3xl">
              {String(unit.value).padStart(2, "0")}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {unit.label}
            </p>
            {index < units.length - 1 && (
              <span className="absolute -right-2 top-0 text-xl font-bold text-[#f1c548] sm:-right-4 sm:text-2xl">
                :
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
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

  // O login e o consentimento OAuth continuam acessíveis durante o bloqueio.
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
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-10 text-[#0a1931]">
      <section className="w-full max-w-2xl text-center">
        <img src={logo} alt="TudoPraPet" className="mx-auto h-auto w-52 sm:w-64" />

        <div className="mt-10 bg-white sm:px-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0a1931] sm:text-5xl">
            Site em manutenção
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-600">
            Estamos fazendo alguns ajustes para deixar sua experiência ainda melhor. Voltaremos em breve.
          </p>

          <MaintenanceCountdown endsAt={maintenance.endsAt} />

          <p className="mt-4 text-sm text-slate-500">
            A liberação acontece automaticamente ao final do prazo.
          </p>

          <div className="mt-8">
            {user ? (
              <Button onClick={leaveAccount} className="gap-2 bg-[#112f5f] text-white hover:bg-[#0a1931]">
                <LogIn className="h-4 w-4" />
                Entrar com outra conta
              </Button>
            ) : (
              <Button asChild className="gap-2 bg-[#112f5f] text-white hover:bg-[#0a1931]">
                <Link to="/login"><ShieldCheck className="h-4 w-4" /> Acesso do administrador</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
