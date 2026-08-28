import { describe, expect, it } from "vitest";
import {
  buildDraftLineItems,
  buildPriceAdjustmentLine,
  buildShippingLine,
  CHECKOUT_SERVICE_FEE,
  findUnpricedVariants,
  resolveUnitPrice,
  gidToNumericId,
  toGraphqlDraftLineItems,
  type LineItem,
} from "../../supabase/functions/_shared/pricing.ts";

describe("checkout sem taxa de serviço", () => {
  it("mantém a taxa operacional zerada para novos pedidos", () => {
    expect(CHECKOUT_SERVICE_FEE).toBe(0);
  });

  it("mantém a modalidade de entrega separada dos produtos", () => {
    expect(buildShippingLine("PAC", 24.9)).toEqual({
      title: "PAC",
      price: "24.90",
    });
    expect(buildShippingLine("Retirada na loja", 0)).toEqual({
      title: "Retirada na loja",
      price: "0.00",
    });
  });
});


const VARIANT_A = "gid://shopify/ProductVariant/111";
const VARIANT_B = "gid://shopify/ProductVariant/222";

function itemsOf(...items: LineItem[]): LineItem[] {
  return items;
}

describe("gidToNumericId", () => {
  it("extracts the numeric id from a Shopify GID", () => {
    expect(gidToNumericId(VARIANT_A)).toBe("111");
  });

  it("returns the input when there is no slash to split on", () => {
    expect(gidToNumericId("333")).toBe("333");
  });
});

describe("buildDraftLineItems", () => {
  it("maps variant id and quantity onto every line", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 2 }),
      new Map(),
      new Map(),
      "Clube TudoPraPet",
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].variant_id).toBe(111);
    expect(lines[0].quantity).toBe(2);
  });

  it("applies no discount when there is no special price", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map(),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeUndefined();
  });

  it("never turns an invalid zero special price into a free product", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 0]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeUndefined();
  });

  it("applies no discount when the current price is unknown", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 80]]),
      new Map(),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeUndefined();
  });

  it("never creates a negative discount when the special price is not cheaper", () => {
    const equal = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 100]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );
    const moreExpensive = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 120]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(equal[0].applied_discount).toBeUndefined();
    expect(moreExpensive[0].applied_discount).toBeUndefined();
  });

  it("discounts the difference per unit and multiplies the amount by quantity", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 3 }),
      new Map([[VARIANT_A, 79.99]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toEqual({
      description: "Clube TudoPraPet",
      value_type: "fixed_amount",
      value: "20.01",
      amount: "60.03",
      title: "Clube TudoPraPet",
    });
  });

  it("rounds away floating point noise in the per-unit discount", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 19.9]]),
      new Map([[VARIANT_A, 29.9]]),
      "Franquia TudoPraPet",
    );

    // 29.9 - 19.9 dá 10.000000000000002 em ponto flutuante.
    expect((lines[0].applied_discount as Record<string, string>).value).toBe("10.00");
  });

  it("uses the given label on both description and title", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 50]]),
      new Map([[VARIANT_A, 60]]),
      "Franquia TudoPraPet",
    );

    const discount = lines[0].applied_discount as Record<string, string>;
    expect(discount.description).toBe("Franquia TudoPraPet");
    expect(discount.title).toBe("Franquia TudoPraPet");
  });

  it("discounts only the items that have a special price", () => {
    const lines = buildDraftLineItems(
      itemsOf(
        { variantId: VARIANT_A, quantity: 1 },
        { variantId: VARIANT_B, quantity: 1 },
      ),
      new Map([[VARIANT_A, 50]]),
      new Map([[VARIANT_A, 60], [VARIANT_B, 60]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeDefined();
    expect(lines[1].applied_discount).toBeUndefined();
  });
});

describe("toGraphqlDraftLineItems", () => {
  it("preserva a variante real em vez de criar um item personalizado", () => {
    const [line] = toGraphqlDraftLineItems([
      { variant_id: 111, quantity: 2 },
    ]);
    expect(line).toEqual({
      variantId: VARIANT_A,
      quantity: 2,
    });
  });

  it("mantém o desconto GraphQL por unidade mesmo quando a quantidade é maior", () => {
    const [line] = toGraphqlDraftLineItems([{
      variant_id: 111,
      quantity: 3,
      applied_discount: {
        description: "Clube TudoPraPet",
        title: "Clube TudoPraPet",
        value: "10.00",
        amount: "30.00",
      },
    }]);
    expect(line.appliedDiscount).toEqual({
      description: "Clube TudoPraPet",
      title: "Clube TudoPraPet",
      valueType: "FIXED_AMOUNT",
      value: 10,
    });
  });

  it("não transforma o desconto total da linha em desconto por unidade", () => {
    const [line] = toGraphqlDraftLineItems([{
      variant_id: 111,
      quantity: 2,
      applied_discount: {
        description: "Clube TudoPraPet",
        title: "Clube TudoPraPet",
        value: "2.26",
        amount: "4.52",
      },
    }]);
    expect(line.appliedDiscount).toMatchObject({
      valueType: "FIXED_AMOUNT",
      value: 2.26,
    });
  });
});

describe("buildPriceAdjustmentLine", () => {
  it("não cria ajuste quando o preço final é igual ou menor que o da Shopify", () => {
    expect(buildPriceAdjustmentLine(
      itemsOf({ variantId: VARIANT_A, quantity: 2 }),
      new Map([[VARIANT_A, 100]]),
      new Map([[VARIANT_A, 100]]),
    )).toBeNull();
    expect(buildPriceAdjustmentLine(
      itemsOf({ variantId: VARIANT_A, quantity: 2 }),
      new Map([[VARIANT_A, 80]]),
      new Map([[VARIANT_A, 100]]),
    )).toBeNull();
  });

  it("cobra a diferença por unidade quando o preço do sistema é maior", () => {
    const line = buildPriceAdjustmentLine(
      itemsOf({ variantId: VARIANT_A, quantity: 2 }, { variantId: VARIANT_B, quantity: 1 }),
      new Map([[VARIANT_A, 120], [VARIANT_B, 50]]),
      new Map([[VARIANT_A, 100], [VARIANT_B, 60]]),
    );

    expect(line).not.toBeNull();
    expect(line!.price).toBe("40.00");
    expect(line!.quantity).toBe(1);
    expect(line!.requires_shipping).toBe(false);
  });

  it("converte o ajuste para o formato GraphQL sem variante", () => {
    const line = buildPriceAdjustmentLine(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 110.5]]),
      new Map([[VARIANT_A, 100]]),
    )!;
    const [graphql] = toGraphqlDraftLineItems([line]);

    expect(graphql.variantId).toBeUndefined();
    expect(graphql.originalUnitPrice).toBe(10.5);
    expect(graphql.quantity).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// O invariante do checkout: o que o cliente paga é o que o pedido registra.
//
// Os testes acima verificam buildPriceAdjustmentLine isoladamente, com mapas
// montados à mão. Isso não cobre o caminho real -- e a diferença não é teórica:
// no merge de 28/08 as duas correções do mesmo bug se combinaram de um jeito
// que COMPILAVA, passava em todos os testes, e mesmo assim a linha de ajuste
// nunca era gerada (o preço final chegava já limitado, então nunca era maior
// que o da Shopify). A funcionalidade morria calada.
//
// Este bloco monta as linhas como as edge functions montam e confere o único
// número que importa: soma cobrada contra soma registrada no pedido.
// ---------------------------------------------------------------------------

/** O total que o pedido na Shopify vai registrar, somando linhas e ajuste. */
function totalRegistrado(
  lines: Record<string, unknown>[],
  precosShopify: Map<string, number>,
): number {
  let total = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity) || 1;
    if (!line.variant_id) {
      // Linha customizada de ajuste: o valor vale por inteiro.
      total += Number(line.price) * quantity;
      continue;
    }
    const nativo = [...precosShopify.entries()]
      .find(([id]) => gidToNumericId(id) === String(line.variant_id))?.[1] ?? 0;
    const desconto = line.applied_discount as Record<string, unknown> | undefined;
    total += (nativo - (desconto ? Number(desconto.value) : 0)) * quantity;
  }
  return Number(total.toFixed(2));
}

/** Reproduz o que as duas portas fazem: linhas das variantes + linha de ajuste. */
function montarPedido(
  items: LineItem[],
  precosFinais: Map<string, number>,
  precosShopify: Map<string, number>,
): Record<string, unknown>[] {
  const lines = buildDraftLineItems(items, precosFinais, precosShopify, "TudoPraPet");
  const ajuste = buildPriceAdjustmentLine(items, precosFinais, precosShopify);
  if (ajuste) lines.push(ajuste);
  return lines;
}

describe("invariante: o valor cobrado é o que o pedido na Shopify registra", () => {
  const casos = [
    { nome: "o bug de 25/08: valor acima do preço da Shopify", final: 200, shopify: 160, quantidade: 1 },
    { nome: "acima, com quantidade maior que um", final: 200, shopify: 160, quantidade: 3 },
    { nome: "um centavo acima", final: 160.01, shopify: 160, quantidade: 1 },
    { nome: "desconto normal, valor abaixo", final: 120, shopify: 160, quantidade: 2 },
    { nome: "valor igual ao da Shopify", final: 160, shopify: 160, quantidade: 1 },
    { nome: "centavos que não fecham redondo", final: 33.37, shopify: 19.9, quantidade: 3 },
  ];

  for (const caso of casos) {
    it(caso.nome, () => {
      const items = itemsOf({ variantId: VARIANT_A, quantity: caso.quantidade });
      const precosShopify = new Map([[VARIANT_A, caso.shopify]]);
      const precosFinais = new Map([[VARIANT_A, caso.final]]);

      const cobrado = Number((caso.final * caso.quantidade).toFixed(2));
      expect(totalRegistrado(montarPedido(items, precosFinais, precosShopify), precosShopify))
        .toBe(cobrado);
    });
  }

  it("fecha a conta com itens acima e abaixo no mesmo pedido", () => {
    const items = itemsOf(
      { variantId: VARIANT_A, quantity: 2 },
      { variantId: VARIANT_B, quantity: 1 },
    );
    const precosShopify = new Map([[VARIANT_A, 160], [VARIANT_B, 60]]);
    const precosFinais = new Map([[VARIANT_A, 200], [VARIANT_B, 50]]);

    // 2 x 200 + 1 x 50 = 450
    expect(totalRegistrado(montarPedido(items, precosFinais, precosShopify), precosShopify))
      .toBe(450);
  });

  it("gera a linha de ajuste quando o valor passa do preço da Shopify", () => {
    // Guarda direta contra a regressão do merge: se alguém voltar a limitar o
    // preço antes daqui, o ajuste some e este teste cai.
    const lines = montarPedido(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 200]]),
      new Map([[VARIANT_A, 160]]),
    );

    const ajuste = lines.find((line) => !line.variant_id);
    expect(ajuste).toBeDefined();
    expect(ajuste!.price).toBe("40.00");
  });
});

describe("findUnpricedVariants", () => {
  it("acusa a variante que ficou sem preço da Shopify", () => {
    // A Storefront API não devolve variante removida ou despublicada. Sem o
    // preço nativo, buildPriceAdjustmentLine ignora o item e o acréscimo se
    // perde -- é a divergência silenciosa voltando pela porta dos fundos.
    expect(findUnpricedVariants(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 200]]),
      new Map([[VARIANT_B, 160]]),
    )).toEqual([VARIANT_A]);
  });

  it("não acusa nada quando todo item tem preço", () => {
    expect(findUnpricedVariants(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 200]]),
      new Map([[VARIANT_A, 160]]),
    )).toEqual([]);
  });

  it("ignora o item que não tem valor final definido", () => {
    // Sem valor cadastrado não há acréscimo a perder: a Shopify cobra o preço
    // dela e o pedido registra o mesmo. Não é caso de alarme.
    expect(findUnpricedVariants(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map(),
      new Map(),
    )).toEqual([]);
  });

  it("não repete a variante que aparece em mais de um item", () => {
    expect(findUnpricedVariants(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }, { variantId: VARIANT_A, quantity: 2 }),
      new Map([[VARIANT_A, 200]]),
      new Map(),
    )).toEqual([VARIANT_A]);
  });
});

describe("resolveUnitPrice", () => {
  it("mantém o valor de catálogo acima do preço da Shopify", () => {
    // O ponto do teste não é o número: é que não existe preço da Shopify neste
    // escopo para limitar coisa alguma. Foi assim que a linha de ajuste morreu
    // no merge de 28/08 -- o preço chegava limitado e o acréscimo nunca existia.
    expect(resolveUnitPrice(200, undefined)).toBe(200);
    expect(resolveUnitPrice(200, 190)).toBe(190);
  });

  it("usa o preço de perfil só quando ele é menor", () => {
    expect(resolveUnitPrice(100, 80)).toBe(80);
    expect(resolveUnitPrice(100, 120)).toBe(100);
    expect(resolveUnitPrice(100, 100)).toBe(100);
  });

  it("ignora preço de perfil inválido", () => {
    expect(resolveUnitPrice(100, 0)).toBe(100);
    expect(resolveUnitPrice(100, -5)).toBe(100);
    expect(resolveUnitPrice(100, NaN)).toBe(100);
  });

  it("aceita catálogo ausente, como na porta de assinante", () => {
    // Em _shared/checkout.ts a base pode faltar: sem valor cadastrado e sem
    // preço da Shopify, sobra o preço de perfil.
    expect(resolveUnitPrice(undefined, 80)).toBe(80);
    expect(resolveUnitPrice(undefined, undefined)).toBeUndefined();
    expect(resolveUnitPrice(NaN, undefined)).toBeUndefined();
  });
});
