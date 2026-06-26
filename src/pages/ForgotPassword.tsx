import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Mail, ShieldCheck, CheckCircle2 } from 'lucide-react';
import logo from '@/assets/logo.png';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const siteUrl = (import.meta.env.VITE_SITE_URL || window.location.origin).replace(/\/$/, '');

      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${siteUrl}/redefinir-senha`,
      });
      if (error) {
        toast.error(error.message || 'Não foi possível enviar o e-mail.');
      } else {
        setSent(true);
        toast.success('E-mail de recuperação enviado!');
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
            Voltar ao login
          </Link>
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="TudoPraPet" className="h-8 w-auto" />
            <span className="hidden sm:inline font-display font-900 text-lg text-foreground">
              Tudo<span className="text-primary">Pra</span>Pet
            </span>
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 md:py-16">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-6">
            <h1 className="font-display font-900 text-3xl md:text-4xl text-foreground">Recuperar senha</h1>
            <p className="text-muted-foreground text-base mt-2">
              {sent
                ? 'Confira sua caixa de entrada para continuar.'
                : 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'}
            </p>
          </div>

          {sent ? (
            <div className="bg-card rounded-3xl shadow-xl border border-border p-6 md:p-8 text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-pet-green/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-pet-green" />
              </div>
              <p className="text-foreground font-bold">E-mail enviado para {email}</p>
              <p className="text-sm text-muted-foreground">
                Clique no link recebido para redefinir sua senha. Não esqueça de conferir a pasta de spam.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 w-full rounded-xl border-2 border-primary text-primary font-bold py-3 hover:bg-primary hover:text-primary-foreground transition"
              >
                Voltar para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-card rounded-3xl shadow-xl border border-border p-6 md:p-8 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">E-mail cadastrado</label>
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

              <Button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl font-display font-bold text-base py-6 btn-bounce shadow-md"
              >
                {loading ? 'Enviando...' : 'Enviar link de recuperação'}
              </Button>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                <ShieldCheck className="h-4 w-4 text-pet-green" />
                Link seguro enviado para seu e-mail
              </div>
            </form>
          )}

          <p className="text-sm text-muted-foreground text-center mt-6">
            Lembrou da senha?{' '}
            <Link to="/login" className="text-primary font-bold hover:underline">
              Fazer login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
