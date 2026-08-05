import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthField } from '@/components/auth/AuthField';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    <AuthLayout
      backTo="/login"
      backLabel="Login"
      title="Nova senha"
      subtitle={
        ready
          ? 'Defina uma nova senha para a sua conta.'
          : 'Validando seu link de recuperação...'
      }
      panelTitle="Quase lá."
      panelText="Escolha uma senha que só você saiba."
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border bg-background p-6 shadow-sm"
      >
        <AuthField
          id="password"
          label="Nova senha"
          icon={Lock}
          revealable
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          placeholder="Mínimo 6 caracteres"
        />

        <AuthField
          id="confirm"
          label="Confirmar nova senha"
          icon={Lock}
          revealable
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
          placeholder="Repita a nova senha"
        />

        <Button
          type="submit"
          disabled={loading || !ready}
          className="btn-bounce h-12 w-full rounded-xl font-display text-base font-bold"
        >
          {loading ? 'Salvando...' : 'Salvar nova senha'}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;
