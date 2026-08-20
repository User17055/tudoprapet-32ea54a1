import { describe, expect, it } from "vitest";
import { isOriginAllowed, selfOrigins } from "../../printer-agent/origin.mjs";

// Por que este teste existe: ate 19/08/2026 o agente recusava o proprio painel.
// O navegador nao envia `Origin` em GET, entao /status, /history e /label-orders
// passavam e a tela abria normalmente; mas envia em POST, mesmo same-origin, e
// `http://127.0.0.1:17891` nunca esteve em `allowedOrigins`. So "gerar etiqueta"
// falhava, com 403 "Origem nao autorizada" -- estreito o bastante para parecer
// problema de rede e sobreviver a uma instalacao inteira.

// Igual ao config.example.json que vai para as instalacoes.
const EXAMPLE_CONFIG = {
  port: 17891,
  allowedOrigins: ["https://tudoprapet.com.br", "http://localhost:8080", "http://localhost:5173"],
};

describe("printer agent origin check", () => {
  it("accepts its own dashboard, which is what a POST actually sends", () => {
    expect(isOriginAllowed("http://127.0.0.1:17891", EXAMPLE_CONFIG)).toBe(true);
    expect(isOriginAllowed("http://localhost:17891", EXAMPLE_CONFIG)).toBe(true);
  });

  it("keeps allowing requests without an Origin header", () => {
    expect(isOriginAllowed(undefined, EXAMPLE_CONFIG)).toBe(true);
    expect(isOriginAllowed("", EXAMPLE_CONFIG)).toBe(true);
  });

  it("still honours the configured external origins", () => {
    expect(isOriginAllowed("https://tudoprapet.com.br", EXAMPLE_CONFIG)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", EXAMPLE_CONFIG)).toBe(true);
  });

  it("did not turn the check into a sieve", () => {
    expect(isOriginAllowed("https://evil.com", EXAMPLE_CONFIG)).toBe(false);
    // Porta diferente da que o agente escuta.
    expect(isOriginAllowed("http://127.0.0.1:9999", EXAMPLE_CONFIG)).toBe(false);
    // Dominio que apenas comeca igual: a comparacao tem de ser exata.
    expect(isOriginAllowed("http://127.0.0.1:17891.evil.com", EXAMPLE_CONFIG)).toBe(false);
    // Esquema diferente.
    expect(isOriginAllowed("https://127.0.0.1:17891", EXAMPLE_CONFIG)).toBe(false);
  });

  it("derives the local origin from the configured port", () => {
    const config = { port: 3000, allowedOrigins: [] };
    expect(isOriginAllowed("http://127.0.0.1:3000", config)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:17891", config)).toBe(false);
    expect(selfOrigins(3000)).toEqual(["http://127.0.0.1:3000", "http://localhost:3000"]);
  });

  it("works on a minimal config, so a fresh install is not born broken", () => {
    expect(isOriginAllowed("http://127.0.0.1:17891", { port: 17891 })).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:17891", {})).toBe(true);
    expect(isOriginAllowed("https://tudoprapet.com.br", { port: 17891 })).toBe(false);
  });
});
