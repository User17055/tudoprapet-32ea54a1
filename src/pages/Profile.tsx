import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useShopifyAuth } from '@/contexts/ShopifyAuthContext';
import { toast } from 'sonner';
import { LogOut, User } from 'lucide-react';
import logo from '@/assets/logo.png';

const Profile = () => {
  const { customer, loading, logout } = useShopifyAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!customer) {
    navigate('/login');
    return null;
  }

  const handleLogout = async () => {
    await logout();
    toast.success('Até logo! 👋');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link to="/">
            <img src={logo} alt="TudoPraPet" className="h-16 mx-auto mb-4" />
          </Link>
          <h1 className="font-display font-900 text-2xl text-foreground">Meu Perfil</h1>
        </div>

        <div className="bg-card rounded-2xl shadow-lg border border-border p-8 space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-display font-bold text-lg text-foreground">
                {customer.firstName} {customer.lastName}
              </p>
              <p className="text-sm text-muted-foreground">{customer.email}</p>
            </div>
          </div>

          {customer.phone && (
            <div className="text-sm text-muted-foreground">
              📞 {customer.phone}
            </div>
          )}

          <Button onClick={handleLogout} variant="outline" className="w-full rounded-xl gap-2">
            <LogOut className="h-4 w-4" />
            Sair da conta
          </Button>
        </div>

        <div className="text-center">
          <Link to="/" className="text-sm text-primary font-semibold hover:underline">
            ← Voltar à loja
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Profile;
