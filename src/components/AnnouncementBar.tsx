import { Flame, Wheat, Crown } from "lucide-react";

export const AnnouncementBar = () => {
  const items = (
    <>
      <span className="inline-flex items-center gap-1.5 mx-6">
        <Wheat className="h-3.5 w-3.5 text-secondary" />
        <span>
          <strong>Arraiá TudoPraPet</strong> chegou — ofertas quentes pro seu pet!
        </span>
      </span>
      <span className="opacity-30 mx-6">•</span>
      <span className="inline-flex items-center gap-1.5 mx-6">
        <Flame className="h-3.5 w-3.5 text-secondary" />
        <span>
          Frete <strong>R$10</strong> em Pres. Prudente
        </span>
      </span>
      <span className="opacity-30 mx-6">•</span>
      <span className="inline-flex items-center gap-1.5 mx-6">
        <Crown className="h-3.5 w-3.5 text-secondary" />
        <span>
          <strong>Clube</strong>: preços de São João
        </span>
      </span>
      <span className="opacity-30 mx-6">•</span>
    </>
  );

  return (
    <div className="bg-primary text-primary-foreground text-xs md:text-sm overflow-hidden">
      <div className="relative flex py-2 whitespace-nowrap">
        <div className="flex shrink-0 animate-marquee">
          {items}
          {items}
        </div>
      </div>
    </div>
  );
};
