import { describe, expect, it } from "vitest";
import {
  buildIdempotencyKey,
  classifyWebhookEvent,
  isPickupMethod,
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
