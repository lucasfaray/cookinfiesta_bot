require("dotenv").config();

const express = require("express");
const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();

app.get("/", (req, res) => {
  res.send("Bot funcionando 🚀");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor HTTP rodando na porta ${PORT}`);
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const analyticsDataClient = google.analyticsdata({
  version: "v1beta",
  auth: oauth2Client,
});

const userState = {};

function normalizeText(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/sao paulo/g, "sao-paulo")
    .replace(/belo horizonte/g, "belo-horizonte")
    .replace(/buenos aires/g, "buenos-aires")
    .replace(/mexico city/g, "mexico-city")
    .replace(/panama city/g, "panama-city")
    .replace(/ilha grande/g, "ilha-grande")
    .replace(/san jose/g, "san-jose")
    .replace(/santo domingo/g, "santo-domingo")
    .replace(/playa del carmen/g, "playa")
    .replace(/cook in rio/g, "rio cook")
    .replace(/lp do/g, "")
    .replace(/lp da/g, "")
    .replace(/landing page/g, "")
    .trim();
}

function extractPath(urlOrPath = "") {
  try {
    if (urlOrPath.startsWith("http")) {
      return new URL(urlOrPath).pathname.replace(/\/$/, "");
    }
    return urlOrPath.replace(/\/$/, "");
  } catch {
    return urlOrPath;
  }
}

async function analyzeExperimentMessage(message) {
  const today = new Date().toISOString();

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `
Você é o AGENTE DE EXPERIMENTAÇÃO da Cook in Fiesta.

Você não é um parser. Você opera em 4 CAMADAS COGNITIVAS sequenciais,
e cada camada alimenta a próxima. O JSON de saída é o resultado das
4 camadas — não o objetivo do seu trabalho.

Responda SOMENTE em JSON válido. Sem texto fora.

Data atual: ${today}

═══════════════════════════════════════════════════════════
ARQUITETURA — 4 CAMADAS
═══════════════════════════════════════════════════════════

╭─ CAMADA 1 — PARSING ──────────────────────────────────────╮
│ Entender literalmente o que a mensagem diz.               │
│   • o que será testado                                    │
│   • onde (plataforma, página, cidade)                     │
│   • quando (publicação, revisão)                          │
│   • variantes mencionadas                                 │
│   • métrica mencionada                                    │
│ Saída interna: fatos extraídos, sem interpretação.        │
╰───────────────────────────────────────────────────────────╯

╭─ CAMADA 2 — STRUCTURING ──────────────────────────────────╮
│ Transformar fatos em experimento bem-formado.             │
│   • hipótese causal (SE / ENTÃO / PORQUE)                 │
│   • variantes A/B explícitas (controle vs tratamento)     │
│   • métrica primária + secundárias                        │
│   • inferir LP via page_query (city + category)           │
│   • normalizar datas em ISO usando ${today}               │
│   • PROPOR variantes quando o usuário não trouxe          │
│     (você tem repertório — não espera ele entregar pronto)│
╰───────────────────────────────────────────────────────────╯

╭─ CAMADA 3 — STRATEGIC REASONING ──────────────────────────╮
│ Avaliar o teste como um especialista sênior avaliaria.    │
│ NÃO bloqueia, NÃO recusa — sempre anota.                  │
│ Itens a avaliar:                                          │
│                                                            │
│   1. QUALIDADE DO TESTE                                   │
│      • A mudança tem efeito potencial relevante?          │
│      • Headline/hero > CTA > microcopy (ordem de impacto) │
│      • Está testando uma coisa só, ou várias misturadas?  │
│                                                            │
│   2. CONFLITOS METODOLÓGICOS                              │
│      • Múltiplas mudanças simultâneas = não é A/B, é      │
│        redesign (sinaliza, não recusa)                    │
│      • Teste em LP com tráfego baixo = pode ser           │
│        inconclusivo (sinaliza)                            │
│      • Janela de revisão curta demais pra significância   │
│                                                            │
│   3. HISTÓRICO PARECIDO                                   │
│      • Esse teste (ou parecido) já foi rodado antes?      │
│      • Já existe literatura/benchmark conhecido?          │
│        (ex: escassez em CTA é literatura consolidada)     │
│                                                            │
│   4. RISCO                                                │
│      • Impacto na marca? (CTAs agressivos, claims fortes) │
│      • Impacto em SEO? (mudança de H1, hero)              │
│      • Impacto em integrações? (tracking, conversões)     │
│                                                            │
│   5. CLAREZA CAUSAL                                       │
│      • Se o teste vencer, vamos saber POR QUE venceu?     │
│      • A hipótese permite aprender algo generalizável?    │
│                                                            │
│ Saída: array strategic_notes com objetos                  │
│   category, severity, note                                │
│   severity ∈ info | attention | critical                  │
│   critical nunca bloqueia, só destaca.                    │
╰───────────────────────────────────────────────────────────╯

╭─ CAMADA 4 — MEMORY ENGINE ────────────────────────────────╮
│ Recuperar e aplicar conhecimento acumulado.               │
│ Fontes (consultadas pelo sistema externo após seu JSON):  │
│   • aprendizados de testes anteriores                     │
│   • benchmarks internos (taxa de conversão típica por LP, │
│     CTR médio por formato no IG, etc)                     │
│   • padrões históricos da marca                           │
│   • dados GA4 da LP em questão                            │
│   • Instagram Insights da conta em questão                │
│                                                            │
│ Seu papel: declarar O QUE você QUER consultar para        │
│ fundamentar a Camada 3. Você não tem acesso direto às     │
│ fontes — você emite QUERIES que o sistema externo executa.│
│                                                            │
│ Saída: array memory_queries com objetos                   │
│   source, query, why                                      │
│   source ∈ past_experiments | ga4 | instagram_insights    │
│          | internal_benchmarks | brand_patterns           │
│                                                            │
│ Exemplos de queries:                                      │
│   • past_experiments: testes anteriores de CTA na LP do   │
│     Cook in Rio nos últimos 12 meses                      │
│   • ga4: tráfego semanal e taxa de conversão atual da     │
│     LP rio cook                                           │
│   • instagram_insights: retenção média dos últimos 10     │
│     Reels da conta Cancun                                 │
│   • internal_benchmarks: lift médio observado em testes   │
│     de hook nos últimos 6 meses                           │
╰───────────────────────────────────────────────────────────╯

═══════════════════════════════════════════════════════════
CONTEXTO DA EMPRESA
═══════════════════════════════════════════════════════════

Cidades conhecidas:
  rio, sao-paulo, lima, cancun, mexico-city, buenos-aires,
  cartagena, medellin, bogota, cusco, santiago, montevideo

Categorias conhecidas:
  cook         → experiências de cozinhar
  food-crawl   → tours gastronômicos a pé
  taste        → tastings, degustações
  bbq          → experiências de churrasco
  market-tour  → tours de mercado

Inferência obrigatória quando a mensagem mencionar cidade ou nome
de experiência: city + category + page_query (formato city category).
Nunca invente URLs em test_link.

═══════════════════════════════════════════════════════════
SCHEMA DE SAÍDA
═══════════════════════════════════════════════════════════

Estrutura esperada do JSON (use aspas duplas reais na saída — abaixo
está em notação descritiva por causa do template literal):

{
  intent: create_experiment | unknown,
  experiments: [
    {
      // CAMADA 1 — fatos extraídos
      parsed: {
        raw_request: 1-2 frases (o que a mensagem disse, literal),
        explicit_fields: lista de campos que vieram explícitos
      },

      // CAMADA 2 — estrutura do experimento
      title: string,
      platform: instagram | landing-page | email | ads | other,
      format: reels | post | story | landing-page | email | ad-creative,
      tested_element: CTA | headline | hook | thumbnail | hero | subject-line,
      variants: {
        control: versão atual / A,
        treatment: array — pode haver múltiplas variantes B, C, D,
        source: user_provided | agent_proposed | mixed
      },
      objective: string,
      hypothesis: SE [mudança] ENTÃO [efeito] PORQUE [mecanismo],
      metric: {
        primary: métrica única de decisão,
        secondary: array,
        source: user_provided | agent_suggested
      },
      channel: string,
      city: string,
      category: string,
      page_query: string,
      publish_at_iso: YYYY-MM-DD HH:mm,
      publish_at_text: texto original do usuário,
      review_at_iso: YYYY-MM-DD HH:mm,
      review_at_text: texto original do usuário,
      test_link: string (só se o usuário forneceu),

      // CAMADA 3 — avaliação estratégica
      strategic_notes: [
        { category: quality|methodology|history|risk|causality,
          severity: info|attention|critical,
          note: string }
      ],

      // CAMADA 4 — consultas à memória
      memory_queries: [
        { source: string, query: string, why: string }
      ],

      confidence: 0-1 — segurança da estruturação,
      open_questions: perguntas que o usuário PRECISA responder
    }
  ],
  ambiguity: array de objetos com field e options,
  follow_up_question: UMA pergunta consolidada, ou vazio se nada falta
}

IMPORTANTE: na saída real, use aspas duplas padrão de JSON. A
descrição acima usa notação livre apenas para evitar conflito
com o template literal deste prompt.

═══════════════════════════════════════════════════════════
REGRAS DE ESTRUTURAÇÃO (CAMADA 2)
═══════════════════════════════════════════════════════════

HIPÓTESE deve ter mecanismo causal. Nunca tautológica.
  RUIM:  um CTA mais forte aumentará conversão
  BOM:   Se trocarmos Reservar agora por Garantir minha vaga
         (restam 4), a conversão sobe, porque escassez explícita
         reduz procrastinação no momento de decisão.

VARIANTES — você PROPÕE quando o usuário não trouxe.
  Usuário: vou testar um hook novo no Reels de Cancun
  → control = hook atual (a ser confirmado pelo usuário)
  → treatment = [
       Pergunta direta: Você sabia que existe um prato em Cancun
        que só 3 lugares servem certo?,
       Contradição: Todo mundo vai pra Cancun pela praia. Erro.,
       Número específico: 7 dias em Cancun. Comi em 23 lugares.
        Esses 3 mudaram a viagem.
     ]
  → source = agent_proposed
  → strategic_notes inclui nota de causalidade sobre múltiplas
     variantes simultâneas dificultarem atribuição.

MÉTRICAS — sugira 2-3 candidatas quando o usuário não definiu.
  CTA / botão (LP)       → conversão | cliques no CTA | reservas confirmadas
  Headline / hero (LP)   → CTR pra próxima seção | scroll depth | conversão
  Hook (Reels/Story)     → retenção 3s | retenção até o fim | views
  Thumbnail              → CTR | views | saves
  Legenda                → comentários | saves | tempo na publicação
  Assunto (email)        → open rate | CTR do email
  Criativo (ads)         → CTR | CPC | CPA | ROAS

  Quando agent_suggested: deixe metric.primary vazio e liste as 2-3
  opções no follow_up_question.

DATAS — converta tudo pra YYYY-MM-DD HH:mm usando ${today}.
  hoje à noite     → ${today} 20:00
  amanhã de manhã  → ${today}+1 09:00
  semana que vem   → ${today}+7 09:00
  sexta            → próxima sexta a partir de ${today}
  Defaults sensatos quando o usuário não disse:
    publish_at_iso → vazio (não bloqueia)
    review_at_iso  → LP: +7 dias / Instagram orgânico: +48h / Ads: +14 dias

═══════════════════════════════════════════════════════════
REGRAS DE AVALIAÇÃO (CAMADA 3)
═══════════════════════════════════════════════════════════

Sempre rode TODAS as 5 dimensões. Se uma dimensão não tem observação
relevante, simplesmente não emita nota nela.

Exemplos de notas típicas:

  • methodology / critical:
    Mensagem descreve mudança simultânea de CTA + headline + hero.
    Isso não é A/B test, é redesign — não será possível atribuir o
    resultado a nenhum elemento isolado.

  • quality / attention:
    CTA tem ordem de magnitude menor de impacto que headline. Se há
    recursos limitados, considere testar headline antes.

  • history / info:
    Escassez em CTA é padrão consolidado na literatura (Cialdini).
    Considere testar variável menos óbvia pra ganhar aprendizado.

  • risk / attention:
    Mudança de H1 da LP impacta SEO. Confirmar que a versão perdedora
    será revertida rapidamente se houver queda orgânica detectável.

  • causality / attention:
    Hipótese atual é descritiva (CTA mais forte converte mais).
    Refinada pra causal: escassez explícita reduz procrastinação.

═══════════════════════════════════════════════════════════
REGRAS DE MEMÓRIA (CAMADA 4)
═══════════════════════════════════════════════════════════

Sempre emita memory_queries relevantes. Mínimo recomendado:

  • 1 query a past_experiments (esse teste já foi feito?)
  • 1 query à fonte de dados da plataforma:
      - LP → ga4 (tráfego + conversão atual)
      - Instagram → instagram_insights (baseline da conta)
      - Email → benchmarks de open/click
      - Ads → benchmarks de CTR/CPA
  • 0-2 queries adicionais conforme o caso

Cada query deve ter campo why explicando o que você vai fazer com
a resposta.

═══════════════════════════════════════════════════════════
PERGUNTAS AO USUÁRIO
═══════════════════════════════════════════════════════════

open_questions é lista de coisas que você precisa que o usuário
responda. Vazio se nada falta.

Pergunte SÓ quando:
  • variantes ausentes E você não conseguiu propor (raro — você propõe)
  • plataforma genuinamente ambígua
  • página ambígua (múltiplas LPs cabem no que ele disse)
  • objetivo de negócio confuso

NÃO pergunte:
  • métrica → você sugere 2-3, ele escolhe
  • hipótese → você propõe, ele valida
  • datas → use defaults
  • link → o sistema resolve via page_query

follow_up_question consolida todas as open_questions em UMA pergunta
natural, agrupada. Vazio se open_questions está vazio.

═══════════════════════════════════════════════════════════
INTENT = unknown
═══════════════════════════════════════════════════════════

Quando a mensagem não é criação de teste (pergunta sobre resultado,
relatório, conversa fora de escopo):
  experiments = array vazio
  follow_up_question redireciona com naturalidade.

═══════════════════════════════════════════════════════════
EXEMPLO COMPLETO
═══════════════════════════════════════════════════════════

INPUT (com ${today} = 2026-05-22):
Vou testar um hook novo no Reels de Cancun hoje à noite. Quero
analisar daqui 2 dias.

OUTPUT esperado (em JSON real, aspas duplas):

intent = create_experiment
experiments[0]:
  parsed:
    raw_request = Testar um hook novo num Reels de Cancun, publicar
                  hoje à noite, avaliar em 2 dias.
    explicit_fields = [tested_element, platform, format, city,
                       publish_at_text, review_at_text]
  title = Hook novo — Reels Cancun
  platform = instagram
  format = reels
  tested_element = hook
  variants:
    control = hook atual (a confirmar com o usuário)
    treatment = [
      Pergunta direta: Você sabia que tem um prato em Cancun que só
       3 lugares servem certo?,
      Contradição: Todo mundo vai pra Cancun pela praia. Erro.,
      Número específico: 7 dias em Cancun. 23 lugares. Esses 3
       mudaram a viagem.
    ]
    source = agent_proposed
  objective = aumentar retenção e views do Reels
  hypothesis = Se substituirmos o hook atual por uma abertura com
               tensão informacional (pergunta ou contradição) nos
               primeiros 2 segundos, a retenção 3s sobe, porque o
               cérebro do espectador precisa resolver a tensão
               antes de scrollar.
  metric:
    primary = vazio
    secondary = vazio
    source = agent_suggested
  channel = instagram
  city = cancun
  category = vazio
  page_query = vazio
  publish_at_iso = 2026-05-22 20:00
  publish_at_text = hoje à noite
  review_at_iso = 2026-05-24 20:00
  review_at_text = daqui 2 dias
  test_link = vazio
  strategic_notes = [
    causality / attention:
      3 variantes simultâneas no mesmo Reels não rodam — Instagram
      não suporta A/B nativo de hook. Sugestão: rodar 1 variante por
      Reels, comparar contra baseline da conta dos últimos 10 posts.,
    methodology / info:
      Janela de 48h é o mínimo razoável pra Instagram orgânico.
      Resultados antes disso ainda estão sob efeito de empurrão
      inicial do algoritmo.,
    history / info:
      Hook com tensão informacional é padrão validado em criadores
      de viagem — vale checar se variantes parecidas já rodaram na
      conta Cancun.
  ]
  memory_queries = [
    past_experiments:
      query = testes de hook em Reels da conta Cancun nos últimos
              6 meses
      why = Verificar se alguma das variantes propostas já foi
            testada e qual foi o resultado.,
    instagram_insights:
      query = retenção 3s e retenção até o fim dos últimos 10 Reels
              da conta Cancun
      why = Estabelecer baseline pra comparar o resultado do teste
            contra performance típica.,
    internal_benchmarks:
      query = lift médio observado em testes de hook nos últimos
              6 meses entre todas as contas
      why = Calibrar expectativa de efeito mínimo detectável dado
            o tráfego típico de um Reels.
  ]
  confidence = 0.8
  open_questions = [
    Qual é o hook atual do Reels (controle)?,
    Você quer rodar 1 variante por Reels (mais limpo) ou tentar
    comparar várias rapidamente?,
    Qual métrica decide vencedor: retenção 3s, retenção até o fim,
    ou views totais?
  ]

ambiguity = vazio
follow_up_question = 3 coisas pra fechar o teste: (1) qual é o
hook atual (controle)? (2) prefere rodar 1 variante por Reels ou
comparar várias em sequência? (3) métrica de decisão — retenção
3s, retenção até o fim, ou views totais?

═══════════════════════════════════════════════════════════
REGRAS FINAIS
═══════════════════════════════════════════════════════════

  • Responda SOMENTE em JSON válido com aspas duplas padrão.
  • As 4 camadas SEMPRE rodam — mesmo que strategic_notes ou
    memory_queries fiquem com poucos itens em casos simples.
  • Nunca invente test_link.
  • Nunca recuse estruturar — sinalize problemas via strategic_notes
    com severity critical se for grave.
  • Variantes ausentes: PROPONHA antes de perguntar. Só pergunte
    o controle (versão atual) se o usuário não passou.
  • follow_up_question consolida open_questions em UMA pergunta.
  • confidence reflete segurança real da estruturação.
`
      },
      {
        role: "user",
        content: message
      }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  return JSON.parse(response.choices[0].message.content);
}

function formatDate(date) {
  if (!date) return "sem data";

  return new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

async function findLandingPage(analysis, message) {
  const text = normalizeText(
    `${message} ${analysis.city || ""} ${analysis.category || ""} ${analysis.page_query || ""}`
  );

  let city = normalizeText(analysis.city || "");
  let category = normalizeText(analysis.category || "");

  if (!city) {
    const knownCities = [
      "rio", "sao-paulo", "belo-horizonte", "brasilia", "buenos-aires",
      "cancun", "cartagena", "cuenca", "curitiba", "florianopolis",
      "fortaleza", "foz", "ilha-grande", "lima", "mendoza", "merida",
      "mexico-city", "monterrey", "panama-city", "playa", "quito",
      "salvador", "san-jose", "santiago", "santo-domingo", "cusco",
      "bogota", "medellin", "guadalajara", "natal"
    ];

    city = knownCities.find((c) => text.includes(c)) || "";
  }

  if (!category) {
    if (text.includes("food crawl") || text.includes("food-crawl") || text.includes("walking")) category = "food-crawl";
    else if (text.includes("taste") || text.includes("tasting") || text.includes("degustacao")) category = "taste";
    else if (text.includes("bbq") || text.includes("churrasco")) category = "bbq";
    else if (text.includes("fruit") || text.includes("fruta")) category = "fruit";
    else if (text.includes("drink")) category = "drinks-and-appetizers";
    else if (text.includes("seafood")) category = "seafood";
    else if (text.includes("cook") || text.includes("cozinha") || text.includes("aula")) category = "cook";
  }

  if (!city && !category) return null;

  let query = supabase.from("landing_pages").select("*").limit(10);

  if (city) query = query.eq("city", city);
  if (category) query = query.ilike("category", `%${category}%`);

  let { data, error } = await query;

  if (error) {
    console.log("Erro ao buscar landing page:", error);
    return null;
  }

  if (data && data.length === 1) return data[0];

  if (data && data.length > 1) {
    const exact = data.find(
      (p) => normalizeText(p.city) === city && normalizeText(p.category) === category
    );
    return exact || data[0];
  }

  if (city) {
    const fallback = await supabase
      .from("landing_pages")
      .select("*")
      .eq("city", city)
      .limit(10);

    if (!fallback.error && fallback.data?.length === 1) {
      return fallback.data[0];
    }

    if (!fallback.error && fallback.data?.length > 1 && category) {
      const match = fallback.data.find((p) =>
        normalizeText(p.category).includes(category)
      );
      if (match) return match;
    }
  }

  return null;
}

async function getGA4Summary(pagePath = null) {
  const requestBody = {
    dateRanges: [
      {
        startDate: "7daysAgo",
        endDate: "today",
      },
    ],
    metrics: [
      { name: "activeUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
    ],
  };

  if (pagePath) {
    requestBody.dimensions = [{ name: "pagePath" }];
    requestBody.dimensionFilter = {
      filter: {
        fieldName: "pagePath",
        stringFilter: {
          matchType: "CONTAINS",
          value: pagePath,
        },
      },
    };
  }

  const response = await analyticsDataClient.properties.runReport({
    property: `properties/${process.env.GA4_PROPERTY_ID}`,
    requestBody,
  });

  const rows = response.data.rows?.[0];

  if (!rows) return null;

  return {
    users: rows.metricValues[0].value,
    sessions: rows.metricValues[1].value,
    pageviews: rows.metricValues[2].value,
  };
}

bot.start((ctx) => {
  ctx.reply(
    "Bot de experimentos ativo 🚀\n\nComandos:\n/testes_ativos\n/concluidos\n/aprendizados\n/ver ID\n/buscar termo\n/concluir ID\n/ga\n/ga /rio-cook\n\nOu me diga diretamente o que você quer testar."
  );
});

bot.on("text", async (ctx) => {
  try {
    const message = ctx.message.text.trim();

    const telegramId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const username = ctx.from.username || "";
    const name = ctx.from.first_name || "";

    await supabase.from("team_members").upsert({
      telegram_user_id: telegramId,
      username,
      name,
    });

    if (message.startsWith("/ga")) {
      try {
        const rawPath = message.replace("/ga", "").trim();
        const pagePath = rawPath ? extractPath(rawPath) : null;
        const data = await getGA4Summary(pagePath);

        if (!data) {
          return ctx.reply("Nenhum dado encontrado no GA4.");
        }

        return ctx.reply(
          `📊 Google Analytics ${pagePath ? `(${pagePath})` : "(últimos 7 dias)"}\n\n` +
            `👥 Usuários: ${data.users}\n` +
            `🧭 Sessões: ${data.sessions}\n` +
            `📄 Visualizações: ${data.pageviews}`
        );
      } catch (err) {
        console.log(err);
        return ctx.reply("Erro ao consultar o Google Analytics ❌");
      }
    }

    if (message === "/testes_ativos") {
      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) return ctx.reply("Erro ao buscar testes ativos ❌");
      if (!data.length) return ctx.reply("Nenhum teste ativo encontrado.");

      const text = data
        .map(
          (t) =>
            `#${t.id} ${t.title}\nLink: ${t.test_link || "não informado"}\nMétrica: ${
              t.metric || "não informada"
            }\nRevisão: ${formatDate(t.review_at)}`
        )
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message === "/concluidos") {
      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) return ctx.reply("Erro ao buscar testes concluídos ❌");
      if (!data.length) return ctx.reply("Nenhum teste concluído encontrado.");

      const text = data
        .map(
          (t) =>
            `#${t.id} ${t.title}\nResultado: ${
              t.result || "não informado"
            }\nAprendizado: ${t.learning || "não informado"}`
        )
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message === "/aprendizados") {
      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("status", "completed")
        .not("learning", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) return ctx.reply("Erro ao buscar aprendizados ❌");
      if (!data.length) return ctx.reply("Nenhum aprendizado salvo ainda.");

      const text = data
        .map((t) => `#${t.id} ${t.title}\nAprendizado: ${t.learning}`)
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message.startsWith("/ver")) {
      const id = message.split(" ")[1];

      if (!id) return ctx.reply("Use assim:\n/ver 12");

      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) return ctx.reply("Teste não encontrado.");

      return ctx.reply(
        `#${data.id} ${data.title}\n\nStatus: ${
          data.status
        }\nLink/local: ${
          data.test_link || "não informado"
        }\nMétrica: ${
          data.metric || "não informada"
        }\nRevisão: ${formatDate(
          data.review_at
        )}\nResultado: ${
          data.result || "não informado"
        }\nAprendizado: ${data.learning || "não informado"}`
      );
    }

    if (message.startsWith("/buscar")) {
      const term = message.replace("/buscar", "").trim();

      if (!term) return ctx.reply("Use assim:\n/buscar cta");

      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .or(
          `title.ilike.%${term}%,metric.ilike.%${term}%,test_link.ilike.%${term}%,result.ilike.%${term}%,learning.ilike.%${term}%`
        )
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        console.log(error);
        return ctx.reply("Erro ao buscar testes ❌");
      }

      if (!data.length) return ctx.reply("Nenhum teste encontrado.");

      const text = data
        .map(
          (t) =>
            `#${t.id} ${t.title}\nStatus: ${
              t.status
            }\nLink: ${t.test_link || "não informado"}\nMétrica: ${
              t.metric || "não informada"
            }\nAprendizado: ${t.learning || "sem aprendizado registrado"}`
        )
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message.startsWith("/concluir")) {
      const experimentId = message.split(" ")[1];

      if (!experimentId) return ctx.reply("Use assim:\n/concluir 12");

      userState[telegramId] = {
        experimentId,
        step: "ask_result",
      };

      return ctx.reply("Qual foi o resultado do teste?");
    }

    const state = userState[telegramId];

    if (!state) {
      const analysis = await analyzeExperimentMessage(message);
      const landingPage = await findLandingPage(analysis, message);

      if (analysis.intent !== "create_experiment") {
        return ctx.reply(
          "Me diga algo como:\n\nVou testar um CTA novo na LP do Cook in Rio e quero revisar daqui uma semana."
        );
      }

      const finalUrl = analysis.test_link || landingPage?.url || null;
      let missingFields = Array.isArray(analysis.missing_fields)
  ? analysis.missing_fields
  : [];

if (finalUrl) {
  missingFields = missingFields.filter((field) => {
    const normalized = normalizeText(field);
    return (
      !normalized.includes("link") &&
      !normalized.includes("url") &&
      !normalized.includes("pagina") &&
      !normalized.includes("landing")
    );
  });
}

if (!analysis.metric) {
  missingFields = [...new Set([...missingFields, "metric"])];
}

const smartFollowUp =
  finalUrl && !analysis.metric
    ? `Identifiquei esta página: ${finalUrl}\n\nEstá correta? E qual métrica você quer acompanhar? Sugestões: cliques no CTA, conversão, reservas, sessões ou visualizações da página.`
    : finalUrl
    ? `Identifiquei esta página: ${finalUrl}\n\nEstá correta?`
    : analysis.follow_up_question || "Me envie as informações que faltam.";

      const { data, error } = await supabase
        .from("experiments")
        .insert({
          title: analysis.title || message,
          raw_message: message,
          platform: analysis.platform || null,
          format: analysis.format || null,
          tested_element: analysis.tested_element || null,
          objective: analysis.objective || null,
          hypothesis: analysis.hypothesis || null,
          metric: analysis.metric || null,
          channel: analysis.channel || analysis.platform || null,
          test_link: finalUrl,
          missing_fields: missingFields,
          created_by: telegramId,
          telegram_chat_id: chatId,
          status: missingFields.length ? "draft" : "active",
        })
        .select()
        .single();

      if (error) {
        console.log(error);
        return ctx.reply("Erro ao criar o teste ❌");
      }

      if (missingFields.length) {
        userState[telegramId] = {
          experimentId: data.id,
          step: "ai_followup",
        };

        return ctx.reply(
          `Entendi o teste ✅\n\n` +
            `ID: ${data.id}\n` +
            `Título: ${data.title}\n` +
            `Canal: ${
              analysis.platform || analysis.channel || "não informado"
            }\n` +
            `Elemento testado: ${
              analysis.tested_element || "não informado"
            }\n` +
            `Página identificada: ${finalUrl || "não identificada"}\n\n` +
            `${smartFollowUp}`
        );
      }

      return ctx.reply(
        `Teste criado ✅\n\n` +
          `ID: ${data.id}\n` +
          `Título: ${data.title}\n` +
          `Página identificada: ${finalUrl || "não identificada"}\n` +
          `Métrica: ${analysis.metric || "não informada"}`
      );
    }

    if (state.step === "ai_followup") {
      const analysis = await analyzeExperimentMessage(
        `Informações complementares do teste: ${message}`
      );

      await supabase
        .from("experiments")
        .update({
          metric: analysis.metric || undefined,
          hypothesis: analysis.hypothesis || undefined,
          objective: analysis.objective || undefined,
          test_link: analysis.test_link || undefined,
          missing_fields: [],
          status: "active",
        })
        .eq("id", state.experimentId);

      const experimentId = state.experimentId;
      delete userState[telegramId];

      return ctx.reply(
        `Teste atualizado e ativado ✅\n\nID do teste: ${experimentId}`
      );
    }

    if (state.step === "ask_result") {
      await supabase
        .from("experiments")
        .update({
          result: message,
        })
        .eq("id", state.experimentId);

      userState[telegramId].step = "ask_learning";

      return ctx.reply("Qual foi o principal aprendizado desse teste?");
    }

    if (state.step === "ask_learning") {
      await supabase
        .from("experiments")
        .update({
          learning: message,
          status: "completed",
        })
        .eq("id", state.experimentId);

      delete userState[telegramId];

      return ctx.reply("Teste concluído e aprendizado salvo ✅");
    }
  } catch (error) {
    console.log(error);
    ctx.reply("Erro inesperado ❌");
  }
});

async function checkReminders() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("experiments")
    .select("*")
    .eq("status", "active")
    .is("reminded_at", null)
    .lte("review_at", now);

  if (error) {
    console.log(error);
    return;
  }

  for (const experiment of data) {
    if (!experiment.telegram_chat_id) continue;

    await bot.telegram.sendMessage(
      experiment.telegram_chat_id,
      `🔔 Hora de revisar o teste:\n\n${experiment.title}\n\nMétrica: ${
        experiment.metric || "não informada"
      }\nLink/local: ${
        experiment.test_link || "não informado"
      }\n\nPara concluir:\n/concluir ${experiment.id}`
    );

    await supabase
      .from("experiments")
      .update({
        reminded_at: new Date().toISOString(),
      })
      .eq("id", experiment.id);
  }
}

setInterval(checkReminders, 60 * 1000);

bot.launch()
  .then(() => {
    console.log("Bot rodando 🚀");
  })
  .catch((error) => {
    console.log("Erro ao iniciar bot:", error.message);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));