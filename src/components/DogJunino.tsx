// Cachorrinho com chapéu de palha — decorativo (Festa Junina)
export const DogJunino = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 160 160"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Sombra */}
    <ellipse cx="80" cy="148" rx="42" ry="5" fill="hsl(var(--primary))" opacity="0.15" />

    {/* Corpo do cachorro */}
    <ellipse cx="80" cy="118" rx="38" ry="22" fill="hsl(35 70% 55%)" />

    {/* Patinhas */}
    <ellipse cx="62" cy="138" rx="9" ry="6" fill="hsl(35 70% 50%)" />
    <ellipse cx="98" cy="138" rx="9" ry="6" fill="hsl(35 70% 50%)" />

    {/* Cabeça */}
    <circle cx="80" cy="78" r="36" fill="hsl(35 75% 60%)" />

    {/* Orelhas */}
    <ellipse cx="48" cy="72" rx="11" ry="20" fill="hsl(25 65% 40%)" transform="rotate(-15 48 72)" />
    <ellipse cx="112" cy="72" rx="11" ry="20" fill="hsl(25 65% 40%)" transform="rotate(15 112 72)" />

    {/* Mancha no olho */}
    <ellipse cx="93" cy="76" rx="14" ry="13" fill="hsl(25 65% 40%)" />

    {/* Focinho */}
    <ellipse cx="80" cy="92" rx="18" ry="14" fill="hsl(40 80% 78%)" />

    {/* Olhos */}
    <circle cx="68" cy="76" r="4" fill="hsl(var(--primary))" />
    <circle cx="93" cy="76" r="4" fill="hsl(var(--primary))" />
    <circle cx="69" cy="75" r="1.3" fill="white" />
    <circle cx="94" cy="75" r="1.3" fill="white" />

    {/* Nariz */}
    <ellipse cx="80" cy="88" rx="4.5" ry="3.5" fill="hsl(var(--primary))" />

    {/* Boca/sorriso */}
    <path d="M 80 92 Q 74 100 70 96" stroke="hsl(var(--primary))" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M 80 92 Q 86 100 90 96" stroke="hsl(var(--primary))" strokeWidth="2" fill="none" strokeLinecap="round" />

    {/* Linguinha */}
    <ellipse cx="82" cy="99" rx="3" ry="4" fill="hsl(350 70% 65%)" />

    {/* Chapéu de palha — aba */}
    <ellipse cx="80" cy="48" rx="48" ry="8" fill="hsl(40 65% 55%)" />
    <ellipse cx="80" cy="46" rx="48" ry="6" fill="hsl(42 75% 65%)" />

    {/* Chapéu — copa */}
    <path d="M 56 46 Q 58 18 80 16 Q 102 18 104 46 Z" fill="hsl(42 75% 65%)" />
    <path d="M 56 46 Q 58 18 80 16 Q 102 18 104 46" stroke="hsl(35 60% 40%)" strokeWidth="1.5" fill="none" />

    {/* Faixa do chapéu */}
    <path d="M 58 42 Q 80 36 102 42 L 102 46 Q 80 40 58 46 Z" fill="hsl(0 75% 50%)" />

    {/* Remendos no chapéu (palha) */}
    <line x1="64" y1="42" x2="68" y2="46" stroke="hsl(35 60% 40%)" strokeWidth="1" />
    <line x1="74" y1="30" x2="76" y2="36" stroke="hsl(35 60% 40%)" strokeWidth="1" />
    <line x1="88" y1="26" x2="92" y2="34" stroke="hsl(35 60% 40%)" strokeWidth="1" />

    {/* Bigodes */}
    <line x1="64" y1="92" x2="56" y2="90" stroke="hsl(var(--primary))" strokeWidth="1" />
    <line x1="64" y1="95" x2="56" y2="96" stroke="hsl(var(--primary))" strokeWidth="1" />
    <line x1="96" y1="92" x2="104" y2="90" stroke="hsl(var(--primary))" strokeWidth="1" />
    <line x1="96" y1="95" x2="104" y2="96" stroke="hsl(var(--primary))" strokeWidth="1" />
  </svg>
);
