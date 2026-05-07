# Refinar Página de Produto

Vamos deixar a página de detalhe do produto (`src/pages/ProductDetail.tsx`) mais organizada e parecida com as referências enviadas, mantendo a identidade da TudoPraPet (azul marinho da marca, não o azul do Defenza — esse é só inspiração de organização).

## O que muda

### 1. Galeria desktop — fim do scroll feio nas miniaturas
Hoje as miniaturas têm `max-h-[500px] overflow-y-auto`, o que mostra uma barra de scroll vertical desagradável quando há muitas imagens.

Substituir por uma coluna de miniaturas com:
- Tamanho um pouco menor e espaçamento consistente
- Setas ▲ ▼ no topo e na base (visíveis só quando há overflow) para navegar
- `overflow: hidden` (sem barra de scroll nativa)
- Scroll programático suave ao clicar nas setas
- Miniatura selecionada com borda azul marinho da marca + leve sombra

### 2. Imagem principal
- Manter fundo branco e bordas arredondadas (já está)
- Garantir `object-contain` com padding para a foto respirar
- Badges (`25% OFF`, `Imagens ilustrativas`) com estilo mais clean, alinhados como nas referências

### 3. Coluna de compra (buy box)
- Manter o botão **Comprar agora** (conforme pedido)
- Manter bloco de preço atual + preço de assinante com a coroa
- Pequenos ajustes de espaçamento para ficar mais "respirado" como na referência
- Card "Assine pra não faltar" mantido com a borda azul clara (já está bom)

### 4. Mobile
- Carrossel já está OK; só pequenos ajustes nos dots e badges para combinar visualmente.

## Arquivo afetado
- `src/pages/ProductDetail.tsx` (somente apresentação/CSS — sem mudanças de lógica, dados ou checkout)

## Detalhes técnicos
- Usar `useRef` na coluna de miniaturas para fazer `scrollBy({ top: ±height, behavior: 'smooth' })` ao clicar nas setas
- Detectar overflow com `scrollHeight > clientHeight` para decidir se mostra as setas
- Cores via tokens semânticos do design system (primary = azul marinho da marca), sem cores hardcoded
- Sem mudanças em `shopify.ts`, stores, ou edge functions

Confirma que é só ajuste visual da página de produto (sem mexer em filtro/catálogo)?
