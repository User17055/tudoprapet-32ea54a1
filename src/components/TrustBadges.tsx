import { ShieldCheck, Truck, Headphones } from "lucide-react";

const badges = [
  { icon: Truck, label: "Frete a partir de R$10", desc: "Em Pres. Prudente" },
  { icon: ShieldCheck, label: "Compra 100% segura", desc: "Pagamento protegido" },
  { icon: Headphones, label: "Atendimento humano", desc: "Tira dúvidas no WhatsApp" },
];

export const TrustBadges = () => {
  return (
    <section className="bg-primary text-primary-foreground py-3 border-y border-primary/20">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {badges.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 justify-center md:justify-start"
            >
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-secondary/20 shrink-0">
                <b.icon className="h-5 w-5 text-secondary" />
              </div>
              <div className="min-w-0">
                <p className="font-display font-bold text-xs md:text-sm leading-tight truncate">
                  {b.label}
                </p>
                <p className="text-[10px] md:text-xs opacity-75 leading-tight truncate">
                  {b.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
