// Classifica produtos com Gemini usando somente a taxonomia ja cadastrada.
// A function apenas devolve sugestoes; a gravacao continua no painel admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";

type InputProduct = {
  id?: string;
  title?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
};

type CategoryRow = { id: string; name: string; parent_id: string | null };
type BrandRow = { id: string; name: string };
type AttributeRow = { attr_key: string; attr_value: string };

const MAX_PRODUCTS = 15;

const unique = <T>(values: T[]) => Array.from(new Set(values));

const categoryPath = (category: CategoryRow, byId: Map<string, CategoryRow>) => {
  const names = [category.name];
  const seen = new Set([category.id]);
  let current = category;
  while (current.parent_id) {
    const parent = byId.get(current.parent_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    names.unshift(parent.name);
    current = parent;
  }
  return names.join(" > ");
};

const categoryAncestors = (categoryId: string, byId: Map<string, CategoryRow>) => {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    ids.unshift(current.id);
    seen.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return ids;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Metodo nao permitido", 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) return errorResponse("Secret GEMINI_API_KEY nao configurado", 503);

  let body: { products?: InputProduct[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse("JSON invalido", 400);
  }

  if (!Array.isArray(body.products) || body.products.length === 0 || body.products.length > MAX_PRODUCTS) {
    return errorResponse(`Envie de 1 a ${MAX_PRODUCTS} produtos`, 400);
  }
  const products = body.products.map((product) => ({
    id: String(product.id || ""),
    title: String(product.title || "").slice(0, 500),
    vendor: String(product.vendor || "").slice(0, 200),
    productType: String(product.productType || "").slice(0, 200),
    tags: Array.isArray(product.tags) ? product.tags.map(String).slice(0, 30) : [],
  }));
  if (products.some((product) => !product.id.startsWith("gid://shopify/Product/") || !product.title)) {
    return errorResponse("Produto invalido", 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [categoryResult, brandResult, attributeResult] = await Promise.all([
    admin.from("categories").select("id,name,parent_id").order("name"),
    admin.from("brands").select("id,name").order("name"),
    admin.from("attribute_values").select("attr_key,attr_value").order("attr_key").order("sort_order"),
  ]);
  const taxonomyError = categoryResult.error || brandResult.error || attributeResult.error;
  if (taxonomyError) {
    console.error("[admin-product-ai-fill] taxonomy", taxonomyError);
    return errorResponse("Nao foi possivel carregar categorias, marcas e atributos", 500);
  }

  const categories = (categoryResult.data || []) as CategoryRow[];
  const brands = (brandResult.data || []) as BrandRow[];
  const attributes = (attributeResult.data || []) as AttributeRow[];
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const allowedCategoryIds = new Set(categories.map((category) => category.id));
  const allowedBrandIds = new Set(brands.map((brand) => brand.id));
  const allowedAttributePairs = new Set(attributes.map((attribute) => `${attribute.attr_key}\u0000${attribute.attr_value}`));

  const prompt = `
Voce e um catalogador especialista em pet shop brasileiro. Antes de classificar CADA produto, pesquise-o na web e confira especie, indicacao e apresentacao em fonte confiavel.

Regras obrigatorias:
- Priorize pagina oficial do fabricante, bula e catalogo oficial. Use lojas apenas como confirmacao secundaria.
- Nao deduza especie, idade ou porte apenas pela marca ou por outro produto da mesma linha. Cada apresentacao deve ser verificada separadamente.
- Se o titulo da loja contradizer fabricante ou bula, siga a fonte oficial. Exemplo: WellPet da Ourofino e canino; nao o classifique para gatos sem uma fonte oficial especifica da apresentacao.
- Se nao encontrar confirmacao suficiente, deixe os campos duvidosos vazios e use confianca abaixo de 0,65. E melhor deixar pendente do que cadastrar algo incorreto.
- Use exclusivamente IDs e pares de atributos fornecidos abaixo. Nunca invente valores.
- Escolha as categorias folha mais especificas aplicaveis. O sistema adicionara os pais.
- Produtos para caes e gatos devem receber categorias e atributos das duas especies quando aplicavel.
- Preencha todos os atributos aplicaveis, inclusive multiplas idades e portes quando o produto servir para todos.
- Interprete abreviacoes comerciais pelo contexto: AD=adulto, FILH=filhote, PEQ=pequeno. RC pode significar racas ou racao; nao trate RC como racao se o produto for cookie/petisco.
- Medicamentos devem ter aplicacao e uso quando houver evidencia. Nao confunda peso da embalagem/dose com porte do animal.
- Retorne exatamente uma sugestao para cada productId, mesmo que alguns campos precisem ficar vazios.

CATEGORIAS (id | caminho):
${categories.map((category) => `${category.id} | ${categoryPath(category, categoryById)}`).join("\n")}

MARCAS (id | nome):
${brands.map((brand) => `${brand.id} | ${brand.name}`).join("\n")}

ATRIBUTOS PERMITIDOS (titulo | valor):
${attributes.map((attribute) => `${attribute.attr_key} | ${attribute.attr_value}`).join("\n")}

PRODUTOS:
${JSON.stringify(products)}
`.trim();

  const schema = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            productId: { type: "string", enum: products.map((product) => product.id) },
            categoryIds: { type: "array", items: { type: "string", enum: categories.map((category) => category.id) } },
            brandId: { type: ["string", "null"], enum: [...brands.map((brand) => brand.id), null] },
            attributes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  attr_key: { type: "string", enum: unique(attributes.map((attribute) => attribute.attr_key)) },
                  attr_value: { type: "string", enum: unique(attributes.map((attribute) => attribute.attr_value)) },
                },
                required: ["attr_key", "attr_value"],
              },
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidenceUrl: { type: ["string", "null"], description: "Melhor fonte consultada, preferencialmente fabricante ou bula" },
          },
    required: ["productId", "categoryIds", "brandId", "attributes", "confidence", "evidenceUrl"],
        },
      },
    },
    required: ["suggestions"],
  };
  // O schema do Gemini (subset OpenAPI) nao aceita "type": ["string","null"]; usa "nullable": true.
  const geminiSchema = JSON.parse(
    JSON.stringify(schema, (key, value) =>
      key === "type" && Array.isArray(value) && value.includes("null")
        ? value.filter((t) => t !== "null")[0]
        : value,
    ),
  );
  for (const field of [geminiSchema.properties.suggestions.items.properties.brandId, geminiSchema.properties.suggestions.items.properties.evidenceUrl]) {
    if (Array.isArray(field.type) || field.type === "object") continue;
    field.nullable = true;
  }

  const primaryModel = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
  const fallbackModels = unique([primaryModel, "gemini-3.5-flash", "gemini-3-flash-preview"]).filter(Boolean);

  let text = "";
  let lastStatus = 0;
  let lastModel = primaryModel;
  for (const model of fallbackModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    // Transitorios (429/503) merecem uma segunda tentativa com espera curta antes de trocar de modelo.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
      const geminiResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: geminiSchema,
          },
        }),
      });
      lastStatus = geminiResponse.status;
      lastModel = model;
      const geminiPayload = await geminiResponse.json().catch(() => ({}));
      if (geminiResponse.ok) {
        text = geminiPayload?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join("")
          .trim();
        if (text) break;
        continue;
      }
      if (geminiResponse.status === 400 || geminiResponse.status === 401 || geminiResponse.status === 403) {
        console.error("[admin-product-ai-fill] Gemini", geminiResponse.status, JSON.stringify(geminiPayload).slice(0, 800));
        return errorResponse(`Gemini recusou a consulta (HTTP ${geminiResponse.status})`, 502);
      }
    }
    if (text) break;
    console.error("[admin-product-ai-fill] modelo indisponivel", lastModel, lastStatus);
  }
  if (!text) return errorResponse("Gemini nao devolveu classificacao", 502);

  let decoded: { suggestions?: Array<Record<string, unknown>> };
  try {
    decoded = JSON.parse(text.replace(/^```json\s*/i, "").replace(/\s*```$/, ""));
  } catch (error) {
    console.error("[admin-product-ai-fill] JSON", error, text.slice(0, 500));
    return errorResponse("Gemini devolveu uma classificacao invalida", 502);
  }

  const requestedIds = new Set(products.map((product) => product.id));
  const suggestions = (decoded.suggestions || [])
    .filter((suggestion) => requestedIds.has(String(suggestion.productId || "")))
    .map((suggestion) => {
      const confidence = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));
      const trusted = confidence >= 0.65;
      const leafCategoryIds = trusted && Array.isArray(suggestion.categoryIds)
        ? suggestion.categoryIds.map(String).filter((id) => allowedCategoryIds.has(id))
        : [];
      const categoryIds = unique(leafCategoryIds.flatMap((id) => categoryAncestors(id, categoryById)));
      const brandId = trusted && suggestion.brandId && allowedBrandIds.has(String(suggestion.brandId))
        ? String(suggestion.brandId)
        : null;
      const validAttributes = trusted && Array.isArray(suggestion.attributes)
        ? suggestion.attributes.filter((attribute: unknown): attribute is { attr_key: string; attr_value: string } => {
            if (!attribute || typeof attribute !== "object") return false;
            const item = attribute as Record<string, unknown>;
            return allowedAttributePairs.has(`${String(item.attr_key || "")}\u0000${String(item.attr_value || "")}`);
          })
        : [];
      const seenPairs = new Set<string>();
      const cleanAttributes = validAttributes.filter((attribute) => {
        const pair = `${attribute.attr_key}\u0000${attribute.attr_value}`;
        if (seenPairs.has(pair)) return false;
        seenPairs.add(pair);
        return true;
      });
      return {
        productId: String(suggestion.productId),
        categoryIds,
        rootCategoryId: null,
        brandId,
        attributes: cleanAttributes,
        confidence,
        evidenceUrl: typeof suggestion.evidenceUrl === "string" ? suggestion.evidenceUrl.slice(0, 1000) : null,
      };
    });

  return jsonResponse({ ok: true, version: FUNCTIONS_VERSION, model: lastModel, suggestions });
});
