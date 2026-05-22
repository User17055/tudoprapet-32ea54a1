// Chapéu de palha junino — SVG decorativo
export const ChapeuPalha = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 64 48"
    className={className}
    aria-hidden="true"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Aba do chapéu */}
    <ellipse cx="32" cy="36" rx="30" ry="7" fill="hsl(40 70% 55%)" />
    <ellipse cx="32" cy="34" rx="30" ry="7" fill="hsl(40 80% 65%)" />
    {/* Copa */}
    <path
      d="M14 34 C14 18, 22 8, 32 8 C42 8, 50 18, 50 34 Z"
      fill="hsl(40 75% 60%)"
    />
    {/* Sombra da copa */}
    <path
      d="M14 34 C14 18, 22 8, 32 8 C42 8, 50 18, 50 34 Z"
      fill="hsl(35 60% 45%)"
      opacity="0.25"
    />
    {/* Fita */}
    <rect x="14" y="28" width="36" height="5" fill="hsl(0 75% 50%)" />
    {/* Listras de palha */}
    <path d="M20 30 L20 12" stroke="hsl(35 55% 40%)" strokeWidth="0.6" opacity="0.5" />
    <path d="M28 30 L28 9" stroke="hsl(35 55% 40%)" strokeWidth="0.6" opacity="0.5" />
    <path d="M36 30 L36 9" stroke="hsl(35 55% 40%)" strokeWidth="0.6" opacity="0.5" />
    <path d="M44 30 L44 12" stroke="hsl(35 55% 40%)" strokeWidth="0.6" opacity="0.5" />
  </svg>
);
