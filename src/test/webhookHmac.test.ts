import { describe, expect, it } from "vitest";
import {
  decideHmac,
  resolveHmacMode,
  timingSafeEqual,
} from "../../supabase/functions/_shared/webhook.ts";

describe("resolveHmacMode", () => {
  it("only enables enforcement when explicitly asked", () => {
    expect(resolveHmacMode("enforce")).toBe("enforce");
    expect(resolveHmacMode("ENFORCE")).toBe("enforce");
    expect(resolveHmacMode("  enforce  ")).toBe("enforce");
  });

  it("defaults to monitor for anything else", () => {
    // O padrão precisa ser seguro: ligar rejeição sem confirmar o segredo
    // derruba o fluxo de retirada inteiro.
    for (const raw of ["monitor", "", "  ", "true", "1", "yes", "enforcing", null, undefined]) {
      expect(resolveHmacMode(raw)).toBe("monitor");
    }
  });
});

describe("timingSafeEqual", () => {
  it("matches identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("rejects different strings", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc123", "xbc123")).toBe(false);
  });

  it("rejects strings of different length", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abc", "")).toBe(false);
  });
});

describe("decideHmac", () => {
  it("accepts a valid signature in both modes", () => {
    for (const mode of ["monitor", "enforce"] as const) {
      expect(decideHmac({ mode, secretConfigured: true, signatureValid: true }))
        .toEqual({ action: "accept", reason: "valid" });
    }
  });

  it("lets an invalid signature through in monitor mode, but labels it", () => {
    expect(decideHmac({ mode: "monitor", secretConfigured: true, signatureValid: false }))
      .toEqual({ action: "accept", reason: "invalid-monitored" });
  });

  it("rejects an invalid signature in enforce mode", () => {
    expect(decideHmac({ mode: "enforce", secretConfigured: true, signatureValid: false }))
      .toEqual({ action: "reject", reason: "invalid-rejected" });
  });

  it("lets the request through when no secret is configured in monitor mode", () => {
    expect(decideHmac({ mode: "monitor", secretConfigured: false, signatureValid: null }))
      .toEqual({ action: "accept", reason: "secret-missing-monitored" });
  });

  it("rejects when enforcement is on but no secret is configured", () => {
    // Aceitar em silencio aqui daria falsa sensacao de seguranca: era
    // exatamente o buraco anterior, em que sem segredo nao havia verificacao.
    expect(decideHmac({ mode: "enforce", secretConfigured: false, signatureValid: null }))
      .toEqual({ action: "reject", reason: "secret-missing-rejected" });
  });

  it("never rejects anything while in monitor mode", () => {
    const cases = [
      { secretConfigured: true, signatureValid: true },
      { secretConfigured: true, signatureValid: false },
      { secretConfigured: false, signatureValid: null },
    ] as const;

    for (const c of cases) {
      expect(decideHmac({ mode: "monitor", ...c }).action).toBe("accept");
    }
  });

  it("only accepts a genuinely valid signature while in enforce mode", () => {
    expect(decideHmac({ mode: "enforce", secretConfigured: true, signatureValid: true }).action)
      .toBe("accept");
    expect(decideHmac({ mode: "enforce", secretConfigured: true, signatureValid: false }).action)
      .toBe("reject");
    expect(decideHmac({ mode: "enforce", secretConfigured: false, signatureValid: null }).action)
      .toBe("reject");
  });
});
