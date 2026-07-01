import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  ShoppingBag,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await login(email.trim(), password);
      if (result.success) {
        toast.success("Login realizado com sucesso.");
        navigate("/perfil");
      } else {
        toast.error(result.error || "Email ou senha incorretos.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <Button asChild variant="ghost" className="rounded-full gap-2 btn-bounce">
            <Link to="/catalogo">
              <ArrowLeft className="h-4 w-4" />
              Catálogo
            </Link>
          </Button>

          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="TudoPraPet" className="h-8 w-auto" />
            <span className="font-display text-lg font-900 text-foreground">
              Tudo<span className="text-primary">Pra</span>Pet
            </span>
          </Link>
        </div>
      </header>

      <main className="container mx-auto grid min-h-[calc(100vh-65px)] max-w-6xl items-center gap-8 px-4 py-6 lg:grid-cols-[1fr_440px] lg:py-10">
        <section className="paw-pattern hidden lg:block">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
              <ShieldCheck className="h-4 w-4" />
              Área segura do cliente
            </span>

            <h1 className="mt-5 font-display text-5xl font-900 leading-tight text-foreground">
              Sua conta TudoPraPet, simples de acompanhar.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
              Entre para ver pedidos, continuar comprando mais rápido e acessar
              benefícios do Clube quando estiver disponível para sua conta.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                {
                  icon: ShoppingBag,
                  title: "Compras mais rápidas",
                  text: "Seu carrinho e histórico ficam sempre por perto.",
                },
                {
                  icon: ShieldCheck,
                  title: "Acesso protegido",
                  text: "Login seguro com sua conta cadastrada.",
                },
                {
                  icon: UserPlus,
                  title: "Conta grátis",
                  text: "Crie uma conta em poucos passos se ainda não tiver.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex gap-3 rounded-xl border border-border bg-background p-4 shadow-sm"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-sm font-bold text-foreground">
                      {item.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {item.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="mb-5">
            <p className="text-sm font-bold text-primary">Bem-vindo de volta</p>
            <h2 className="mt-1 font-display text-3xl font-900 text-foreground">
              Entrar na conta
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Use seu email e senha para acessar seu perfil.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-bold text-foreground">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="seu@email.com"
                    className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="password"
                    className="text-sm font-bold text-foreground"
                  >
                    Senha
                  </label>
                  <Link
                    to="/esqueci-senha"
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    Esqueci minha senha
                  </Link>
                </div>

                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Digite sua senha"
                    className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-12 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-primary"
                    aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl font-display text-base font-bold btn-bounce"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            <div className="mt-5 rounded-xl bg-muted/50 p-3 text-center text-xs text-muted-foreground">
              <ShieldCheck className="mr-1 inline h-4 w-4 text-pet-green" />
              Seus dados são usados apenas para acessar sua conta e pedidos.
            </div>
          </form>

          <div className="mt-4 grid gap-3">
            <Button asChild variant="outline" className="h-12 rounded-xl btn-bounce">
              <Link to="/cadastro">
                <UserPlus className="mr-2 h-4 w-4" />
                Criar minha conta
              </Link>
            </Button>
            <Button asChild variant="ghost" className="h-11 rounded-xl lg:hidden">
              <Link to="/catalogo">Continuar comprando sem login</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
