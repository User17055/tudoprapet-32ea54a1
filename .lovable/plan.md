

## Plano: Login via Shopify (Customer Account API)

### Contexto

O Shopify oferece login de clientes nativamente via Storefront API usando a mutation `customerAccessTokenCreate`. Isso permite login com email/senha de clientes cadastrados na loja Shopify, sem precisar de Supabase ou outro backend.

### Como funciona

O Shopify Storefront API tem mutations para:
- **Login**: `customerAccessTokenCreate` (email + senha → token)
- **Cadastro**: `customerCreate` (cria conta de cliente na loja)
- **Perfil**: `customer` query (busca dados do cliente logado)
- **Logout**: Limpar o token localmente

O token retornado é armazenado no localStorage e usado para consultas autenticadas.

### Etapas

#### 1. Adicionar queries/mutations Shopify para clientes
- Arquivo: `src/lib/shopify.ts`
- Adicionar mutations: `customerCreate`, `customerAccessTokenCreate`, `customerAccessTokenDelete`
- Adicionar query: `customer` (com token de acesso)
- Criar funções helper: `shopifyLogin()`, `shopifyRegister()`, `shopifyGetCustomer()`

#### 2. Criar contexto de autenticação Shopify
- Novo arquivo: `src/contexts/ShopifyAuthContext.tsx`
- Gerenciar estado: token, dados do cliente, loading
- Persistir token no localStorage
- Verificar validade do token ao carregar a página

#### 3. Criar páginas de Login e Cadastro
- `src/pages/Login.tsx` — formulário email/senha, design alinhado à marca
- `src/pages/Register.tsx` — formulário de cadastro com nome, email, senha
- Design com a logo da loja e cores da marca (azul/amarelo)

#### 4. Criar página de Perfil
- `src/pages/Profile.tsx` — exibir dados do cliente (nome, email), botão de logout

#### 5. Atualizar Header e rotas
- `src/components/Header.tsx` — botão de perfil: se logado → `/perfil`, se não → `/login`; trocar ícone PawPrint pela logo
- `src/App.tsx` — adicionar rotas `/login`, `/cadastro`, `/perfil` e wrapping com `ShopifyAuthProvider`

#### 6. Melhorias visuais + logo
- Substituir `PawPrint` pela logo enviada (`src/assets/logo.png`) no Header e Footer
- Ajustes visuais gerais nas cores para combinar com a logo

### Arquivos afetados
| Arquivo | Ação |
|---|---|
| `src/lib/shopify.ts` | Adicionar mutations/queries de cliente |
| `src/contexts/ShopifyAuthContext.tsx` | Novo — contexto de auth Shopify |
| `src/pages/Login.tsx` | Novo |
| `src/pages/Register.tsx` | Novo |
| `src/pages/Profile.tsx` | Novo |
| `src/components/Header.tsx` | Logo + botão perfil funcional |
| `src/components/Footer.tsx` | Logo |
| `src/App.tsx` | Novas rotas + AuthProvider |
| `src/assets/logo.png` | Novo — logo da loja |

### Observação importante
O login Shopify funciona apenas para clientes já cadastrados na loja. A página de cadastro cria a conta do cliente diretamente no Shopify, onde o lojista pode ver todos os clientes no painel admin.

