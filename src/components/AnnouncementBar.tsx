import { Truck, Crown } from "lucide-react";

export const AnnouncementBar = () => {
  return (
    <div className="bg-primary text-primary-foreground text-xs md:text-sm">
      <div className="container mx-auto py-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center">
        <span className="inline-flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5 text-secondary" />
          <span>
            Frete <strong>R$10</strong> em Presidente Prudente
          </span>
        </span>
        <span className="hidden md:inline opacity-30">•</span>
        <span className="inline-flex items-center gap-1.5">
          <Crown className="h-3.5 w-3.5 text-secondary" />
          <span>
            Membros do <strong>Clube</strong>: preços exclusivos
          </span>
        </span>
      </div>
    </div>
  );
};
