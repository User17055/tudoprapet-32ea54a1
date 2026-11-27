import { describe, expect, it } from "vitest";
import {
  buildSearchVocabulary,
  productSearchFields,
  relevantTerms,
  searchProducts,
  searchProductsDetailed,
  searchTokens,
  suggestSearchCorrection,
} from "@/lib/productSearch";

// Titulos no formato real da loja (10/2026), inclusive os em caixa alta abreviados.
const catalog = [
  { title: "Ração Golden Gatos Adultos Castrados Salmão 1 Kg", vendor: "Golden", categories: ["Gato", "Ração"] },
  { title: "Ração Golden Gatos Filhotes Frango 10,1kg", vendor: "Golden", categories: ["Gato", "Ração"] },
  { title: "Ração Golden Fórmula Cão Filhote Frango e Arroz 15 kg", vendor: "Golden", categories: ["Cachorro", "Ração"] },
  { title: "Ração Golden Fórmula Mini Bits Sênior Frango e Arroz 10 kg", vendor: "Golden", categories: ["Cachorro", "Ração"] },
  { title: "Ração Premier Ambientes Internos para Cães Adultos Sabor Frango 1 kg", vendor: "Premier", categories: ["Cachorro", "Ração"] },
  { title: "PREM CAT CASTRADO 10KG", vendor: "Premier", categories: [] },
  { title: "Túnel Y para Gatos", vendor: "Chalesco", categories: ["Gato", "Brinquedos"] },
  { title: "Banni 3 Gato 0,30 ml", vendor: "Banni", categories: ["Gato", "Farmácia"] },
  { title: "Areia Sílica para Gatos Western Grossa 1,5 kg", vendor: "Western", categories: ["Gato", "Areias"] },
  { title: "Areia Kets 4 kg", vendor: "Kets", categories: ["Gato", "Areias"] },
  { title: "Antipulgas e Carrapatos Bravecto 500 mg Cães 10 a 20 kg", vendor: "MSD", categories: ["Cachorro", "Farmácia"] },
  { title: "Antipulgas e Carrapatos Bravecto 250 mg Cães 4,5 a 10 kg", vendor: "MSD", categories: ["Cachorro", "Farmácia"] },
  { title: "BUDOPET MOELA DE FRANGO 80GR", vendor: "Budopet", categories: ["Cachorro", "Petiscos"] },
];
const fields = (product: (typeof catalog)[number]) =>
  productSearchFields({ title: product.title, vendor: product.vendor, categoryNames: product.categories });
const search = (query: string) => searchProducts(query, catalog, fields).map((product) => product.title);

describe("tokens", () => {
  it("separa numero de unidade e mantem o decimal inteiro", () => {
    expect(searchTokens("Golden 10,1kg")).toEqual(["golden", "10.1", "kg"]);
    expect(searchTokens("MOELA 80GR")).toEqual(["moela", "80", "gr"]);
  });

  it("descarta palavra vazia de sentido, mas mantem numero e unidade", () => {
    expect(relevantTerms("ração para cachorro de 10 a 20 kg")).toEqual(["racao", "cachorro", "10", "20", "kg"]);
  });
});

describe("todas as palavras precisam casar", () => {
  it("ração gato nao traz ração de cachorro nem brinquedo de gato", () => {
    const found = search("racao gato");
    expect(found).toContain("Ração Golden Gatos Adultos Castrados Salmão 1 Kg");
    expect(found).not.toContain("Ração Golden Fórmula Cão Filhote Frango e Arroz 15 kg");
    expect(found).not.toContain("Túnel Y para Gatos");
  });

  it("areia gato traz so areia", () => {
    expect(search("areia gato")).toEqual(expect.arrayContaining(["Areia Kets 4 kg", "Areia Sílica para Gatos Western Grossa 1,5 kg"]));
    expect(search("areia gato")).not.toContain("Banni 3 Gato 0,30 ml");
  });

  it("palavras em campos diferentes ainda somam (marca + categoria)", () => {
    expect(search("golden cachorro")).toEqual(expect.arrayContaining([
      "Ração Golden Fórmula Cão Filhote Frango e Arroz 15 kg",
      "Ração Golden Fórmula Mini Bits Sênior Frango e Arroz 10 kg",
    ]));
  });
});

describe("numeros", () => {
  it("numero so casa com o mesmo numero", () => {
    expect(search("bravecto 10 a 20kg")).toEqual(["Antipulgas e Carrapatos Bravecto 500 mg Cães 10 a 20 kg"]);
    expect(search("bravecto 10 a 20kg")).not.toContain("PREM CAT CASTRADO 10KG");
  });

  it("decimal nao vira dois numeros", () => {
    expect(search("golden 1 kg")).toEqual(["Ração Golden Gatos Adultos Castrados Salmão 1 Kg"]);
    expect(search("areia 1,5 kg")).toEqual(["Areia Sílica para Gatos Western Grossa 1,5 kg"]);
  });

  it("10kg acha o 10 exato antes do 10,1", () => {
    const found = search("golden 10kg");
    expect(found[0]).toBe("Ração Golden Fórmula Mini Bits Sênior Frango e Arroz 10 kg");
    expect(found).toContain("Ração Golden Gatos Filhotes Frango 10,1kg");
  });

  it("unidade abreviada casa com a escrita por extenso", () => {
    expect(search("moela 80g")).toEqual(["BUDOPET MOELA DE FRANGO 80GR"]);
  });
});

describe("sinonimos e erros de digitacao", () => {
  it("cachorro acha os titulos que dizem Cães", () => {
    expect(search("antipulga cachorro")).toHaveLength(2);
  });

  it("cat e felino valem gato", () => {
    expect(search("premier cat")).toEqual(["PREM CAT CASTRADO 10KG"]);
    expect(search("areia felino")).toHaveLength(2);
  });

  it("tolera erro de digitacao, inclusive no sinonimo", () => {
    expect(search("bravceto")).toHaveLength(2);
    expect(search("antipulga cachoro")).toHaveLength(2);
    expect(search("racão gato fihote")).toEqual(["Ração Golden Gatos Filhotes Frango 10,1kg"]);
  });

  it("texto sem sentido nao traz nada", () => {
    expect(search("jdkamkeasld")).toEqual([]);
  });
});

describe("relevancia", () => {
  it("frase no titulo vem antes de palavras espalhadas", () => {
    expect(search("areia kets")[0]).toBe("Areia Kets 4 kg");
  });

  it("busca em branco devolve a lista inteira na ordem original", () => {
    expect(search("  ")).toEqual(catalog.map((product) => product.title));
    expect(search("de para")).toEqual(catalog.map((product) => product.title));
  });
});

describe("voce quis dizer", () => {
  const vocabulary = buildSearchVocabulary(catalog.map(fields));

  it("corrige o termo que nao existe na loja", () => {
    expect(suggestSearchCorrection("arreia", vocabulary)).toBe("areia");
  });

  it("nao sugere quando todos os termos existem ou sao sinonimos", () => {
    expect(suggestSearchCorrection("racao cachorro", vocabulary)).toBeNull();
  });
});

// Casos medidos no catalogo real em 11/2026 (573 produtos a venda).
const store = [
  { title: "Fator Cólica Glóbulos 26 g", vendor: "Homeopet", categories: ["Homeopáticos e Florais"] },
  { title: "Snack Dental Cães Adultos 90 g", vendor: "Keldog", categories: ["Cachorro", "Petiscos"] },
  { title: "Ração Golden Mega Cães Adultos 15 kg", vendor: "Golden", categories: ["Cachorro", "Ração"] },
  { title: "Suplemento Ômega 3 Cães Gatos Franpet Ômega 1000 30 Cápsulas", vendor: "Franpet", categories: ["Suplementos e Vitaminas"] },
  { title: "Antiparasitário Ourofino WellPet para Cães de 2 a 4,5 kg 45 mg", vendor: "Ourofino", categories: ["Cachorro", "Farmácia"] },
  { title: "Whiskas Sachê Gato Castrado Carne 85 g", vendor: "Whiskas", categories: ["Gato", "Saches"] },
  { title: "Whiskas Lata Atum 290 g", vendor: "Whiskas", categories: ["Gato"] },
  { title: "Kit Cata Caca com Refil", vendor: "Chalesco", categories: ["Higiene"] },
  { title: "Capa Pet para Banco", vendor: "Chalesco", categories: [] },
  { title: "Mordedor Gelado Laranja", vendor: "Chalesco", categories: ["Cachorro"] },
  { title: "Brinquedo Ratinho com 2 un", vendor: "Chalesco", categories: ["Gato"] },
  { title: "Areia Sílica Fina GreatPets 1,6 kg", vendor: "GreatPets", categories: ["Gato", "Areias e Banheiros"] },
  { title: "Ração Premier Cães Adultos 1 kg", vendor: "Premier", categories: ["Cachorro", "Ração"], description: "Não substitui o remédio indicado pelo veterinário." },
  { title: "Acepran Gotas 10 ml", vendor: "Vetnil", categories: ["Demais Medicamentos", "Farmácia"] },
];
type StoreItem = (typeof store)[number] & { description?: string };
const storeFields = (product: StoreItem) => productSearchFields({
  title: product.title, vendor: product.vendor, categoryNames: product.categories, description: product.description,
});
const find = (query: string) => searchProducts(query, store as StoreItem[], storeFields).map((product) => product.title);

describe("sem resultado parecido por engano", () => {
  it("o que a loja nao vende nao vira outro produto", () => {
    expect(find("coleira")).toEqual([]);
    expect(find("drontal")).toEqual([]);
    expect(find("cama")).toEqual([]);
  });

  it("resultado exato esconde o aproximado", () => {
    expect(find("omega")).toEqual(["Suplemento Ômega 3 Cães Gatos Franpet Ômega 1000 30 Cápsulas"]);
  });

  it("palavra so na descricao nao vence a categoria", () => {
    expect(find("remedio")).toContain("Acepran Gotas 10 ml");
    expect(find("remedio")).not.toContain("Ração Premier Cães Adultos 1 kg");
  });

  it("erro de digitacao ainda acha quando nao ha nada exato", () => {
    const result = searchProductsDetailed("whiskaz", store as StoreItem[], storeFields);
    expect(result.items).toHaveLength(2);
    expect(result.approximate).toBe(true);
  });
});

describe("palavras do cliente", () => {
  it("vermifugo acha antiparasitario", () => {
    expect(find("vermifugo")).toEqual(["Antiparasitário Ourofino WellPet para Cães de 2 a 4,5 kg 45 mg"]);
  });

  it("racao umida e pate acham sache e lata", () => {
    expect(find("racao umida gato")).toEqual(expect.arrayContaining(["Whiskas Sachê Gato Castrado Carne 85 g", "Whiskas Lata Atum 290 g"]));
    expect(find("pate gato")).toHaveLength(2);
    expect(find("sache")).toEqual(["Whiskas Sachê Gato Castrado Carne 85 g"]);
  });

  it("brinquedo acha mordedor e areia sanitaria acha areia", () => {
    expect(find("brinquedo")).toEqual(expect.arrayContaining(["Mordedor Gelado Laranja", "Brinquedo Ratinho com 2 un"]));
    expect(find("areia sanitaria")).toEqual(["Areia Sílica Fina GreatPets 1,6 kg"]);
  });
});

describe("palavra que nao existe na loja", () => {
  it("busca sem ela e avisa", () => {
    const result = searchProductsDetailed("whiskas xyzabc", store as StoreItem[], storeFields);
    expect(result.items).toHaveLength(2);
    expect(result.ignoredTerms).toEqual(["xyzabc"]);
  });

  it("nao ignora palavra que existe so porque a combinacao nao existe", () => {
    const result = searchProductsDetailed("whiskas mordedor", store as StoreItem[], storeFields);
    expect(result.items).toEqual([]);
    expect(result.ignoredTerms).toEqual([]);
  });
});

describe("voce quis dizer sem bobagem", () => {
  const vocabulary = buildSearchVocabulary((store as StoreItem[]).map(storeFields));

  it("nao sugere palavra de outra letra ou distante demais", () => {
    expect(suggestSearchCorrection("coleira", vocabulary)).toBeNull();
    expect(suggestSearchCorrection("drontal", vocabulary)).toBeNull();
    expect(suggestSearchCorrection("pate gato", vocabulary)).toBeNull();
  });

  it("ainda corrige erro pequeno", () => {
    expect(suggestSearchCorrection("whiskaz", vocabulary)).toBe("whiskas");
    expect(suggestSearchCorrection("mordedr", vocabulary)).toBe("mordedor");
  });
});
