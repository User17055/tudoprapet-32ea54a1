import { ShieldCheck, Award } from "lucide-react";

const badges = [
  { icon: ShieldCheck, label: "Pagamento Seguro", desc: "Proteção total" },
  { icon: Award, label: "Marcas Premium", desc: "Só o melhor" },
];

export const TrustBadges = () => {
  return (
    <section className="bg-primary text-primary-foreground py-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-2 gap-4">
          {badges.map((b, i) => (
            <div key={i} className="flex items-center gap-3 justify-center text-center md:text-left">
              <b.icon className="h-6 w-6 shrink-0 text-secondary" />
              <div>
                <p className="font-display font-bold text-sm">{b.label}</p>
                <p className="text-xs opacity-80">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
