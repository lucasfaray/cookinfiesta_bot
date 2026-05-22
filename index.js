require("dotenv").config();

const express = require("express");
const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { google } = require("googleapis");

// ═══════════════════════════════════════════════════════════
// SETUP — servidor, clientes externos
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// CONSTANTES COMPARTILHADAS
// ═══════════════════════════════════════════════════════════

const KNOWN_CITIES = [
  "rio", "sao-paulo", "belo-horizonte", "brasilia", "buenos-aires",
  "cancun", "cartagena", "cuenca", "curitiba", "florianopolis",
  "fortaleza", "foz", "ilha-grande", "lima", "mendoza", "merida",
  "mexico-city", "monterrey", "panama-city", "playa", "quito",
  "salvador", "san-jose", "santiago", "santo-domingo", "cusco",
  "bogota", "medellin", "guadalajara", "natal",
];

const KNOWN_CATEGORIES = [
  "cook", "food-crawl", "taste", "bbq", "market-tour",
  "fruit", "drinks-and-appetizers", "seafood",
];

// ═══════════════════════════════════════════════════════════
// RATE LIMITING — proteção simples por usuário
// ═══════════════════════════════════════════════════════════

const lastRequestAt = new Map();
const MIN_INTERVAL_MS = 3000;

function isRateLimited(telegramId) {
  const last = lastRequestAt.get(telegramId);
  const now = Date.now();

  if (last && now - last < MIN_INTERVAL_MS) {
    return true;
  }

  lastRequestAt.set(telegramId, now);
  return false;
}

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS — texto, datas, URLs
// ═══════════════════════════════════════════════════════════

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

function formatDate(date) {
  if (!date) return "sem data";

  return new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

// Converte "YYYY-MM-DD HH:mm" (devolvido pelo agente) para ISO completo
// usável pelo Postgres. Retorna null se não der pra parsear.
function isoFromAgentDate(agentDate) {
  if (!agentDate || typeof agentDate !== "string") return null;

  // Já está em formato ISO completo?
  if (agentDate.includes("T")) {
    const d = new Date(agentDate);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Formato "YYYY-MM-DD HH:mm" → assume timezone America/Sao_Paulo (-03:00)
  const match = agentDate.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return null;

  const [, y, m, d, h, min] = match;
  const isoWithTz = `${y}-${m}-${d}T${h}:${min}:00-03:00`;
  const parsed = new Date(isoWithTz);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Sanitiza termos pra interpolação em query .or() do Supabase
function sanitizeSearchTerm(term = "") {
  return term.replace(/[,;()]/g, "").trim();
}

// ═══════════════════════════════════════════════════════════
// AGENTE — análise estruturada da mensagem (4 camadas)
// ═══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
Você é o AGENTE DE EXPERIMENTAÇÃO da Cook in Fiesta.

Você não é um parser. Você opera em 4 CAMADAS COGNITIVAS sequenciais,
e cada camada alimenta a próxima. O JSON de saída é o resultado das
4 camadas — não o objetivo do seu trabalho.

Responda SOMENTE em JSON válido. Sem texto fora.

═══════════════════════════════════════════════════════════
ARQUITETURA — 4 CAMADAS
═══════════════════════════════════════════════════════════

CAMADA 1 — PARSING
Entender literalmente o que a mensagem diz:
  • o que será testado
  • onde (plataforma, página, cidade)
  • quando (publicação, revisão)
  • variantes mencionadas
  • métrica mencionada

CAMADA 2 — STRUCTURING
Transformar fatos em experimento bem-formado:
  • hipótese causal (SE / ENTÃO / PORQUE)
  • variantes A/B explícitas (controle vs tratamento)
  • métrica primária + secundárias
  • inferir LP via page_query (city + category)
  • normalizar datas em ISO no formato YYYY-MM-DD HH:mm
  • PROPOR variantes quando o usuário não trouxe
    (você tem repertório — não espera ele entregar pronto)

CAMADA 3 — STRATEGIC REASONING
Avaliar o teste como um especialista sênior. NÃO bloqueia, NÃO recusa.
Sempre anota observações em strategic_notes nas dimensões:
  1. QUALIDADE DO TESTE (impacto potencial, ordem de magnitude)
  2. CONFLITOS METODOLÓGICOS (múltiplas mudanças, tráfego, janela)
  3. HISTÓRICO PARECIDO (já foi feito? literatura conhecida?)
  4. RISCO (marca, SEO, integrações)
  5. CLAREZA CAUSAL (vai dar pra atribuir o resultado?)

severity ∈ info | attention | critical (critical nunca bloqueia, só destaca)

CAMADA 4 — MEMORY ENGINE
Declare O QUE você QUER consultar para fundamentar a Camada 3.
Você não acessa as fontes diretamente — emite QUERIES.
source ∈ past_experiments | ga4 | instagram_insights | internal_benchmarks | brand_patterns

═══════════════════════════════════════════════════════════
CONTEXTO DA EMPRESA
═══════════════════════════════════════════════════════════

Cidades conhecidas:
  rio, sao-paulo, lima, cancun, mexico-city, buenos-aires,
  cartagena, medellin, bogota, cusco, santiago, montevideo

Categorias conhecidas:
  cook, food-crawl, taste, bbq, market-tour

Inferência obrigatória quando a mensagem mencionar cidade ou nome de
experiência: city + category + page_query (formato city category).
Nunca invente URLs em test_link.

═══════════════════════════════════════════════════════════
SCHEMA DE SAÍDA — JSON válido com aspas duplas
═══════════════════════════════════════════════════════════

{
  intent: create_experiment | unknown,
  experiments: [
    {
      parsed: { raw_request, explicit_fields },
      title,
      platform,
      format,
      tested_element,
      variants: { control, treatment (array), source },
      objective,
      hypothesis,
      metric: { primary, secondary (array), source },
      channel,
      city,
      category,
      page_query,
      publish_at_iso (YYYY-MM-DD HH:mm),
      publish_at_text,
      review_at_iso (YYYY-MM-DD HH:mm),
      review_at_text,
      test_link,
      strategic_notes: [{ category, severity, note }],
      memory_queries: [{ source, query, why }],
      confidence (0-1),
      open_questions (array)
    }
  ],
  ambiguity: [{ field, options }],
  follow_up_question
}

═══════════════════════════════════════════════════════════
REGRAS
═══════════════════════════════════════════════════════════

- Nunca invente URLs.
- Nunca recuse estruturar — sinalize problemas via strategic_notes critical.
- Variantes ausentes: PROPONHA antes de perguntar.
- follow_up_question consolida open_questions em UMA pergunta natural.
- confidence reflete segurança real da estruturação.
- Hipóteses causais reais com mecanismo, nunca tautológicas.
- Métricas: sugira 2-3 quando o usuário não definiu (deixe primary vazio).
- Defaults de review_at quando não informado:
  - LP: +7 dias
  - Instagram orgânico: +48h
  - Ads: +14 dias
- Se a mensagem não for criação de teste: intent = unknown, experiments = [].
`;

async function analyzeExperimentMessage(message) {
  const today = new Date().toISOString();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT + `\n\nData atual (use como âncora pra normalizar datas relativas): ${today}`,
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content;

    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error("JSON inválido do agente:", raw);
      return {
        intent: "unknown",
        experiments: [],
        ambiguity: [],
        follow_up_question: "Não consegui interpretar sua mensagem. Pode reformular?",
      };
    }
  } catch (err) {
    console.error("Erro chamando OpenAI:", err);
    return {
      intent: "unknown",
      experiments: [],
      ambiguity: [],
      follow_up_question: "Tive um problema técnico ao analisar. Tente de novo em alguns segundos.",
    };
  }
}

// Chamada mais leve pra extrair APENAS o que o usuário mencionou no follow-up.
// Diferente do agente principal: não roda 4 camadas, só extrai delta.
async function extractFollowUpPatch(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Extraia APENAS os campos que o usuário mencionou nessa resposta de follow-up de um teste.
Devolva JSON com chaves opcionais (omita o que não foi mencionado):
{
  metric: string,
  hypothesis: string,
  objective: string,
  variants_control: string,
  variants_treatment: array de strings,
  review_at_iso: YYYY-MM-DD HH:mm
}
Nunca invente links. Nunca repita dados que o usuário não disse.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch {
      return {};
    }
  } catch (err) {
    console.error("Erro no follow-up extract:", err);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
// LANDING PAGES — busca no Supabase
// ═══════════════════════════════════════════════════════════

async function findLandingPage(exp, message) {
  const text = normalizeText(
    `${message} ${exp?.city || ""} ${exp?.category || ""} ${exp?.page_query || ""}`
  );

  let city = normalizeText(exp?.city || "");
  let category = normalizeText(exp?.category || "");

  if (!city) {
    city = KNOWN_CITIES.find((c) => text.includes(c)) || "";
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

  const { data, error } = await query;

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

// ═══════════════════════════════════════════════════════════
// GA4 — sumário simples
// ═══════════════════════════════════════════════════════════

async function getGA4Summary(pagePath = null) {
  const requestBody = {
    dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
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

// ═══════════════════════════════════════════════════════════
// MEMORY ENGINE — executa as queries declaradas pelo agente
// ═══════════════════════════════════════════════════════════

async function runMemoryQueries(memoryQueries = [], exp) {
  const results = [];

  for (const q of memoryQueries) {
    try {
      if (q.source === "past_experiments") {
        // Busca testes parecidos no Supabase
        const terms = [exp.tested_element, exp.city, exp.category, exp.platform]
          .filter(Boolean)
          .map(sanitizeSearchTerm);

        if (terms.length === 0) continue;

        const orClause = terms
          .map((t) => `title.ilike.%${t}%,hypothesis.ilike.%${t}%,learning.ilike.%${t}%`)
          .join(",");

        const { data } = await supabase
          .from("experiments")
          .select("id, title, result, learning, status")
          .or(orClause)
          .eq("status", "completed")
          .limit(3);

        if (data && data.length) {
          results.push({
            source: "past_experiments",
            query: q.query,
            findings: data.map((d) => `#${d.id} ${d.title} → ${d.learning || d.result || "sem aprendizado"}`),
          });
        }
      } else if (q.source === "ga4" && exp.test_link) {
        // Tenta puxar baseline da página
        const pagePath = extractPath(exp.test_link);
        const summary = await getGA4Summary(pagePath);

        if (summary) {
          results.push({
            source: "ga4",
            query: q.query,
            findings: [
              `${summary.users} usuários | ${summary.sessions} sessões | ${summary.pageviews} pageviews (últimos 7 dias)`,
            ],
          });
        }
      }
      // Outras fontes (instagram_insights, internal_benchmarks, brand_patterns)
      // ainda não implementadas — pulam silenciosamente
    } catch (err) {
      console.error(`Erro executando memory query (${q.source}):`, err.message);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// USER STATE — persistência no Supabase
// ═══════════════════════════════════════════════════════════

async function getUserState(telegramId) {
  const { data } = await supabase
    .from("user_states")
    .select("*")
    .eq("telegram_user_id", telegramId)
    .single();

  return data || null;
}

async function setUserState(telegramId, state) {
  await supabase.from("user_states").upsert(
    {
      telegram_user_id: telegramId,
      step: state.step,
      experiment_id: state.experimentId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telegram_user_id" }
  );
}

async function clearUserState(telegramId) {
  await supabase
    .from("user_states")
    .delete()
    .eq("telegram_user_id", telegramId);
}

// ═══════════════════════════════════════════════════════════
// TEAM MEMBERS — upsert com cache em memória
// ═══════════════════════════════════════════════════════════

const seenMembers = new Set();

async function ensureTeamMember(telegramId, username, name) {
  if (seenMembers.has(telegramId)) return;

  await supabase.from("team_members").upsert(
    {
      telegram_user_id: telegramId,
      username,
      name,
    },
    { onConflict: "telegram_user_id" }
  );

  seenMembers.add(telegramId);
}

// ═══════════════════════════════════════════════════════════
// FORMATAÇÃO DE REPLY — resumo do teste pro Telegram
// ═══════════════════════════════════════════════════════════

function formatStrategicNotes(notes = []) {
  const relevant = notes.filter(
    (n) => n.severity === "critical" || n.severity === "attention"
  );

  if (!relevant.length) return "";

  const icons = { critical: "🚨", attention: "⚠️", info: "ℹ️" };

  return (
    "\n\n📋 Observações estratégicas:\n" +
    relevant.map((n) => `${icons[n.severity] || "•"} ${n.note}`).join("\n")
  );
}

function formatMemoryFindings(findings = []) {
  if (!findings.length) return "";

  return (
    "\n\n🧠 Contexto histórico:\n" +
    findings
      .map((f) => `• ${f.source}: ${f.findings.join(" | ")}`)
      .join("\n")
  );
}

function formatVariants(variants) {
  if (!variants) return "não informadas";

  const lines = [];
  if (variants.control) lines.push(`A (controle): ${variants.control}`);
  if (variants.treatment?.length) {
    variants.treatment.forEach((t, i) => {
      lines.push(`${String.fromCharCode(66 + i)} (tratamento): ${t}`);
    });
  }
  return lines.length ? lines.join("\n") : "não informadas";
}

// ═══════════════════════════════════════════════════════════
// COMANDOS DO BOT
// ═══════════════════════════════════════════════════════════

bot.start((ctx) => {
  ctx.reply(
    "Bot de experimentos ativo 🚀\n\nComandos:\n/testes_ativos\n/concluidos\n/aprendizados\n/ver ID\n/buscar termo\n/concluir ID\n/ga\n/ga /rio-cook\n\nOu me diga diretamente o que você quer testar."
  );
});

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL — mensagens de texto
// ═══════════════════════════════════════════════════════════

bot.on("text", async (ctx) => {
  try {
    const message = ctx.message.text.trim();
    const telegramId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const username = ctx.from.username || "";
    const name = ctx.from.first_name || "";

    await ensureTeamMember(telegramId, username, name);

    // ─── Comandos ───────────────────────────────────────────

    if (message.startsWith("/ga")) {
      try {
        const rawPath = message.replace("/ga", "").trim();
        const pagePath = rawPath ? extractPath(rawPath) : null;
        const data = await getGA4Summary(pagePath);

        if (!data) return ctx.reply("Nenhum dado encontrado no GA4.");

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
            `#${t.id} ${t.title}\nResultado: ${t.result || "não informado"}\nAprendizado: ${
              t.learning || "não informado"
            }`
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
        `#${data.id} ${data.title}\n\n` +
          `Status: ${data.status}\n` +
          `Link/local: ${data.test_link || "não informado"}\n` +
          `Métrica: ${data.metric || "não informada"}\n` +
          `Hipótese: ${data.hypothesis || "não informada"}\n` +
          `Variantes:\n${formatVariants({ control: data.variants_control, treatment: data.variants_treatment })}\n` +
          `Revisão: ${formatDate(data.review_at)}\n` +
          `Resultado: ${data.result || "não informado"}\n` +
          `Aprendizado: ${data.learning || "não informado"}`
      );
    }

    if (message.startsWith("/buscar")) {
      const rawTerm = message.replace("/buscar", "").trim();
      if (!rawTerm) return ctx.reply("Use assim:\n/buscar cta");

      const term = sanitizeSearchTerm(rawTerm);
      if (!term) return ctx.reply("Termo de busca inválido.");

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
            `#${t.id} ${t.title}\nStatus: ${t.status}\nLink: ${
              t.test_link || "não informado"
            }\nMétrica: ${t.metric || "não informada"}\nAprendizado: ${
              t.learning || "sem aprendizado registrado"
            }`
        )
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message.startsWith("/concluir")) {
      const experimentId = message.split(" ")[1];
      if (!experimentId) return ctx.reply("Use assim:\n/concluir 12");

      await setUserState(telegramId, {
        step: "ask_result",
        experimentId,
      });

      return ctx.reply("Qual foi o resultado do teste?");
    }

    // ─── Conversa com estado ────────────────────────────────

    const state = await getUserState(telegramId);

    // ─── ESTADO: aguardando resultado ───────────────────────
    if (state?.step === "ask_result") {
      await supabase
        .from("experiments")
        .update({ result: message })
        .eq("id", state.experiment_id);

      await setUserState(telegramId, {
        step: "ask_learning",
        experimentId: state.experiment_id,
      });

      return ctx.reply("Qual foi o principal aprendizado desse teste?");
    }

    // ─── ESTADO: aguardando aprendizado ─────────────────────
    if (state?.step === "ask_learning") {
      await supabase
        .from("experiments")
        .update({
          learning: message,
          status: "completed",
        })
        .eq("id", state.experiment_id);

      await clearUserState(telegramId);

      return ctx.reply("Teste concluído e aprendizado salvo ✅");
    }

    // ─── ESTADO: follow-up de teste em draft ────────────────
    if (state?.step === "ai_followup") {
      const patch = await extractFollowUpPatch(message);

      const updates = {
        open_questions: [],
        missing_fields: [],
        status: "active",
      };

      if (patch.metric) updates.metric = patch.metric;
      if (patch.hypothesis) updates.hypothesis = patch.hypothesis;
      if (patch.objective) updates.objective = patch.objective;
      if (patch.variants_control) updates.variants_control = patch.variants_control;
      if (Array.isArray(patch.variants_treatment) && patch.variants_treatment.length) {
        updates.variants_treatment = patch.variants_treatment;
      }
      if (patch.review_at_iso) {
        const iso = isoFromAgentDate(patch.review_at_iso);
        if (iso) updates.review_at = iso;
      }

      await supabase
        .from("experiments")
        .update(updates)
        .eq("id", state.experiment_id);

      const experimentId = state.experiment_id;
      await clearUserState(telegramId);

      return ctx.reply(`Teste atualizado e ativado ✅\n\nID do teste: ${experimentId}`);
    }

    // ─── Sem estado: análise nova ───────────────────────────

    if (isRateLimited(telegramId)) {
      return ctx.reply("Calma aí, manda uma de cada vez 🙏 espera 3 segundos.");
    }

    const analysis = await analyzeExperimentMessage(message);

    if (analysis.intent !== "create_experiment") {
      return ctx.reply(
        analysis.follow_up_question ||
          "Me diga algo como:\n\nVou testar um CTA novo na LP do Cook in Rio e quero revisar daqui uma semana."
      );
    }

    if (!analysis.experiments?.length) {
      return ctx.reply("Não consegui estruturar o teste. Pode reformular com mais detalhes?");
    }

    // Por enquanto: 1 experimento por mensagem.
    // Se houver mais, avisa e processa só o primeiro.
    if (analysis.experiments.length > 1) {
      await ctx.reply(
        `Detectei ${analysis.experiments.length} testes na sua mensagem. Por enquanto trato um por vez — vou começar pelo primeiro.`
      );
    }

    const exp = analysis.experiments[0];

    // ─── Identificar landing page ───────────────────────────
    const landingPage = await findLandingPage(exp, message);
    const finalUrl = exp.test_link || landingPage?.url || null;

    // ─── Calcular open_questions efetivas ───────────────────
    let openQuestions = Array.isArray(exp.open_questions) ? [...exp.open_questions] : [];

    // Se a página foi identificada, remove perguntas sobre link/URL
    if (finalUrl) {
      openQuestions = openQuestions.filter((q) => {
        const normalized = normalizeText(q);
        return (
          !normalized.includes("link") &&
          !normalized.includes("url") &&
          !normalized.includes("pagina") &&
          !normalized.includes("landing")
        );
      });
    }

    // Métrica é não-bloqueante mas adiciona pergunta se faltou
    const metricPrimary = exp.metric?.primary || null;
    if (!metricPrimary && !openQuestions.some((q) => /m[ée]trica/i.test(q))) {
      openQuestions.push("Qual métrica define o vencedor desse teste?");
    }

    // ─── Executar memory queries ────────────────────────────
    const memoryFindings = await runMemoryQueries(exp.memory_queries, {
      ...exp,
      test_link: finalUrl,
    });

    // ─── Normalizar datas ───────────────────────────────────
    const publishAt = isoFromAgentDate(exp.publish_at_iso);
    const reviewAt = isoFromAgentDate(exp.review_at_iso);

    // ─── Inserir no Supabase ────────────────────────────────
    const { data, error } = await supabase
      .from("experiments")
      .insert({
        title: exp.title || message,
        raw_message: message,
        platform: exp.platform || null,
        format: exp.format || null,
        tested_element: exp.tested_element || null,
        objective: exp.objective || null,
        hypothesis: exp.hypothesis || null,
        metric: metricPrimary,
        metric_secondary: exp.metric?.secondary || [],
        channel: exp.channel || exp.platform || null,
        city: exp.city || null,
        category: exp.category || null,
        test_link: finalUrl,
        variants_control: exp.variants?.control || null,
        variants_treatment: exp.variants?.treatment || [],
        variants_source: exp.variants?.source || null,
        strategic_notes: exp.strategic_notes || [],
        memory_queries: exp.memory_queries || [],
        memory_findings: memoryFindings,
        confidence: typeof exp.confidence === "number" ? exp.confidence : null,
        open_questions: openQuestions,
        missing_fields: openQuestions, // mantido pra compat com schema antigo
        publish_at: publishAt,
        review_at: reviewAt,
        created_by: telegramId,
        telegram_chat_id: chatId,
        status: openQuestions.length ? "draft" : "active",
      })
      .select()
      .single();

    if (error) {
      console.log(error);
      return ctx.reply("Erro ao criar o teste ❌");
    }

    // ─── Montar reply ───────────────────────────────────────
    const notesText = formatStrategicNotes(exp.strategic_notes);
    const findingsText = formatMemoryFindings(memoryFindings);

    const summary =
      `${openQuestions.length ? "Entendi o teste ✅" : "Teste criado ✅"}\n\n` +
      `ID: ${data.id}\n` +
      `Título: ${data.title}\n` +
      `Canal: ${exp.platform || exp.channel || "não informado"}\n` +
      `Elemento testado: ${exp.tested_element || "não informado"}\n` +
      `Hipótese: ${exp.hypothesis || "não informada"}\n` +
      `\nVariantes:\n${formatVariants(exp.variants)}\n` +
      `\nPágina identificada: ${finalUrl || "não identificada"}\n` +
      `Métrica: ${metricPrimary || "a definir"}\n` +
      `Revisão: ${formatDate(reviewAt)}` +
      notesText +
      findingsText;

    if (openQuestions.length) {
      await setUserState(telegramId, {
        step: "ai_followup",
        experimentId: data.id,
      });

      const followUp =
        analysis.follow_up_question ||
        openQuestions.join("\n");

      return ctx.reply(`${summary}\n\n❓ ${followUp}`);
    }

    return ctx.reply(summary);
  } catch (error) {
    console.log(error);
    ctx.reply("Erro inesperado ❌");
  }
});

// ═══════════════════════════════════════════════════════════
// LEMBRETES — check periódico
// ═══════════════════════════════════════════════════════════

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

    try {
      await bot.telegram.sendMessage(
        experiment.telegram_chat_id,
        `🔔 Hora de revisar o teste:\n\n${experiment.title}\n\nMétrica: ${
          experiment.metric || "não informada"
        }\nLink/local: ${experiment.test_link || "não informado"}\n\nPara concluir:\n/concluir ${experiment.id}`
      );

      await supabase
        .from("experiments")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", experiment.id);
    } catch (err) {
      console.error(`Erro enviando lembrete do teste ${experiment.id}:`, err.message);
    }
  }
}

setInterval(checkReminders, 60 * 1000);

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════

bot
  .launch()
  .then(() => console.log("Bot rodando 🚀"))
  .catch((error) => console.log("Erro ao iniciar bot:", error.message));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));