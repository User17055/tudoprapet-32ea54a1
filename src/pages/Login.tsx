import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { lovable } from '@/integrations/lovable';
import { ArrowLeft, Mail, Lock, Eye, EyeOff, ShieldCheck, Truck, Crown } from 'lucide-react';
import logo from '@/assets/logo.png';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        toast.success('Login realizado com sucesso!');
        navigate('/perfil');
      } else {
        toast.error(result.error || 'Email ou senha incorretos.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error('Erro ao entrar com Google. Tente novamente.');
      }
      if (result.redirected) {
        return;
      }
    } catch {
      toast.error('Erro ao entrar com Google. Tente novamente.');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar — sempre visível, com botão claro de voltar */}
      <div className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
        <div className="container mx-auto flex items-center justify-between py-3 px-4">
          <Link
            to="/catalogo"
            className="inline-flex items-center gap-2 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground text-foreground font-semibold px-4 py-2.5 text-sm transition-colors btn-bounce"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao catálogo
          </Link>
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="TudoPraPet" className="h-8 w-auto" />
            <span className="hidden sm:inline font-display font-900 text-lg text-foreground">
              Tudo<span className="text-primary">Pra</span>Pet
            </span>
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 md:py-12">
        <div className="grid lg:grid-cols-2 gap-8 items-center max-w-6xl mx-auto">
          {/* Lado esquerdo - benefícios (desktop) */}
          <div className="hidden lg:block space-y-6">
            <div>
              <span className="inline-flex items-center gap-2 bg-secondary/20 text-secondary-foreground font-semibold text-xs px-3 py-1.5 rounded-full">
                <Crown className="h-3.5 w-3.5" /> Bem-vindo de volta
              </span>
              <h2 className="font-display font-900 text-4xl text-foreground mt-4 leading-tight">
                Tudo o que seu pet precisa em<br />
                <span className="text-primary">um só lugar.</span>
              </h2>
              <p className="text-muted-foreground mt-3 text-base">
                Entre na sua conta para acompanhar pedidos, aproveitar preços exclusivos do Clube e receber tudo na sua porta.
              </p>
            </div>
            <ul className="space-y-4">
              <li className="flex gap-3 items-start">
                <div className="bg-primary/10 text-primary p-2 rounded-xl"><Crown className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-foreground">Preços de assinante</p>
                  <p className="text-sm text-muted-foreground">Descontos exclusivos em rações, petiscos e farmácia.</p>
                </div>
              </li>
              <li className="flex gap-3 items-start">
                <div className="bg-primary/10 text-primary p-2 rounded-xl"><Truck className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-foreground">Entrega rápida</p>
                  <p className="text-sm text-muted-foreground">Acompanhe seus pedidos em tempo real.</p>
                </div>
              </li>
              <li className="flex gap-3 items-start">
                <div className="bg-primary/10 text-primary p-2 rounded-xl"><ShieldCheck className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-foreground">Compra 100% segura</p>
                  <p className="text-sm text-muted-foreground">Seus dados sempre protegidos.</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Formulário */}
          <div className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
            <div className="text-center lg:text-left mb-6">
              <h1 className="font-display font-900 text-3xl md:text-4xl text-foreground">Entrar</h1>
              <p className="text-muted-foreground text-base mt-2">Acesse sua conta TudoPraPet</p>
            </div>

            <form onSubmit={handleSubmit} className="bg-card rounded-3xl shadow-xl border border-border p-6 md:p-8 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="seu@email.com"
                    className="w-full rounded-xl border-2 border-input bg-background pl-12 pr-4 py-4 text-base focus:outline-none focus:border-primary transition"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full rounded-xl border-2 border-input bg-background pl-12 pr-12 py-4 text-base focus:outline-none focus:border-primary transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-primary"
                    aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <div className="text-right">
                  <Link to="/esqueci-senha" className="text-sm font-bold text-primary hover:underline">
                    Esqueci minha senha
                  </Link>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl font-display font-bold text-base py-6 btn-bounce shadow-md"
              >
                {loading ? 'Entrando...' : 'Entrar na minha conta'}
              </Button>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                <ShieldCheck className="h-4 w-4 text-pet-green" />
                Conexão segura e criptografada
              </div>
            </form>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                Não tem conta?{' '}
                <Link to="/cadastro" className="text-primary font-bold hover:underline">
                  Criar conta grátis
                </Link>
              </p>
              <Link
                to="/catalogo"
                className="lg:hidden inline-flex items-center justify-center gap-2 w-full rounded-xl border-2 border-primary text-primary font-bold py-3 hover:bg-primary hover:text-primary-foreground transition"
              >
                <ArrowLeft className="h-4 w-4" /> Continuar comprando sem login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
