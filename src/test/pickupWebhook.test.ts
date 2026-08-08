import { describe, expect, it } from "vitest";
import {
  buildIdempotencyKey,
  classifyWebhookEvent,
  extractPickupCode,
  isPickupMethod,
  mergeNoteAttributes,
  isAlreadyPickedUp,
  PICKUP_CODE_ATTRIBUTE,
  PICKUP_DONE_ATTRIBUTE,
  shouldSavePickupCode,
} from "../../supabase/functions/_shared/pickup.ts";

describe("classifyWebhookEvent", () => {
  it("treats the canonical pickup topics as ready", () => {
    expect(classifyWebhookEvent("fulfillment_orders/ready_to_pickup"))
      .toBe("order_ready_for_pickup");
    expect(classifyWebhookEvent("fulfillment_orders/line_items_prepared_for_pickup"))
      .toBe("order_ready_for_pickup");
    expect(classifyWebhookEvent("fulfillments/create"))
      .toBe("order_ready_for_pickup");
  });

  it("ignores fulfillments/update", () => {
    // Regressão: atualizar um fulfillment existente (rastreio, correção) não é
    // um novo evento de "pronto" — era uma das fontes de mensagem duplicada.
    expect(classifyWebhookEvent("fulfillments/update")).toBeNull();
  });

  it("still reacts to an explicit ready status or tag on any topic", () => {
    expect(classifyWebhookEvent("fulfillments/update", { fulfillmentStatus: "ready_for_pickup" }))
      .toBe("order_ready_for_pickup");
    expect(classifyWebhookEvent("orders/updated", { tags: "VIP, pronto-retirada" }))
      .toBe("order_ready_for_pickup");
    expect(classifyWebhookEvent("orders/updated", { tags: "ready-for-pickup" }))
      .toBe("order_ready_for_pickup");
  });

  it("classifies order creation", () => {
    expect(classifyWebhookEvent("orders/create")).toBe("order_created");
  });

  it("keeps ready taking precedence over created", () => {
    expect(classifyWebhookEvent("orders/create", { tags: "pronto-retirada" }))
      .toBe("order_ready_for_pickup");
  });

  it("returns null for topics we do not act on", () => {
    for (const topic of ["orders/updated", "orders/cancelled", "carts/create", ""]) {
      expect(classifyWebhookEvent(topic)).toBeNull();
    }
  });

  it("tolerates missing signals", () => {
    expect(classifyWebhookEvent("orders/updated", { fulfillmentStatus: null, tags: null }))
      .toBeNull();
  });
});

describe("isPickupMethod", () => {
  it("recognises the Shopify pickup method", () => {
    expect(isPickupMethod("pick_up")).toBe(true);
    expect(isPickupMethod("pick-up")).toBe(true);
    expect(isPickupMethod("pick up")).toBe(true);
    expect(isPickupMethod("PICK_UP")).toBe(true);
  });

  it("rejects delivery methods", () => {
    expect(isPickupMethod("shipping")).toBe(false);
    expect(isPickupMethod("local")).toBe(false);
    expect(isPickupMethod("retail")).toBe(false);
  });

  it("rejects absent values instead of assuming pickup", () => {
    expect(isPickupMethod(null)).toBe(false);
    expect(isPickupMethod(undefined)).toBe(false);
    expect(isPickupMethod("")).toBe(false);
  });
});

describe("extractPickupCode", () => {
  it("reads the documented field", () => {
    expect(extractPickupCode(JSON.stringify({ pickup_code: "AB12" }))).toBe("AB12");
  });

  it("accepts the two legacy shapes the original code tolerated", () => {
    expect(extractPickupCode(JSON.stringify({ code: "AB12" }))).toBe("AB12");
    expect(extractPickupCode(JSON.stringify({ data: { pickup_code: "AB12" } }))).toBe("AB12");
  });

  it("prefers pickup_code when more than one field is present", () => {
    expect(extractPickupCode(JSON.stringify({ pickup_code: "AAA", code: "BBB" }))).toBe("AAA");
  });

  it("coerces a numeric code to string", () => {
    expect(extractPickupCode(JSON.stringify({ pickup_code: 1234 }))).toBe("1234");
  });

  it("returns null when there is no recognisable code", () => {
    expect(extractPickupCode(JSON.stringify({ ok: true }))).toBeNull();
    expect(extractPickupCode(JSON.stringify({ pickup_code: "" }))).toBeNull();
    expect(extractPickupCode(JSON.stringify({ pickup_code: null }))).toBeNull();
  });

  it("returns null instead of throwing on a non-JSON response", () => {
    expect(extractPickupCode("Internal Server Error")).toBeNull();
    expect(extractPickupCode("")).toBeNull();
  });
});

describe("mergeNoteAttributes", () => {
  const code = { name: PICKUP_CODE_ATTRIBUTE, value: "AB12" };

  it("adds the attribute when the order has none", () => {
    expect(mergeNoteAttributes(null, PICKUP_CODE_ATTRIBUTE, "AB12")).toEqual([code]);
    expect(mergeNoteAttributes(undefined, PICKUP_CODE_ATTRIBUTE, "AB12")).toEqual([code]);
    expect(mergeNoteAttributes([], PICKUP_CODE_ATTRIBUTE, "AB12")).toEqual([code]);
  });

  it("preserves attributes that already exist on the order", () => {
    // Regressão: o PUT da Shopify substitui o array inteiro, então escrever só
    // o código apagava observação de presente, dado de checkout, etc.
    const existing = [
      { name: "Observacao", value: "embrulhar para presente" },
      { name: "Origem", value: "instagram" },
    ];
    expect(mergeNoteAttributes(existing, PICKUP_CODE_ATTRIBUTE, "AB12"))
      .toEqual([...existing, code]);
  });

  it("replaces a previous pickup code instead of duplicating it", () => {
    const existing = [
      { name: "Observacao", value: "sem sacola" },
      { name: PICKUP_CODE_ATTRIBUTE, value: "ANTIGO" },
    ];
    const merged = mergeNoteAttributes(existing, PICKUP_CODE_ATTRIBUTE, "AB12");

    expect(merged.filter((a) => a.name === PICKUP_CODE_ATTRIBUTE)).toHaveLength(1);
    expect(merged).toEqual([{ name: "Observacao", value: "sem sacola" }, code]);
  });

  it("does not mutate the array it was given", () => {
    const existing = [{ name: "Observacao", value: "x" }];
    mergeNoteAttributes(existing, PICKUP_CODE_ATTRIBUTE, "AB12");
    expect(existing).toEqual([{ name: "Observacao", value: "x" }]);
  });
});

describe("shouldSavePickupCode", () => {
  it("always saves on the ready event (the pickup filter already ran upstream)", () => {
    expect(shouldSavePickupCode("order_ready_for_pickup", null)).toBe(true);
    expect(shouldSavePickupCode("order_ready_for_pickup", "shipping")).toBe(true);
  });

  it("saves on order_created only when the order is provably a pickup", () => {
    expect(shouldSavePickupCode("order_created", "pick_up")).toBe(true);
    expect(shouldSavePickupCode("order_created", "PICK_UP")).toBe(true);
  });

  it("never writes a pickup code onto a delivery order", () => {
    // Regressão: orders/create dispara para todo pedido. Se a API externa
    // devolver código nesse evento, o cliente de ENTREGA ganharia um
    // "Codigo de retirada" no e-mail.
    expect(shouldSavePickupCode("order_created", "shipping")).toBe(false);
    expect(shouldSavePickupCode("order_created", "local")).toBe(false);
  });

  it("does not save on order_created when the method is indeterminate", () => {
    // O evento de "pronto" grava de novo, então o pedido de retirada não perde
    // o código — só o recebe mais tarde. O inverso (código em pedido de
    // entrega) não tem segunda chance de correção.
    expect(shouldSavePickupCode("order_created", null)).toBe(false);
    expect(shouldSavePickupCode("order_created", undefined)).toBe(false);
    expect(shouldSavePickupCode("order_created", "")).toBe(false);
  });
});

describe("buildIdempotencyKey", () => {
  it("gives the same key for every topic that means the same event", () => {
    // os três tópicos de "pronto" produzem a mesma chave para o mesmo pedido
    const fromGid = buildIdempotencyKey("order_ready_for_pickup", "gid://shopify/Order/12345");
    const fromNumeric = buildIdempotencyKey("order_ready_for_pickup", "12345");
    expect(fromGid).toBe(fromNumeric);
    expect(fromGid).toBe("order_ready_for_pickup:12345");
  });

  it("separates different events for the same order", () => {
    expect(buildIdempotencyKey("order_created", "12345"))
      .not.toBe(buildIdempotencyKey("order_ready_for_pickup", "12345"));
  });

  it("separates different orders", () => {
    expect(buildIdempotencyKey("order_ready_for_pickup", "12345"))
      .not.toBe(buildIdempotencyKey("order_ready_for_pickup", "54321"));
  });
});

describe("isAlreadyPickedUp", () => {
  it("detects the pickup-done attribute", () => {
    expect(isAlreadyPickedUp({ noteAttributes: [{ name: PICKUP_DONE_ATTRIBUTE, value: "2026-08-08T12:00:00Z" }] })).toBe(true);
  });

  it("ignores an empty attribute value", () => {
    expect(isAlreadyPickedUp({ noteAttributes: [{ name: PICKUP_DONE_ATTRIBUTE, value: " " }] })).toBe(false);
  });

  it("treats a fulfilled order as picked up", () => {
    expect(isAlreadyPickedUp({ fulfillmentStatus: "fulfilled" })).toBe(true);
    expect(isAlreadyPickedUp({ fulfillmentStatus: "partial" })).toBe(false);
    expect(isAlreadyPickedUp({})).toBe(false);
  });
});
