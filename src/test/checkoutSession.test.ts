import { describe, expect, it } from "vitest";
import {
  isDeadSessionError,
  SESSION_CLAIM_HEADER,
  sessionClaimHeaders,
} from "../lib/checkoutSession";

// Por que estes testes existem: em 01/09/2026 uma cliente do Clube viu "Não
// autorizado" numa caixa vermelha, sobre um CPF válido, sem nenhuma pista do
// que fazer — a sessão dela tinha morrido no meio do checkout. Antes disso, e
// pior, ela chegou a ser atendida como visitante e cobrada preço cheio, em
// silêncio, porque o servidor não conseguia distinguir "visitante" de "sessão
// que morreu". Quem sabe a diferença é esta ponta, e ela precisa declarar.

describe("sessionClaimHeaders", () => {
  it("declara sessão quando a tela acredita ter usuário", () => {
    expect(sessionClaimHeaders(true)).toEqual({ [SESSION_CLAIM_HEADER]: "user" });
  });

  it("declara visitante quando não há usuário", () => {
    expect(sessionClaimHeaders(false)).toEqual({ [SESSION_CLAIM_HEADER]: "guest" });
  });

  it("nunca omite a declaração", () => {
    // Ausência tem significado próprio no servidor: "cliente antigo, não sei".
    // Se esta ponta parasse de declarar, a recusa deixaria de acontecer e o
    // defeito voltaria calado, que é o pior jeito de ele voltar.
    for (const valor of [true, false]) {
      expect(Object.keys(sessionClaimHeaders(valor))).toEqual([SESSION_CLAIM_HEADER]);
    }
  });

  it("usa exatamente o nome de cabeçalho que o servidor lê", () => {
    // Espelho de SESSION_CLAIM_HEADER em _shared/checkout-access.ts, e literal
    // no ALLOWED_HEADERS de _shared/cors.ts. Se divergir, o preflight barra o
    // cabeçalho e o checkout de quem está logado quebra.
    expect(SESSION_CLAIM_HEADER).toBe("x-tpp-session");
  });
});

describe("isDeadSessionError", () => {
  it("reconhece a recusa das portas do checkout", () => {
    expect(isDeadSessionError("Sessão inválida")).toBe(true);
  });

  it("reconhece o 401 que a cliente recebeu ao salvar os dados", () => {
    expect(isDeadSessionError("Não autorizado")).toBe(true);
  });

  it("reconhece a mensagem dentro de um texto maior", () => {
    expect(isDeadSessionError("Erro ao preparar: Sessão inválida")).toBe(true);
  });

  it("não confunde com os outros erros do checkout", () => {
    const outros = [
      "O valor mínimo para pagamento é R$ 5,00 e seu carrinho está em R$ 2,96.",
      "Não foi possível validar o cartão e os dados do titular.",
      "Informe um CPF ou CNPJ válido",
      "O total deste checkout está desatualizado. Volte à sacola e tente novamente.",
      "Produto removido",
      "",
    ];
    for (const mensagem of outros) {
      expect(isDeadSessionError(mensagem)).toBe(false);
    }
  });

  it("não quebra com o que não é texto", () => {
    for (const valor of [undefined, null, 0, {}, [], new Error("Sessão inválida")]) {
      expect(isDeadSessionError(valor)).toBe(false);
    }
  });
});
