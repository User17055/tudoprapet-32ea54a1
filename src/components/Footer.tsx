import { Instagram, Facebook, Mail } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export const Footer = () => {
  const [email, setEmail] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      toast.success("Inscrito com sucesso! 🎉", {
        description: "Você receberá seu cupom de 10% por e-mail.",
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
          <h3 className="font-display font-800 text-2xl">Ganhe 10% de desconto na primeira compra!</h3>
          <p className="text-sm opacity-90">Cadastre seu e-mail e receba ofertas exclusivas</p>
          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className="flex-1 rounded-full px-5 py-3 text-foreground bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <Button type="submit" variant="secondary" className="rounded-full font-display font-bold btn-bounce">
              Quero meu desconto
            </Button>
          </form>
        </div>
      </div>

      {/* Footer links */}
      <div className="container mx-auto py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1 space-y-3">
          <div className="flex items-center gap-2">
            <PawPrint className="h-6 w-6 text-primary" />
            <span className="font-display font-bold text-lg">TudoPraPet</span>
          </div>
          <p className="text-sm opacity-70">O melhor para o seu pet com o menor preço.</p>
        </div>
        <div className="space-y-3">
          <h4 className="font-display font-bold text-sm">Institucional</h4>
          <ul className="space-y-2 text-sm opacity-70">
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Sobre nós
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Rastrear Pedido
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Trocas e Devoluções
              </a>
            </li>
          </ul>
        </div>
        <div className="space-y-3">
          <h4 className="font-display font-bold text-sm">Atendimento</h4>
          <ul className="space-y-2 text-sm opacity-70">
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                FAQ
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Contato
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Política de Privacidade
              </a>
            </li>
          </ul>
        </div>
        <div className="space-y-3">
          <h4 className="font-display font-bold text-sm">Redes Sociais</h4>
          <div className="flex gap-3">
            <a href="#" className="p-2 rounded-full bg-background/10 hover:bg-primary transition-colors">
              <Instagram className="h-5 w-5" />
            </a>
            <a href="#" className="p-2 rounded-full bg-background/10 hover:bg-primary transition-colors">
              <Facebook className="h-5 w-5" />
            </a>
            <a href="#" className="p-2 rounded-full bg-background/10 hover:bg-primary transition-colors">
              <Mail className="h-5 w-5" />
            </a>
          </div>
          <div className="text-xs opacity-50 pt-2">💳 Visa • Mastercard • Pix • Boleto</div>
        </div>
      </div>

      <div className="border-t border-background/10 py-4 text-center text-xs opacity-50">
        © 2026 TudoPraPet. Todos os direitos reservados.
      </div>
    </footer>
  );
};
