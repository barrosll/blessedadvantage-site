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
| Etiquetas CTT/InPost automáticas (Sendcloud) | ⏳ Falta criar conta e chaves |
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
- **Domínio atual:** `blessedadvantage.pt` (registado até **17/11/2026** — renovar!).
  Os registos DNS ainda apontam para uma plataforma antiga (Cloudflare) e serão trocados na publicação.
- **Plano:** registar `welabb.pt` e mudar para ele mais tarde. A mudança é feita na Netlify
  (domínio principal + redirecionamento do antigo) — o código já está preparado.

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

**Fluxo automático quando um pagamento é confirmado** (aviso "webhook" da Stripe):
1. Cria a encomenda com número sequencial **WLB-1001, WLB-1002…** (sem duplicados se a Stripe repetir o aviso).
2. Calcula a **entrega prevista** em dias úteis: produção (3–5) + CTT (2–4).
3. Envia o **email de confirmação** (agradecimento, produtos com foto, cor e nota, totais, morada, data prevista, botão *Acompanhar encomenda*).
4. Cria o envio no **Sendcloud** (quando configurado).

Multibanco: a encomenda só é criada quando o cliente paga a referência.

**Emails:**
- Serviço: **Resend** (grátis até 3.000/mês).
- Remetente: **"Welabb" &lt;encomendas@blessedadvantage.pt&gt;** (muda para welabb.pt mais tarde só alterando `EMAIL_FROM`).
- Respostas dos clientes vão para `EMAIL_REPLY_TO` (uma caixa de email que se lê de facto).
- Emails prontos: **Confirmação da encomenda** e **"Está a caminho"** (com código CTT).

**A fazer:**
1. Criar conta em resend.com.
2. *Domains → Add domain* → `blessedadvantage.pt` → adicionar os registos DNS que o Resend indicar.
3. *API Keys → Create* → guardar como `RESEND_API_KEY`.
4. Definir `EMAIL_REPLY_TO`.

---

## 7. Envio (Sendcloud — CTT e InPost)

Já programado: ao confirmar o pagamento, cria o envio no Sendcloud com morada, telefone, peso e nº da encomenda.
- Com `SENDCLOUD_SHIPPING_METHOD_ID` definido → a etiqueta é gerada automaticamente.
- Sem ele → a encomenda aparece no painel do Sendcloud para gerar a etiqueta com um clique.

**A fazer:** criar conta Sendcloud, ligar CTT (e InPost, se disponível), criar chaves da API.
Fase seguinte: escolha do **cacifo InPost** no checkout.

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
  stripe-webhook.mjs         /api/stripe-webhook — pagamento confirmado → encomenda, email, Sendcloud
  order.mjs                  /api/order — dados da encomenda para o cliente
  admin.mjs                  /api/admin/* — gestão (protegida por password)
  image.mjs                  /img/… — fotos carregadas na gestão
netlify/edge-functions/
  maintenance.js             Modo manutenção
netlify/lib/
  catalog.mjs                Catálogo: validação, categorias, cores
  orders.mjs                 Encomendas: guardar, numerar, listar
  emails.mjs                 Modelos dos emails
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
| `EMAIL_FROM` | Remetente, ex.: `Welabb <encomendas@blessedadvantage.pt>` | Não |
| `EMAIL_REPLY_TO` | Email que recebe as respostas dos clientes | Recomendado |
| `SENDCLOUD_PUBLIC_KEY` / `SENDCLOUD_SECRET_KEY` | Chaves do Sendcloud | Para etiquetas |
| `SENDCLOUD_SHIPPING_METHOD_ID` | Método de envio (etiqueta automática) | Não |

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
   `https://blessedadvantage.pt/api/stripe-webhook`, eventos `checkout.session.completed` e
   `checkout.session.async_payment_succeeded` → copiar o `whsec_…` para `STRIPE_WEBHOOK_SECRET`.
4. **Domínio:** na Netlify, *Domain management → Add domain* → `blessedadvantage.pt`. No painel do domínio:
   - apagar os 2 registos **A** antigos (104.19.x.x), o **CNAME** que aponta para ele próprio, `_acme-challenge` e `_cf-custom-hostname`;
   - adicionar **A** `blessedadvantage.pt` → `75.2.60.5` e **CNAME** `www` → `<nome-do-site>.netlify.app`
     (confirmar os valores exatos que a Netlify mostrar).
5. Preencher produtos (nome, preço, cores) e imagens do site na gestão publicada.
6. Fazer uma compra de teste completa no site publicado (cartão `4242…`).
7. Ativar a conta Stripe, trocar para chaves `sk_live_…` e atualizar o webhook.
8. Apagar `MAINTENANCE_MODE` → **loja aberta**.

---

## 13. Pendentes (lista de tarefas)

**Antes de abrir a loja**
- [ ] Publicar na Netlify e ligar o domínio
- [ ] Password forte para a gestão (`ADMIN_PASSWORD`)
- [ ] Ativar Multibanco na Stripe; desativar Bancontact e EPS
- [ ] Configurar Resend (domínio + chave) e `EMAIL_REPLY_TO`
- [ ] Preencher nomes, preços, cores e descrições dos 13 produtos
- [ ] Foto do processo em boa qualidade (mín. 1600 px de largura) e, se possível, a imagem original do hero
- [ ] Identificação do vendedor no rodapé (nome/empresa, NIF, morada) — obrigatório em Portugal
- [ ] Páginas legais: Termos e Condições, Política de Privacidade, Política de Devoluções, Livro de Reclamações Eletrónico
- [ ] Ativar a conta Stripe e passar para modo real
- [ ] Renovar `blessedadvantage.pt` antes de 17/11/2026

**A seguir**
- [ ] Sendcloud (CTT + InPost) — etiquetas automáticas
- [ ] Escolha de cacifo InPost no checkout
- [ ] Fatura certificada automática (InvoiceXpress ou Moloni) — confirmar com o contabilista
- [ ] Envio automático do código de 10% aos subscritores (ex.: Brevo/Mailchimp)
- [ ] Notificação por email dos pedidos de orçamento e newsletter (Netlify Forms)
- [ ] Registar `welabb.pt` (e `.com`), configurar email `ola@welabb.pt` e mudar o domínio
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
