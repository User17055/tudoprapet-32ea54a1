import { Instagram, Mail, MessageCircle } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";

const WHATSAPP_URL = "https://wa.me/5518996642021";
const INSTAGRAM_URL = "https://www.instagram.com/tudoprapet_/";
const CONTACT_EMAIL = "sac@tudoprapet.com.br";
const CNPJ = "64.017.410/0001-28";

export const Footer = () => {
  const [email, setEmail] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      toast.success("Inscrito com sucesso! 🎉", {
        description: "Você receberá nossas ofertas exclusivas por e-mail.",
        position: "top-center",
      });
      setEmail("");
    }
  };

  return (
    <footer className="bg-foreground text-background">
      {/* Newsletter */}
      <div className="bg-primary text-primary-foreground py-10">
        <div className="container mx-auto text-center space-y-4">
          <h3 className="font-display font-800 text-2xl">Fique por dentro das novidades!</h3>
          <p className="text-sm opacity-90">Cadastre seu e-mail e receba ofertas exclusivas</p>
          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <label htmlFor="footer-newsletter-email" className="sr-only">
              Seu e-mail
            </label>
            <input
              id="footer-newsletter-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className="flex-1 rounded-full px-5 py-3 text-foreground bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <Button type="submit" variant="secondary" className="rounded-full font-display font-bold btn-bounce">
              Inscrever-se
            </Button>
          </form>
        </div>
      </div>

      {/* Footer links */}
      <div className="container mx-auto py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1 space-y-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="TudoPraPet" className="h-7 w-auto" />
            <span className="font-display font-bold text-lg">TudoPraPet</span>
          </div>
          <p className="text-sm opacity-70">O melhor para o seu pet com o menor preço.</p>
          <p className="text-xs opacity-50">CNPJ {CNPJ}</p>
        </div>
        <div className="space-y-3">
          <h4 className="font-display font-bold text-sm">
            Navegue
            <span className="block w-6 h-[3px] rounded-full bg-secondary mt-1.5" />
          </h4>
          <ul className="space-y-2 text-sm opacity-70">
            <li>
              <Link to="/catalogo" className="hover:text-primary transition-colors">
                Catálogo
              </Link>
            </li>
            <li>
              <Link to="/catalogo?categoria=racoes" className="hover:text-primary transition-colors">
                Rações
              </Link>
            </li>
            <li>
              <Link to="/catalogo?categoria=farmacia" className="hover:text-primary transition-colors">
                Farmácia
              </Link>
            </li>
            <li>
              <Link to="/clube" className="hover:text-primary transition-colors">
                Clube
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-3">
          <h4 className="font-display font-bold text-sm">
            Minha Conta
            <span className="block w-6 h-[3px] rounded-full bg-secondary mt-1.5" />
          </h4>
          <ul className="space-y-2 text-sm opacity-70">
            <li>
              <Link to="/login" className="hover:text-primary transition-colors">
                Entrar / Cadastrar
              </Link>
            </li>
            <li>
              <Link to="/meus-pedidos" className="hover:text-primary transition-colors">
                Meus Pedidos
              </Link>
            </li>
            <li>
              <Link to="/carrinho" className="hover:text-primary transition-colors">
                Meu Carrinho
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-3">
          <h4 className="font-display font-bold text-sm">
            Atendimento
            <span className="block w-6 h-[3px] rounded-full bg-secondary mt-1.5" />
          </h4>
          <ul className="space-y-2 text-sm opacity-70">
            <li>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                (18) 99664-2021
              </a>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-primary transition-colors">
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
          <div className="flex gap-3 pt-1">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="hover-lift p-2.5 rounded-full bg-background/10 border border-background/10 hover:bg-secondary hover:border-secondary hover:text-secondary-foreground transition-colors"
            >
              <MessageCircle className="h-5 w-5" />
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="hover-lift p-2.5 rounded-full bg-background/10 border border-background/10 hover:bg-secondary hover:border-secondary hover:text-secondary-foreground transition-colors"
            >
              <Instagram className="h-5 w-5" />
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              aria-label="E-mail"
              className="hover-lift p-2.5 rounded-full bg-background/10 border border-background/10 hover:bg-secondary hover:border-secondary hover:text-secondary-foreground transition-colors"
            >
              <Mail className="h-5 w-5" />
            </a>
          </div>
          <div className="text-xs opacity-50 pt-2">💳 Visa • Mastercard • Pix • Boleto</div>
        </div>
      </div>

      <div className="border-t border-background/10 py-4 text-center text-xs opacity-50">
        © {new Date().getFullYear()} TudoPraPet. Todos os direitos reservados.
      </div>
    </footer>
  );
};
