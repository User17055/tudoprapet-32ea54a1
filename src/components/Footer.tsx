import { Instagram, Mail, MessageCircle } from "lucide-react";
import logo from "@/assets/logo.png";
import { Link } from "react-router-dom";

const WHATSAPP_URL = "https://wa.me/5518996642021";
const INSTAGRAM_URL = "https://www.instagram.com/tudoprapet_/";
const CONTACT_EMAIL = "sac@tudoprapet.com.br";
const CNPJ = "64.017.410/0001-28";

const footerColumns = [
  {
    title: "Sobre",
    links: [
      { label: "Quem somos", to: "/" },
      { label: "Nossas lojas", to: "/" },
      { label: "Trabalhe com a gente", to: "/" },
      { label: "Mapa do Site", to: "/catalogo" },
    ],
  },
  {
    title: "Acesse",
    links: [
      { label: "Meu Cadastro", to: "/perfil" },
      { label: "Meus Pedidos", to: "/meus-pedidos" },
      { label: "Meu Carrinho", to: "/carrinho" },
    ],
  },
  {
    title: "Pra voce",
    links: [
      { label: "Clube", to: "/clube" },
      { label: "Promocoes", to: "/catalogo" },
      { label: "Catalogo", to: "/catalogo" },
      { label: "Recompra", to: "/meus-pedidos" },
    ],
  },
  {
    title: "Servicos",
    links: [
      { label: "Entrega", to: "/catalogo" },
      { label: "Retire e Troque", to: "/" },
      { label: "Atendimento", href: WHATSAPP_URL },
      { label: "TudoPraPet", to: "/" },
    ],
  },
  {
    title: "Precisa de ajuda?",
    links: [
      { label: "Fale com a gente", href: WHATSAPP_URL },
      { label: "Trocas e devolucoes", to: "/" },
      { label: "Canal de Denuncias", to: "/" },
      { label: "Como Comprar", to: "/catalogo" },
      { label: "Ouvidoria", href: `mailto:${CONTACT_EMAIL}` },
    ],
  },
  {
    title: "Politicas",
    links: [
      { label: "Entrega", to: "/" },
      { label: "Frete gratis", to: "/" },
      { label: "Pagamentos e reembolsos", to: "/" },
      { label: "Privacidade", to: "/" },
    ],
  },
];

const FooterLink = ({ link }: { link: { label: string; to?: string; href?: string } }) => {
  if (link.href) {
    return (
      <a
        href={link.href}
        target={link.href.startsWith("http") ? "_blank" : undefined}
        rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
        className="text-[12px] leading-7 text-[#68707c] transition-colors hover:text-primary"
      >
        {link.label}
      </a>
    );
  }

  return (
    <Link
      to={link.to || "/"}
      className="text-[12px] leading-7 text-[#68707c] transition-colors hover:text-primary"
    >
      {link.label}
    </Link>
  );
};

export const Footer = () => {
  return (
    <footer className="hidden border-t border-[#eeeeee] bg-white text-[#252a32] md:block">
      <div className="container mx-auto py-10">
        <div className="grid grid-cols-6 gap-10">
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h4 className="mb-2 text-[13px] font-bold text-[#252a32]">{column.title}</h4>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-[#eeeeee] pt-5">
          <div className="text-xs text-[#68707c]">
            CNPJ {CNPJ} - © {new Date().getFullYear()} TudoPraPet. Todos os direitos reservados.
          </div>
          <div className="flex items-center gap-3 text-[#68707c]">
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="transition-colors hover:text-primary">
              <MessageCircle className="h-5 w-5" />
            </a>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="transition-colors hover:text-primary">
              <Instagram className="h-5 w-5" />
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`} aria-label="E-mail" className="transition-colors hover:text-primary">
              <Mail className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
