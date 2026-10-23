# Comandaí

SaaS multi-tenant de gestão de restaurantes: cardápio digital, loja pública com pedidos
reais, acompanhamento de pedido para o cliente e painel administrativo com métricas.

## Stack

- **Frontend**: Next.js 16 (App Router) + TailwindCSS v4 + Zustand + Recharts — `apps/web`
- **Backend**: NestJS + Prisma 7 (driver adapter `@prisma/adapter-pg`) — `apps/api`
- **Banco**: PostgreSQL (Neon)
- **Armazenamento de imagens**: Supabase Storage
- **Monorepo**: pnpm workspaces + Turborepo

## Setup

### 1. Instalar dependências

```bash
pnpm install
```

### 2. Variáveis de ambiente

Copie o `.env.example` da raiz para `apps/api/.env` e `apps/web/.env.local` e preencha os
valores. Todas as variáveis abaixo são **obrigatórias** para `apps/api` — o backend falha
ao subir se qualquer uma delas faltar:

```
# apps/api/.env
DATABASE_URL="postgresql://usuario:senha@ep-xxxx.neon.tech/neondb?sslmode=require"
JWT_SECRET="..."
JWT_EXPIRES_IN="8h"
PORT=3001
CORS_ORIGIN="http://localhost:3000"
SUPABASE_URL="https://seu-projeto.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."
SUPABASE_STORAGE_BUCKET="comandai"
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="..."
GOOGLE_CALLBACK_URL="http://localhost:3001/api/auth/google/callback"
RESEND_API_KEY="..."
RESEND_FROM_EMAIL="Comandaí <onboarding@resend.dev>"
URL_PUBLICA_API="http://localhost:3001/api"
MERCADOPAGO_CLIENT_ID="..."
MERCADOPAGO_CLIENT_SECRET="..."
MERCADOPAGO_ACCESS_TOKEN="..."
MERCADOPAGO_WEBHOOK_SECRET="..."
TOKEN_ENCRYPTION_KEY="..."
```

```
# apps/web/.env.local
NEXT_PUBLIC_API_URL="http://localhost:3001/api"
```

`DATABASE_URL` vem de um projeto gratuito em [neon.tech](https://neon.tech). As credenciais
do Supabase vêm de um projeto em [supabase.com](https://supabase.com) (usadas só para
armazenar imagens de produtos/logo, não como banco). `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
vêm de um OAuth Client "Web application" no
[Google Cloud Console](https://console.cloud.google.com/), com `GOOGLE_CALLBACK_URL` cadastrado
como URI de redirecionamento autorizado. `RESEND_API_KEY`/`RESEND_FROM_EMAIL` vêm de uma conta
em [resend.com](https://resend.com) (em modo sandbox, sem domínio verificado, só entrega
e-mail pro endereço da própria conta). `MERCADOPAGO_CLIENT_ID`/`MERCADOPAGO_CLIENT_SECRET`/
`MERCADOPAGO_ACCESS_TOKEN` vêm de uma aplicação criada em
[developers.mercadopago.com](https://www.mercadopago.com.br/developers) — são credenciais da
*sua* aplicação (plataforma), não de cada restaurante: cada restaurante conecta a própria conta
Mercado Pago pela tela de Configurações, via OAuth. `MERCADOPAGO_WEBHOOK_SECRET` vem da seção
"Webhooks" dessa mesma aplicação. `TOKEN_ENCRYPTION_KEY` é gerada localmente (comando no
`.env.example`) e usada para criptografar os tokens do Mercado Pago de cada restaurante antes
de salvar no banco.

### 3. Migração + seed

```bash
cd apps/api
npx prisma generate
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

O seed cria o restaurante **Brasa & Ponto**, o usuário **vitor@brasaeponto.com / 123456**
(dono), um cardápio de exemplo e pedidos dos últimos 7 dias.

### 4. Rodar em dev

Na raiz do monorepo:

```bash
pnpm turbo run dev
```

- API: http://localhost:3001/api
- Painel: http://localhost:3000 → redireciona para `/login`
- Loja pública de exemplo: http://localhost:3000/loja/brasa-e-ponto

### 5. Rodar os testes

```bash
pnpm --filter api test:e2e
```

Os testes e2e rodam contra o Postgres e o Supabase Storage reais configurados no `.env`
(não há banco/bucket isolado por execução — ver "Limitações conhecidas" abaixo).

## Funcionalidades implementadas

- **Autenticação**: cadastro e login por e-mail/senha, login com Google (conta nova cria
  restaurante automaticamente; e-mail já existente por senha vincula a conta ao Google),
  access token de curta duração (15min) + refresh token revogável com rotação e detecção de
  reuso, autenticação de dois fatores opcional (TOTP + códigos de backup), rate limiting nas
  rotas de auth e globalmente.
- **Cardápio**: CRUD de categorias e produtos, com upload e otimização de fotos.
- **Loja pública**: cardápio digital por slug (`/loja/[slug]`), carrinho, criação de pedido
  real (preço sempre recalculado no backend, idempotente por chave de idempotência),
  acompanhamento de status do pedido pelo cliente (sem precisar de conta), pagamento online
  por Pix ou cartão via Mercado Pago (Checkout Pro) como alternativa a combinar pelo WhatsApp —
  cada restaurante conecta a própria conta Mercado Pago (OAuth) nas Configurações.
- **Painel**: Visão Geral com métricas reais (vendas, ticket médio, canais de venda),
  gestão de Pedidos com atualização em tempo real via WebSocket (transições de status
  validadas), Configurações (identidade visual, logo, endereço, WhatsApp, segurança/2FA).
- **Multi-tenant real**: isolamento por `restauranteId` em todas as queries e nas rooms do
  WebSocket, coberto por testes automatizados.
- **Anti-abuso do teste grátis**: cadastro exige CPF/CNPJ válido e único (um teste por
  documento), e-mail confirmado por link e captcha (Cloudflare Turnstile). Quem entra com
  Google completa o CPF/CNPJ num onboarding. Enquanto houver pendência, o painel abre mas
  ações de escrita ficam bloqueadas (`ContaLiberadaGuard`). Rate limit por IP real (inclusive
  nas chamadas que passam pelo servidor Next, via `INTERNAL_PROXY_SECRET`).
- **Admin da plataforma** (`/admin`): lista/busca restaurantes (nome, e-mail, CPF/CNPJ, IP de
  cadastro), suspende/reativa (loja sai do ar) e estende teste grátis. Para virar admin:
  `UPDATE "Usuario" SET "superAdmin" = true WHERE email = 'seu@email';` direto no banco.
- **Páginas legais**: Política de Privacidade e Termos de Uso (`/privacidade`, `/termos`) —
  conteúdo com placeholders de razão social/CNPJ/e-mail de contato a preencher antes de
  publicar em produção.

## Checklist de produção (cobrança ligada)

- `DESATIVAR_BLOQUEIO_PLANO` **não** pode estar definida no ambiente da API.
- Credenciais **de produção** do Mercado Pago (`MERCADOPAGO_ACCESS_TOKEN`,
  `MERCADOPAGO_WEBHOOK_SECRET`) e webhook cadastrado no painel do Mercado Pago:
  `{URL_PUBLICA_API}/assinaturas/webhook`, tópico `subscription_preapproval`.
- `CORS_ORIGIN` em HTTPS (é a base do `back_url` da assinatura e dos links de e-mail).
- Domínio de envio verificado no Resend (`RESEND_FROM_EMAIL`) — sem isso a confirmação de
  e-mail não chega em ninguém além da própria conta Resend.
- `TURNSTILE_SECRET_KEY` (API), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web) e o mesmo
  `INTERNAL_PROXY_SECRET` nos dois apps.
- Rodar a migration `20261023120000_add_antiabuso_cadastro` (marca os usuários já existentes
  como e-mail verificado e normaliza e-mails para minúsculas — se houver duas contas que só
  diferem em maiúsculas, a migration falha e a duplicata precisa ser resolvida antes).

## CI

O workflow em `.github/workflows/ci.yml` roda lint, build e os testes e2e a cada push/PR
na branch `main`. Ele precisa dos mesmos secrets do `.env.example` cadastrados em
`Settings → Secrets and variables → Actions` no GitHub.

## Estrutura

```
apps/
  api/     NestJS — auth, restaurantes, categorias, produtos, upload, dashboard, pedidos, loja
  web/     Next.js — painel do dono do restaurante + loja pública
packages/
  shared-types/   DTOs compartilhados entre web e api
```

## Limitações conhecidas / próximos passos

- Testes e2e batem em banco/storage reais de desenvolvimento, não em uma instância isolada
  por execução.
- Textos de `/privacidade` e `/termos` têm placeholders (`[RAZÃO SOCIAL]`, `[CNPJ]`,
  `[E-MAIL DE CONTATO]`, `[CIDADE/UF]`) que precisam ser preenchidos antes de publicar.
- Fora de escopo por enquanto: gestão de equipe (convite de outros usuários do restaurante),
  módulo de clientes, relatórios financeiros detalhados, gestão de entregadores,
  deploy/containerização, monitoramento de erros (Sentry), tela de planos/assinatura do
  próprio Comandaí.
