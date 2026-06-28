import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { ArrowLeft, Mail, Lock, User as UserIcon, Eye, EyeOff, ShieldCheck, Gift, Crown } from 'lucide-react';
import logo from '@/assets/logo.png';
import { lovable } from '@/integrations/lovable/index';
import { isInAppBrowser, openInExternalBrowser } from '@/lib/webview';

const Register = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    if (isInAppBrowser()) {
      toast.info('Abrindo no navegador externo para login com Google…');
      openInExternalBrowser(window.location.origin + '/cadastro');
      return;
    }
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message || 'Erro ao entrar com Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    setLoading(true);
    try {
      const result = await register({ firstName, lastName, email, password });
      if (result.success) {
        toast.success('Conta criada com sucesso! 🎉');
        navigate('/perfil');
      } else {
        toast.error(result.error || 'Erro ao criar conta.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
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
          <div className="hidden lg:block space-y-6">
            <div>
              <span className="inline-flex items-center gap-2 bg-secondary/20 text-secondary-foreground font-semibold text-xs px-3 py-1.5 rounded-full">
                <Gift className="h-3.5 w-3.5" /> Crie sua conta grátis
              </span>
              <h2 className="font-display font-900 text-4xl text-foreground mt-4 leading-tight">
                Cuide melhor do seu pet com<br />
                <span className="text-primary">vantagens exclusivas.</span>
              </h2>
              <p className="text-muted-foreground mt-3 text-base">
                Cadastre-se em segundos e desbloqueie ofertas, agilize compras futuras e acompanhe seus pedidos.
              </p>
            </div>
            <ul className="space-y-4">
              <li className="flex gap-3 items-start">
                <div className="bg-primary/10 text-primary p-2 rounded-xl"><Crown className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-foreground">Acesso ao Clube</p>
                  <p className="text-sm text-muted-foreground">Preços de assinante em produtos selecionados.</p>
                </div>
              </li>
              <li className="flex gap-3 items-start">
                <div className="bg-primary/10 text-primary p-2 rounded-xl"><Gift className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-foreground">Ofertas personalizadas</p>
                  <p className="text-sm text-muted-foreground">Promoções pensadas para o seu pet.</p>
                </div>
              </li>
              <li className="flex gap-3 items-start">
                <div className="bg-primary/10 text-primary p-2 rounded-xl"><ShieldCheck className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-foreground">Histórico de pedidos</p>
                  <p className="text-sm text-muted-foreground">Recompre seus favoritos com 1 clique.</p>
                </div>
              </li>
            </ul>
          </div>

          <div className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
            <div className="text-center lg:text-left mb-6">
              <h1 className="font-display font-900 text-3xl md:text-4xl text-foreground">Criar conta</h1>
              <p className="text-muted-foreground text-base mt-2">É rápido e gratuito 🐾</p>
            </div>

            <form onSubmit={handleSubmit} className="bg-card rounded-3xl shadow-xl border border-border p-6 md:p-8 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">Nome</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      required
                      placeholder="João"
                      className="w-full rounded-xl border-2 border-input bg-background pl-10 pr-3 py-4 text-base focus:outline-none focus:border-primary transition"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">Sobrenome</label>
                  <input
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    required
                    placeholder="Silva"
                    className="w-full rounded-xl border-2 border-input bg-background px-3 py-4 text-base focus:outline-none focus:border-primary transition"
                  />
                </div>
              </div>

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
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="Mínimo 6 caracteres"
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
              </div>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground font-medium">ou</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-input bg-white hover:bg-gray-50 text-foreground font-bold py-3.5 transition disabled:opacity-60"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Entrar com Google
              </button>

              <Button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl font-display font-bold text-base py-6 btn-bounce shadow-md"
              >
                {loading ? 'Criando conta...' : 'Criar minha conta'}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Ao criar conta você aceita nossos termos e política de privacidade.
              </p>
            </form>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                Já tem conta?{' '}
                <Link to="/login" className="text-primary font-bold hover:underline">
                  Entrar
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

export default Register;
