import { Flame } from "lucide-react";

const items = [
  <span key="1" className="inline-flex items-center gap-1.5">
    <span aria-hidden>🌽</span>
    <span><strong>Arraiá TudoPraPet</strong> chegou — ofertas quentes pro seu pet!</span>
  </span>,
  <span key="2" className="inline-flex items-center gap-1.5">
    <Flame className="h-3.5 w-3.5 text-secondary" />
    <span>Frete <strong>R$10</strong> em Pres. Prudente</span>
  </span>,
  <span key="3" className="inline-flex items-center gap-1.5">
    <span aria-hidden>👑</span>
    <span><strong>Clube</strong>: preços de São João</span>
  </span>,
  <span key="4" className="inline-flex items-center gap-1.5">
    <span aria-hidden>🎪</span>
    <span>Quermesse de ofertas: rações, farmácia e brinquedos</span>
  </span>,
  <span key="5" className="inline-flex items-center gap-1.5">
    <span aria-hidden>🔥</span>
    <span>Caía no forró das ofertas — só hoje!</span>
  </span>,
];

const Sep = () => <span aria-hidden className="opacity-40 mx-6">•</span>;

export const AnnouncementBar = () => {
  return (
    <div className="bg-primary text-primary-foreground text-xs md:text-sm overflow-hidden">
      <div className="relative flex py-2">
        <div className="flex shrink-0 animate-marquee whitespace-nowrap items-center">
          {items.map((it, i) => (
            <span key={`a-${i}`} className="inline-flex items-center">{it}<Sep /></span>
          ))}
        </div>
        <div className="flex shrink-0 animate-marquee whitespace-nowrap items-center" aria-hidden>
          {items.map((it, i) => (
            <span key={`b-${i}`} className="inline-flex items-center">{it}<Sep /></span>
          ))}
        </div>
      </div>
    </div>
  );
};
