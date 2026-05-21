// Faixa decorativa de bandeirinhas (Festa Junina)
// Usa as cores da marca + acentos festivos. Puramente decorativa.
export const Bandeirinhas = ({ className = "" }: { className?: string }) => {
  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--secondary))",
    "hsl(0 75% 55%)",       // vermelho
    "hsl(var(--primary))",
    "hsl(152 60% 42%)",     // verde
    "hsl(var(--secondary))",
    "hsl(0 75% 55%)",
    "hsl(var(--primary))",
    "hsl(var(--secondary))",
    "hsl(152 60% 42%)",
    "hsl(0 75% 55%)",
    "hsl(var(--secondary))",
  ];

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div className="flex w-full">
        {Array.from({ length: 60 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 min-w-0"
            style={{
              height: "18px",
              backgroundColor: colors[i % colors.length],
              clipPath: "polygon(0 0, 100% 0, 50% 100%)",
              marginRight: "2px",
              transform: i % 2 === 0 ? "translateY(-1px)" : "translateY(1px)",
            }}
          />
        ))}
      </div>
    </div>
  );
};
