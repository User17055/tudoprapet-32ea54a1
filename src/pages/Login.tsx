import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthField } from "@/components/auth/AuthField";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        // Ja vem traduzido do AuthContext — inclusive o caso de e-mail nao
        // confirmado, que nao pode virar "senha incorreta".
        toast.error(result.error ?? "Nao foi possivel entrar. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      backTo="/catalogo"
      backLabel="Catálogo"
      eyebrow="Bem-vindo de volta"
      title="Entrar na conta"
      panelTitle="Sua conta, simples de acompanhar."
      panelText="Pedidos, carrinho e histórico sempre por perto."
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link to="/cadastro" className="font-bold text-primary hover:underline">
            Criar agora
          </Link>
        </p>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border bg-background p-6 shadow-sm"
      >
        <AuthField
          id="email"
          label="Email"
          icon={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="seu@email.com"
        />

        <AuthField
          id="password"
          label="Senha"
          icon={Lock}
          revealable
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Digite sua senha"
          labelAction={
            <Link
              to="/esqueci-senha"
              className="text-xs font-bold text-primary hover:underline"
            >
              Esqueci minha senha
            </Link>
          }
        />

        <Button
          type="submit"
          disabled={loading}
          className="btn-bounce h-12 w-full rounded-xl font-display text-base font-bold"
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
      </form>
    </AuthLayout>
  );
};

export default Login;
