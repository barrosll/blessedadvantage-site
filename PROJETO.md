# Welabb — Loja online de impressão 3D

Documento de referência do projeto: o que já está feito, como funciona, como usar, como publicar e o que falta.
Última atualização: 2 de outubro de 2026.

> **Segurança:** este documento está no GitHub (repositório público). Nunca escrever aqui chaves da Stripe,
> passwords ou tokens. Esses valores ficam apenas no ficheiro `.env` (local, ignorado pelo Git) e nas
> variáveis de ambiente da Netlify.

---

## 1. Resumo e estado atual

| Item | Estado |
|---|---|
| Loja (galeria, categorias, filtros, produto, carrinho) | ✅ Pronta |
| Área de gestão `/admin` (produtos, fotos, preços, cores, portes, imagens do site) | ✅ Pronta |
| Pagamentos Stripe (cartão, MB WAY, Klarna…) | ✅ Testado em modo de teste |
| Multibanco | ⏳ Ativar no painel da Stripe |
| Encomendas com número (WLB-1001…), página do cliente, gestão de estados | ✅ Pronto e testado |
| Emails automáticos (confirmação e "a caminho") | ⏳ Falta configurar o Resend |
| Envio Sendcloud: CTT/InPost, pontos de recolha, etiquetas (lote), tracking, emails | ✅ Pronto e testado em simulação · ⏳ falta conta Sendcloud |
| Formulários (orçamento personalizado, newsletter 10%) | ⏳ Funcionam só depois de publicar |
| Modo manutenção ("Voltamos em breve") | ✅ Pronto |
| Publicação na Netlify + domínio | ⏳ Por fazer |
| Fatura certificada (InvoiceXpress/Moloni) | ⏳ Fase seguinte |

- **Pasta do projeto:** `C:\Users\LOHAN\blessedadvantage-site`
- **Código:** https://github.com/barrosll/blessedadvantage-site (ramo `main`)
- **Alojamento previsto:** Netlify (o mesmo dos outros sites)

---

## 2. Marca e domínio

- **Marca:** Welabb — logo com o bico da impressora e filamento verde-lima.
- **Cores:** preto `#0a0a0a`, fundo `#f4f4f4`, verde-lima `#d4e000` (botões), verde do logo `#84cc00`.
- **Letras:** Inter Tight (títulos), Inter (texto), JetBrains Mono (etiquetas técnicas).
- **Domínio principal:** `welabb.pt` (já registado). Emails da loja: `encomendas@welabb.pt`.
- **Domínio secundário:** `blessedadvantage.pt` (registado até **17/11/2026**) — redireciona para welabb.pt.
  Os registos DNS dele ainda apontam para uma plataforma antiga (Cloudflare) e serão trocados na publicação.

---

## 3. O que o cliente vê (a loja)

Página única com secções:

1. **Hero** — "PRECISÃO ARTESANAL.", imagem da impressora, botões *Explorar colecção* e *Encomenda personalizada*.
2. **Categorias** — Decoração, Casa & Organização, Presentes, Personalizados (com nº real de peças; clicar filtra a loja).
3. **Loja** — todas as peças, com filtros por categoria. Produtos sem preço aparecem como **"Em breve"**.
4. **O processo** — Modelação → Impressão → Acabamento.
5. **Personalizados** — formulário de pedido de orçamento (nome, email, descrição, imagem/ficheiro 3D opcional).
6. **Newsletter** — "10% na tua primeira peça" (recolhe o email).
7. **Rodapé** — contacto, navegação, produção.

**Detalhe de um produto:**
- Galeria de fotos (miniaturas para trocar).
- **Opção** (ex.: Pequeno · 15 cm / Grande · 25 cm), cada uma com o seu preço.
- **Cor**, com amostra de cor.
- **Personalizado** (se o produto permitir): abre o campo **"Nota de personalização"** (até 300 caracteres, obrigatório).
- O carrinho mostra opção, cor e nota; fica guardado no browser se o cliente fechar a página.

**Depois de pagar:**
- Página **"Obrigado pela tua compra!"** com o número da encomenda e o botão **Acompanhar encomenda**.
- Página **"A minha encomenda"** (`/encomenda.html?t=…`, link secreto enviado por email):
  progresso *Paga → Em produção → Enviada → Entregue*, entrega prevista, código CTT e botão *Seguir nos CTT*.
  Não é preciso criar conta nem password.

---

## 4. Área de gestão (`/admin.html`)

Protegida por password (`ADMIN_PASSWORD`). Dois separadores:

### Encomendas
- Lista com filtro (por tratar, pagas, em produção, enviadas…). O número no separador mostra quantas estão por tratar.
- Cada encomenda mostra: peças, opção, cor, **nota de personalização em destaque**, totais, morada, email, telefone, NIF.
- **Mudar estado** (Paga, Em produção, Enviada, Entregue, Cancelada).
- **Enviada:** exige o código CTT → o cliente recebe automaticamente o email "Está a caminho" com o link de seguimento.
- **Reenviar email de confirmação** e **Ver página do cliente**.
- Avisos a vermelho se o email ou o Sendcloud falharem.

### Produtos e site
- **Produtos:** nome, categoria, descrição, várias fotos (★ = principal), visível/escondido, ordem (↑ ↓).
  - **Variações e preços:** nome, preço (€), peso (kg — usado na etiqueta).
  - **Cores:** nome + amostra.
  - **Aceita pedido personalizado** (ativa a opção "Personalizado" com nota).
  - "Copiar variações e cores de…" outro produto.
- **Imagens do site:** trocar a imagem do topo (hero) e da secção "O processo".
- **Portes de envio:** nome, preço, grátis a partir de X €, prazo CTT e **prazo de produção** (dias úteis — usados para calcular a data prevista de entrega).

As fotos são reduzidas automaticamente antes de serem enviadas. Tudo fica visível na loja assim que se guarda.

### Produtos atuais
13 produtos com fotos, **sem nome e sem preço** (aparecem como "Em breve") — preencher na gestão depois de publicar.
Os produtos 04 (logo F1) e 08 (Batman) estão **escondidos** — ver ponto 12.

---

## 5. Pagamentos (Stripe)

- Conta Stripe criada: **WELABB** (por agora em **ambiente de teste / "Área restrita"**).
- O checkout é a página da Stripe, em português, e pede: morada (só Portugal), **telemóvel** (para a etiqueta), **NIF** (opcional), e aceita **códigos de desconto**.
- Os preços são sempre calculados no servidor — o cliente não consegue alterá-los.
- Em cada linha da encomenda, a Stripe guarda: produto, opção, cor e **nota** (visível em *Transações*).
- Métodos ativos no teste: cartão, **MB WAY**, Klarna, Link, Amazon Pay, Bancontact, EPS, Satispay.

**A fazer no painel da Stripe:**
1. Definições → Pagamentos → Métodos de pagamento: **ativar Multibanco**; desativar Bancontact e EPS.
2. Criar o código de desconto da newsletter (ex.: `BEMVINDO10`, 10%, 1 uso por cliente).
3. Antes de abrir a loja: **ativar a conta** (dados da empresa/NIF, IBAN) e trocar para as chaves de produção (`sk_live_…`).

**Testes:** cartão `4242 4242 4242 4242`, data futura, CVC `123` (aprovado) · `4000 0000 0000 0002` (recusado).
Teste real já feito com sucesso: 24,40 € (dragão 19,90 € + CTT 4,50 €).

---

## 6. Encomendas e emails

**Fluxo automático quando um pagamento é confirmado** (webhook da Stripe):
1. Cria a encomenda **WLB-XXXX** — uma só por pagamento, mesmo com avisos repetidos ou simultâneos
   (reserva da sessão + identificador da encomenda derivado do pagamento).
2. Cria o envio na **Sendcloud** (etiqueta + tracking) — nunca duplica: usa o nº WLB como referência única na Sendcloud.
3. Envia o **email de confirmação** ao cliente e o aviso **"Nova encomenda paga"** para `ADMIN_ORDER_EMAIL`.
Se a Sendcloud ou o email falharem, a encomenda **fica paga** e o erro aparece na gestão (com "Tentar novamente").

Multibanco: a encomenda só é criada quando o cliente paga a referência.

**Estados:** Paga → Em produção → Preparada → Enviada → Em trânsito → Disponível para recolha (só ponto) → Entregue
(+ Cancelada, Devolvida). O tracking da Sendcloud nunca faz a encomenda "andar para trás".

**Emails (Resend) — cada um enviado automaticamente uma só vez** (data gravada na encomenda; reenviar é manual na gestão):
1. *Pagamento confirmado — Encomenda WLB-XXXX* (produtos, opção, cor, personalização, totais, entrega, ponto, data prevista)
2. *A tua encomenda WLB-XXXX está a caminho* (transportadora, tracking, destino) — quando passa a Enviada/Em trânsito
3. *A tua encomenda WLB-XXXX já pode ser levantada* — só ponto de recolha
4. *A tua encomenda WLB-XXXX foi entregue*
5. *Nova encomenda paga — WLB-XXXX* — para a loja

**A fazer:**
1. Criar conta em resend.com → *Domains → Add domain* → `welabb.pt` → registos DNS indicados pelo Resend.
2. *API Keys → Create* → `RESEND_API_KEY`. Definir `EMAIL_FROM`, `EMAIL_REPLY_TO` e `ADMIN_ORDER_EMAIL`.

---

## 7. Envio, pontos de recolha, etiquetas e tracking (Sendcloud — CTT e InPost)

Tudo passa pelo módulo `netlify/lib/sendcloud.mjs` (**API v3** — a v2 de criação de envios está fechada a contas
criadas depois de 13/04/2026). As chaves Sendcloud ficam só no servidor.

**Cliente (carrinho):** escolhe o método de entrega (só os ativos), e — se for InPost/CTT ponto — o **ponto de recolha**
(pesquisa por código postal, localidade ou localização). Vê Produtos + Portes = Total. O botão Pagar só funciona com
ponto escolhido. O servidor valida o ponto na Sendcloud e recalcula preços, portes e peso (variante × quantidade + embalagem).

**Gestão → Produtos e site → Envio:** métodos (nome, transportadora, código Sendcloud, preço, grátis a partir de, prazo,
ponto de recolha, ativo), "Carregar opções da Sendcloud" (mostra códigos e custo contratual), prazo de produção e
**morada do remetente** (obrigatória para as etiquetas).

**Gestão → Encomendas:** seleção múltipla → **Imprimir N etiquetas** (PDF A6 da Sendcloud, grupos de 20, juntos num só PDF;
relatório de falhas com os números WLB), etiqueta individual, abrir/atualizar tracking, reenviar cada email,
**⚠ ENVIO NÃO CRIADO → Tentar novamente** (nunca cria um segundo envio), cancelar (cancela o envio na Sendcloud
quando possível; **o reembolso faz-se na Stripe**).

**Tracking automático:** webhook `https://<domínio>/api/sendcloud-webhook` (assinatura `Sendcloud-Signature` verificada).
Alternativa: botão "Atualizar tracking" (consulta a Sendcloud).

**A fazer na Sendcloud:**
1. Criar conta; ativar CTT e InPost (Portugal); *Settings → Integrations* → criar integração **API** (chaves pública e secreta).
2. Na integração: ativar **service points** (CTT/InPost) e o **webhook** com o URL acima.
3. Na gestão: preencher a morada do remetente, "Carregar opções da Sendcloud", aplicar códigos, definir preços e ativar.
4. Fazer um envio de teste e confirmar a etiqueta e os estados de tracking (os IDs de estado confirmados na documentação
   são 1000, 11 e 2000; os restantes são reconhecidos pela mensagem — confirmar com a conta real).

---

## 8. Modo manutenção

- Com `MAINTENANCE_MODE=1`, todas as páginas da loja mostram **"Voltamos em breve"** com o logo Welabb.
- Continuam a funcionar: gestão, imagens, páginas de encomenda e de agradecimento.
- **Pagamentos bloqueados** durante a manutenção.
- Para abrir a loja: apagar a variável (ou pôr outro valor) e voltar a publicar.

---

## 9. Estrutura técnica

Site em HTML/CSS/JS simples (sem framework) + funções da Netlify. Dados e fotos no **Netlify Blobs**.

```
public/                      Site (o que é publicado)
  index.html, app.js         Loja
  styles.css                 Estilos (cores, letras, layout)
  admin.html, admin.js       Área de gestão
  encomenda.html/.js         "A minha encomenda"
  sucesso.html               Página "Obrigado"
  manutencao.html            "Voltamos em breve"
  images/                    Logos, favicon, hero, fotos dos produtos
netlify/functions/
  catalog.mjs                /api/catalog — catálogo público
  checkout.mjs               /api/checkout — cria o pagamento na Stripe
  stripe-webhook.mjs         /api/stripe-webhook — pagamento confirmado → encomenda, Sendcloud, emails
  sendcloud-webhook.mjs      /api/sendcloud-webhook — tracking automático
  service-points.mjs         /api/service-points — pesquisa de pontos de recolha
  order.mjs                  /api/order — dados da encomenda para o cliente
  admin.mjs                  /api/admin/* — gestão (protegida por password)
  image.mjs                  /img/… — fotos carregadas na gestão
netlify/edge-functions/
  maintenance.js             Modo manutenção
netlify/lib/
  catalog.mjs                Catálogo: validação, categorias, cores, métodos de envio, remetente
  orders.mjs                 Encomendas: guardar, numerar (atómico), estados, idempotência
  sendcloud.mjs              TODAS as chamadas à Sendcloud (API v3)
  fulfillment.mjs            Envio Sendcloud, tracking e emails (uma vez cada)
  emails.mjs                 Modelos dos 5 emails
  mailer.mjs                 Envio pelo Resend
products.json                Catálogo inicial (usado até à 1ª gravação na gestão)
netlify.toml                 Configuração da Netlify
```

**Atenção:** o que se grava na gestão **localmente** fica só no computador; no site publicado começa-se
a partir de `products.json`. Preencher nomes e preços **depois de publicar**.

---

## 10. Variáveis de ambiente

Definir na Netlify em *Site configuration → Environment variables* (e no `.env` local para testes).

| Variável | Para quê | Obrigatória |
|---|---|---|
| `ADMIN_PASSWORD` | Password da gestão (mín. 12 caracteres) | Sim |
| `STRIPE_SECRET_KEY` | Chave secreta da Stripe (`sk_test_…` / `sk_live_…`) | Sim |
| `STRIPE_WEBHOOK_SECRET` | Segredo do webhook (`whsec_…`) | Sim |
| `MAINTENANCE_MODE` | `1` = loja fechada ("Voltamos em breve") | Não |
| `RESEND_API_KEY` | Chave do Resend (`re_…`) | Para emails |
| `EMAIL_FROM` | Remetente, ex.: `Welabb <encomendas@welabb.pt>` | Não |
| `EMAIL_REPLY_TO` | Email que recebe as respostas dos clientes | Recomendado |
| `ADMIN_ORDER_EMAIL` | Recebe o aviso "Nova encomenda paga" | Recomendado |
| `PACKAGE_WEIGHT_KG` | Peso da embalagem somado a cada envio (ex.: `0.15`) | Não |
| `SENDCLOUD_PUBLIC_KEY` / `SENDCLOUD_SECRET_KEY` | Chaves da integração API da Sendcloud | Para envios/pontos/etiquetas |
| `SENDCLOUD_WEBHOOK_SECRET` | Só se a integração tiver uma "Webhook signature key" própria | Não |

O `SENDCLOUD_SHIPPING_METHOD_ID` antigo deixou de ser usado: na API v3 cada método tem o seu código Sendcloud na gestão.
Modelo completo (sem valores): `.env.example`. Só para testes locais: `SENDCLOUD_MOCK=1`, `EMAIL_MOCK=1` (ignorados no site publicado).

---

## 11. Como correr no computador

Requisitos (já instalados): Node.js 24 e Netlify CLI.

```powershell
cd C:\Users\LOHAN\blessedadvantage-site
netlify dev --offline --port 8888
```

- Loja: http://localhost:8888
- Gestão: http://localhost:8888/admin.html (password do `.env`)
- No telemóvel (mesma rede Wi-Fi): é preciso uma "ponte" para a porta 8890 e abrir essa porta na firewall
  do Windows (regra só para a rede local, criada numa PowerShell de administrador).

---

## 12. Como publicar (passo a passo)

1. **Netlify:** app.netlify.com → *Sign up with GitHub* → *Add new site → Import from GitHub* → `blessedadvantage-site` → *Deploy* (sem mudar nada).
2. **Variáveis:** adicionar as do ponto 10 (começar com `MAINTENANCE_MODE=1` para preparar a loja com calma).
3. **Webhook da Stripe:** *Programadores → Webhooks → Adicionar endpoint* →
   `https://welabb.pt/api/stripe-webhook`, eventos `checkout.session.completed` e
   `checkout.session.async_payment_succeeded` → copiar o `whsec_…` para `STRIPE_WEBHOOK_SECRET`.
   **Webhook da Sendcloud:** na integração API, ativar o webhook com `https://welabb.pt/api/sendcloud-webhook`.
4. **Domínios:** na Netlify, *Domain management → Add domain* → `welabb.pt` (definir como **principal**) e depois
   `blessedadvantage.pt` como **alias** (redireciona automaticamente para welabb.pt).
   - No painel DNS de **welabb.pt**: **A** `welabb.pt` → `75.2.60.5` e **CNAME** `www` → `<nome-do-site>.netlify.app`.
   - No painel DNS de **blessedadvantage.pt**: apagar os 2 **A** antigos (104.19.x.x), o **CNAME** para ele próprio,
     `_acme-challenge` e `_cf-custom-hostname`; adicionar os mesmos **A** e **CNAME www**.
   - Confirmar os valores exatos que a Netlify mostrar. Não apagar registos **MX/TXT** de email de welabb.pt, se existirem.
5. Preencher produtos (nome, preço, cores) e imagens do site na gestão publicada.
6. Fazer uma compra de teste completa no site publicado (cartão `4242…`).
7. Ativar a conta Stripe, trocar para chaves `sk_live_…` e atualizar o webhook.
8. Apagar `MAINTENANCE_MODE` → **loja aberta**.

---

## 13. Pendentes (lista de tarefas)

**Antes de abrir a loja**
- [x] Publicar na Netlify e ligar o domínio (welabb.pt, HTTPS ativo — 02/10/2026; conta lohanbarros970, equipa ESTRELA, projeto "welabb")
- [ ] Password forte para a gestão (`ADMIN_PASSWORD`)
- [ ] Ativar Multibanco na Stripe; desativar Bancontact e EPS
- [ ] Configurar Resend (domínio + chave), `EMAIL_REPLY_TO` e `ADMIN_ORDER_EMAIL`
- [ ] Sendcloud: conta, CTT + InPost, integração API, service points, webhook, morada do remetente, métodos e preços na gestão
- [ ] Envio de teste real (etiqueta + tracking) antes de abrir
- [ ] Preencher nomes, preços, cores e descrições dos 13 produtos
- [ ] Foto do processo em boa qualidade (mín. 1600 px de largura) e, se possível, a imagem original do hero
- [ ] Identificação do vendedor no rodapé (nome/empresa, NIF, morada) — obrigatório em Portugal
- [ ] Páginas legais: Termos e Condições, Política de Privacidade, Política de Devoluções, Livro de Reclamações Eletrónico
- [ ] Ativar a conta Stripe e passar para modo real
- [ ] Renovar `blessedadvantage.pt` antes de 17/11/2026

**A seguir**
- [ ] Escolha de cacifo InPost no checkout
- [ ] Fatura certificada automática (InvoiceXpress ou Moloni) — confirmar com o contabilista
- [ ] Envio automático do código de 10% aos subscritores (ex.: Brevo/Mailchimp)
- [ ] Notificação por email dos pedidos de orçamento e newsletter (Netlify Forms)
- [ ] Caixa de email `ola@welabb.pt` (ex.: reencaminhamento no registo do domínio, Zoho Mail ou Google Workspace)
- [ ] Secção de testemunhos — **só com avaliações reais de clientes**

---

## 14. Avisos importantes

- **Marcas registadas:** os produtos com o logo **F1** e o **Batman** estão escondidos. Vendê-los sem licença
  pode dar problemas legais e a Stripe pode bloquear a conta e reter pagamentos.
- **Testemunhos:** não usar avaliações inventadas (proibido na UE — Diretiva Omnibus).
- **Faturação:** em Portugal cada venda precisa de fatura emitida por software certificado pela AT.
- **Afirmações no site:** "resolução 0.12mm", "PLA+" — confirmar que correspondem à realidade.
- **Segurança (outro projeto):** o repositório `veteranos-atalaia-site-repo` tem um **token do GitHub em texto simples**
  no endereço do repositório. Revogar o token em GitHub → Settings → Developer settings e trocar o endereço.

---

## 15. Histórico

| Data | O quê |
|---|---|
| 29/09/2026 | Loja inicial, carrinho, checkout Stripe, webhook Sendcloud |
| 29/09/2026 | Área de gestão; site passa a impressão 3D com 13 produtos |
| 29/09/2026 | Nova marca **Welabb** e redesign completo |
| 29/09/2026 | Imagens do site editáveis; cores por produto e opção Personalizado com nota |
| 29/09/2026 | Conta Stripe de teste ligada; 1.ª compra de teste com sucesso |
| 29/09/2026 | Encomendas, emails, página do cliente, gestão de encomendas |
| 29/09/2026 | Modo manutenção "Voltamos em breve" |
| 02/10/2026 | Envio Sendcloud v3: métodos, pontos de recolha InPost/CTT, etiquetas em lote, tracking automático, 5 emails |
