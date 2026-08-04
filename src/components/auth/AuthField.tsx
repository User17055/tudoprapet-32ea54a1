import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Conteúdo à direita do label — normalmente um link ("Esqueci minha senha"). */
  labelAction?: ReactNode;
  /** Adiciona o botão de mostrar/esconder e alterna o type. */
  revealable?: boolean;
}

/**
 * Campo de formulário das telas de autenticação.
 *
 * Existia repetido ~10 vezes em quatro páginas, com três estilos diferentes:
 * borda de 1px ou 2px, padding-left de 10, 11 ou 12, e anel de foco só no Login.
 *
 * O anel de foco é dourado de propósito — é o único momento em que a cor de
 * acento aparece no formulário, o que a torna um sinal e não decoração.
 */
export const AuthField = ({
  id,
  label,
  icon: Icon,
  labelAction,
  revealable = false,
  className,
  type = "text",
  ...props
}: AuthFieldProps) => {
  const [revealed, setRevealed] = useState(false);
  const resolvedType = revealable ? (revealed ? "text" : "password") : type;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-bold text-foreground">
          {label}
        </label>
        {labelAction}
      </div>

      <div className="relative">
        <Icon
          className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={id}
          type={resolvedType}
          className={cn(
            "h-12 w-full rounded-xl border border-input bg-background pl-11 text-base outline-none transition",
            "focus:border-primary focus:ring-4 focus:ring-secondary/30",
            revealable ? "pr-12" : "pr-4",
            className,
          )}
          {...props}
        />

        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-primary"
            aria-label={revealed ? "Esconder senha" : "Mostrar senha"}
          >
            {revealed ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        )}
      </div>
    </div>
  );
};
