import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/tpp-logo.svg";

interface AuthLayoutProps {
  /** Para onde o botão de voltar leva. */
  backTo: string;
  backLabel: string;
  /** Linha curta acima do título, em dourado escuro. Opcional. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Frase única do painel navy. Some abaixo de lg. */
  panelTitle: string;
  panelText?: string;
  children: ReactNode;
  /** Conteúdo secundário abaixo do formulário (links, ações alternativas). */
  footer?: ReactNode;
}

/**
 * Shell das quatro telas de autenticação.
 *
 * Antes cada página repetia o próprio cabeçalho e divergia em borda de input,
 * raio, sombra e anel de foco. Aqui a estrutura é uma só.
 *
 * Proporção de cor 60-30-10: fundo neutro quente, painel navy, e o dourado
 * reservado ao filete do painel e ao eyebrow — um acento por tela, não mais.
 */
export const AuthLayout = ({
  backTo,
  backLabel,
  eyebrow,
  title,
  subtitle,
  panelTitle,
  panelText,
  children,
  footer,
}: AuthLayoutProps) => {
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <Link
            to={backTo}
            className="btn-bounce inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>

          <Link to="/" className="flex items-center" aria-label="TudoPraPet — início">
            <img src={logo} alt="TudoPraPet" className="h-auto w-32 sm:w-40" />
          </Link>
        </div>
      </header>

      <main className="container mx-auto grid max-w-6xl items-stretch gap-8 px-4 py-8 lg:grid-cols-[1fr_minmax(380px,440px)] lg:py-14">
        {/* Painel da marca. Nada essencial vive aqui, por isso pode sumir no
            mobile — mas o texto tem significado e não é escondido de leitores
            de tela; só os elementos puramente decorativos são aria-hidden. */}
        <section className="relative hidden overflow-hidden rounded-3xl bg-primary p-10 lg:flex lg:flex-col lg:justify-between">
          {/* alt vazio: o logo já é anunciado no cabeçalho, aqui é repetição. */}
          <img src={logo} alt="" className="h-auto w-40 brightness-0 invert" />

          <div>
            {/* O filete dourado: o "10%" da proporção. Como superfície, não texto. */}
            <span className="mb-6 block h-1.5 w-16 rounded-full bg-secondary" />
            <p className="font-display text-4xl font-900 leading-tight text-primary-foreground">
              {panelTitle}
            </p>
            {panelText && (
              <p className="mt-4 max-w-sm text-base leading-relaxed text-primary-foreground/70">
                {panelText}
              </p>
            )}
          </div>

          {/* Patinhas em dourado bem baixo, textura e não elemento. */}
          <div
            className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-secondary/10"
            aria-hidden="true"
          />
        </section>

        <section className="mx-auto flex w-full max-w-md flex-col justify-center">
          <div className="mb-6">
            {eyebrow && (
              <p className="text-sm font-bold uppercase tracking-wide text-pet-gold-deep">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-1 font-display text-3xl font-900 text-foreground">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          </div>

          {children}

          {footer && <div className="mt-5">{footer}</div>}
        </section>
      </main>
    </div>
  );
};
