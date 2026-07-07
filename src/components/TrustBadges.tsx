import { BadgeCheck, Clock3, Store, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const badges = [
  {
    icon: Clock3,
    title: "Receba em Horas",
    subtitle: "Confira as regras",
    rules: [
      "Valido somente para entregas dentro do municipio de Presidente Prudente.",
      "O prazo de entrega e de ate 24 horas apos a confirmacao do pedido e pagamento.",
      "Confira a disponibilidade da modalidade no carrinho de compras.",
      "Condicao valida somente para pedidos com a modalidade Entrega Expressa disponivel.",
      "E necessario ter alguem no local para receber o pedido.",
      "Pedidos feitos em feriados, finais de semana ou fora do horario operacional podem ter o prazo contado a partir do proximo dia util.",
    ],
  },
  {
    icon: Truck,
    title: "Entrega Local",
    subtitle: "Veja as regioes",
    rules: [
      "Atendimento de entrega local para Presidente Prudente e regioes proximas.",
      "A disponibilidade e o prazo aparecem no carrinho conforme o endereco informado.",
      "Valores e modalidades podem variar de acordo com bairro, distancia e volume do pedido.",
      "Algumas regioes podem depender de confirmacao da equipe TudoPraPet.",
      "Em caso de duvida, fale com nosso atendimento antes de finalizar a compra.",
    ],
  },
  {
    icon: BadgeCheck,
    title: "Qualidade",
    subtitle: "Confira os detalhes",
    rules: [
      "Selecionamos produtos de marcas confiaveis para o cuidado do seu pet.",
      "Trabalhamos com itens de alimentacao, farmacia, higiene e acessorios pensados para o dia a dia.",
      "As informacoes de cada produto devem ser conferidas na pagina do item antes da compra.",
      "Em caso de duvida sobre indicacao, tamanho, composicao ou uso, fale com a equipe TudoPraPet.",
    ],
  },
  {
    icon: Store,
    title: "Retire e Troque na Loja",
    subtitle: "Confira as regras",
    rules: [
      "A retirada e troca em loja dependem da disponibilidade da unidade selecionada.",
      "Leve o comprovante do pedido e um documento com foto.",
      "Produtos devem respeitar as condicoes de troca, embalagem e prazo informados no atendimento.",
      "Itens pereciveis, medicamentos e produtos abertos podem seguir regras especificas.",
      "Consulte a equipe antes de se deslocar ate a loja.",
    ],
  },
];

export const TrustBadges = () => {
  return (
    <section className="hidden bg-white py-8 lg:block lg:py-10">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {badges.map((badge) => (
            <Dialog key={badge.title}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="group flex min-h-[68px] items-center justify-center gap-4 rounded-lg border border-[#e3e3e3] bg-white px-5 py-4 text-left text-[#6f7178]"
                >
                  <badge.icon className="h-5 w-5 shrink-0" />
                  <div className="min-w-0 leading-tight">
                    <p className="font-display text-[15px] font-bold leading-[1.05] text-inherit">
                      {badge.title}
                    </p>
                    <p className="text-[11px] font-bold leading-[1.05] text-inherit transition-colors group-hover:text-primary">
                      {badge.subtitle} <span aria-hidden="true">-&gt;</span>
                    </p>
                  </div>
                </button>
              </DialogTrigger>
              <DialogContent className="max-h-[82vh] max-w-[480px] gap-0 rounded-2xl p-0">
                <DialogHeader className="border-b border-border px-6 py-5">
                  <DialogTitle className="text-left font-display text-lg font-bold">
                    {badge.title}
                  </DialogTitle>
                </DialogHeader>
                <div className="max-h-[52vh] overflow-y-auto px-6 py-5 text-sm leading-relaxed text-muted-foreground">
                  <ul className="space-y-1">
                    {badge.rules.map((rule) => (
                      <li key={rule}>- {rule}</li>
                    ))}
                  </ul>
                </div>
                <DialogFooter className="border-t border-border px-6 py-4">
                  <DialogClose asChild>
                    <Button className="h-12 min-w-[120px] rounded-lg font-bold">
                      Entendi
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ))}
        </div>
      </div>
    </section>
  );
};
