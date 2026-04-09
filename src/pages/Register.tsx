import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import logo from '@/assets/logo.png';

const Register = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

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
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link to="/">
            <img src={logo} alt="TudoPraPet" className="h-16 mx-auto mb-4" />
          </Link>
          <h1 className="font-display font-900 text-2xl text-foreground">Criar sua conta</h1>
          <p className="text-muted-foreground text-sm mt-1">Cadastre-se e aproveite ofertas exclusivas</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-2xl shadow-lg border border-border p-8 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Nome</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                placeholder="João"
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Sobrenome</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                required
                placeholder="Silva"
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="seu@email.com"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Mínimo 6 caracteres"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-xl font-display font-bold text-base py-6 btn-bounce">
            {loading ? 'Criando conta...' : 'Criar conta'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{' '}
          <Link to="/login" className="text-primary font-semibold hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
