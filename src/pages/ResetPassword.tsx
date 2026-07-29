import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import logo from '@/assets/tpp-logo.svg';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase coloca a sessão de recovery via onAuthStateChange (event=PASSWORD_RECOVERY)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message || 'Não foi possível atualizar a senha.');
      } else {
        toast.success('Senha atualizada com sucesso!');
        navigate('/perfil');
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
            to="/login"
            className="inline-flex items-center gap-2 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground text-foreground font-semibold px-4 py-2.5 text-sm transition-colors btn-bounce"
          >
            <ArrowLeft className="h-4 w-4" />
            Ir para o login
          </Link>
          <Link to="/" className="flex items-center">
            <img src={logo} alt="TudoPraPet" className="h-auto w-36 sm:w-44" />
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 md:py-16">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-6">
            <h1 className="font-display font-900 text-3xl md:text-4xl text-foreground">Nova senha</h1>
            <p className="text-muted-foreground text-base mt-2">
              {ready
                ? 'Defina uma nova senha para a sua conta.'
                : 'Validando seu link de recuperação...'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-card rounded-3xl shadow-xl border border-border p-6 md:p-8 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-bold text-foreground">Nova senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
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

            <div className="space-y-2">
              <label className="text-sm font-bold text-foreground">Confirmar nova senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Repita a nova senha"
                  className="w-full rounded-xl border-2 border-input bg-background pl-12 pr-4 py-4 text-base focus:outline-none focus:border-primary transition"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading || !ready}
              className="w-full rounded-xl font-display font-bold text-base py-6 btn-bounce shadow-md"
            >
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </Button>

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
              <ShieldCheck className="h-4 w-4 text-pet-green" />
              Sua senha é criptografada com segurança
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
