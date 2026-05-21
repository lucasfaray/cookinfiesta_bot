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

async function analyzeExperimentMessage(message) {
  const today = new Date().toISOString();

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `
Você é um agente de experimentos de marketing.

Analise mensagens livres e extraia informações sobre testes.

Responda SOMENTE em JSON válido.

Data atual: ${today}

Campos:
- intent
- title
- platform
- format
- tested_element
- objective
- hypothesis
- metric
- channel
- publish_at_text
- review_at_text
- test_link
- missing_fields
- follow_up_question

Regras:
- Se for criação de teste: intent = create_experiment
- Se for comando, pergunta solta ou consulta, intent = unknown
- Extraia o máximo possível
- Não invente métricas
- Não invente links
- Se faltar algo importante, coloque em missing_fields
- Faça apenas as perguntas necessárias
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

async function getGA4Summary() {
  const response = await analyticsDataClient.properties.runReport({
    property: `properties/${process.env.GA4_PROPERTY_ID}`,
    requestBody: {
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
    },
  });

  const rows = response.data.rows?.[0];

  if (!rows) {
    return null;
  }

  return {
    users: rows.metricValues[0].value,
    sessions: rows.metricValues[1].value,
    pageviews: rows.metricValues[2].value,
  };
}

bot.start((ctx) => {
  ctx.reply(
    "Bot de experimentos ativo 🚀\n\nComandos:\n/testes_ativos\n/concluidos\n/aprendizados\n/ver ID\n/buscar termo\n/concluir ID\n/ga\n\nOu me diga diretamente o que você quer testar."
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

    if (message === "/ga") {
      try {
        const data = await getGA4Summary();

        if (!data) {
          return ctx.reply("Nenhum dado encontrado no GA4.");
        }

        return ctx.reply(
          `📊 Google Analytics (últimos 7 dias)\n\n` +
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
            `#${t.id} ${t.title}\nMétrica: ${
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
            }\nMétrica: ${
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

      if (analysis.intent !== "create_experiment") {
        return ctx.reply(
          "Me diga algo como:\n\nVou testar um novo hook no Instagram hoje às 14 e quero revisar semana que vem."
        );
      }

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
          test_link: analysis.test_link || null,
          missing_fields: analysis.missing_fields || [],
          created_by: telegramId,
          telegram_chat_id: chatId,
          status:
            analysis.missing_fields && analysis.missing_fields.length
              ? "draft"
              : "active",
        })
        .select()
        .single();

      if (error) {
        console.log(error);
        return ctx.reply("Erro ao criar o teste ❌");
      }

      if (analysis.missing_fields && analysis.missing_fields.length) {
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
            `Formato: ${analysis.format || "não informado"}\n` +
            `Elemento testado: ${
              analysis.tested_element || "não informado"
            }\n\n` +
            `${analysis.follow_up_question || "Me envie as informações que faltam."}`
        );
      }

      return ctx.reply(
        `Teste criado ✅\n\n` +
          `ID: ${data.id}\n` +
          `Título: ${data.title}\n` +
          `Canal: ${
            analysis.platform || analysis.channel || "não informado"
          }\n` +
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

bot.launch();

console.log("Bot rodando 🚀");