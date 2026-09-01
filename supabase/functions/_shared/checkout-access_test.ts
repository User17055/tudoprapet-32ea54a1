import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readSessionClaim, SESSION_CLAIM_HEADER } from "./checkout-access.ts";
import { corsHeaders } from "./cors.ts";

// Por que estes testes existem: em 01/09/2026 uma cliente do Clube foi atendida
// como visitante porque a sessao dela morreu no meio do checkout. O servidor nao
// tinha como perceber -- sem sessao viva o SDK manda a chave publica, o mesmo
// cabecalho de quem nunca logou. `readSessionClaim` le a unica informacao capaz
// de separar os dois casos: o que o navegador declara sobre si mesmo.

const req = (value?: string) =>
  new Request("https://exemplo.test", {
    headers: value === undefined ? {} : { [SESSION_CLAIM_HEADER]: value },
  });

Deno.test("le a declaracao de quem afirma ter sessao", () => {
  assertEquals(readSessionClaim(req("user")), "user");
});

Deno.test("le a declaracao de visitante", () => {
  assertEquals(readSessionClaim(req("guest")), "guest");
});

Deno.test("cabecalho ausente e 'unknown', nunca 'user'", () => {
  // Isto preserva o comportamento antigo de proposito: as functions publicam
  // antes do frontend, e nessa janela nenhum cliente manda a declaracao. Se
  // ausencia virasse suspeita, o checkout inteiro cairia entre as duas
  // publicacoes.
  assertEquals(readSessionClaim(req()), "unknown");
});

Deno.test("valor desconhecido nao vira 'user' por acidente", () => {
  for (const lixo of ["", " ", "sim", "true", "1", "usuario", "admin"]) {
    assertEquals(readSessionClaim(req(lixo)), "unknown", `valor: ${JSON.stringify(lixo)}`);
  }
});

Deno.test("tolera espaco e caixa, que e como cabecalho chega na pratica", () => {
  assertEquals(readSessionClaim(req("  USER ")), "user");
  assertEquals(readSessionClaim(req("Guest")), "guest");
});

Deno.test("o cabecalho declarado esta liberado no CORS", () => {
  // Acoplamento invisivel: cors.ts escreve o nome literal, porque nao importa de
  // ninguem. Se os dois divergirem, o navegador barra a requisicao no preflight
  // -- sem erro no servidor, sem log, sem nada. O checkout de quem esta logado
  // simplesmente para de funcionar.
  const permitidos = corsHeaders["Access-Control-Allow-Headers"]
    .split(",")
    .map((h) => h.trim().toLowerCase());
  assertEquals(permitidos.includes(SESSION_CLAIM_HEADER), true);
});
