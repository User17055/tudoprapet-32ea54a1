import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthField } from '@/components/auth/AuthField';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      backTo="/login"
      backLabel="Login"
      title={sent ? 'E-mail enviado' : 'Recuperar senha'}
      subtitle={
        sent
          ? undefined
          : 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'
      }
      panelTitle="Acontece com todo mundo."
      panelText="Em um minuto você volta a acessar sua conta."
      footer={
        !sent && (
          <p className="text-center text-sm text-muted-foreground">
            Lembrou da senha?{' '}
            <Link to="/login" className="font-bold text-primary hover:underline">
              Fazer login
            </Link>
          </p>
        )
      }
    >
      {sent ? (
        <div className="space-y-4 rounded-2xl border border-border bg-background p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-pet-green/10">
            <CheckCircle2 className="h-7 w-7 text-pet-green" />
          </div>
          <p className="font-bold text-foreground">Enviamos para {email}</p>
          <p className="text-sm text-muted-foreground">
            Clique no link recebido para criar uma nova senha. Confira também a pasta de spam.
          </p>
          <Button asChild variant="outline" className="btn-bounce h-12 w-full rounded-xl">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border bg-background p-6 shadow-sm"
        >
          <AuthField
            id="email"
            label="E-mail cadastrado"
            icon={Mail}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="seu@email.com"
          />

          <Button
            type="submit"
            disabled={loading}
            className="btn-bounce h-12 w-full rounded-xl font-display text-base font-bold"
          >
            {loading ? 'Enviando...' : 'Enviar link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;
