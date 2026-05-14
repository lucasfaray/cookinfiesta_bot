require("dotenv").config();

const express = require("express");
const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");

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

const userState = {};

function parseDate(input) {
  const text = input.toLowerCase().trim();
  const now = new Date();

  if (text.includes("amanhã")) {
    now.setDate(now.getDate() + 1);
    now.setHours(9, 0, 0, 0);
    return now;
  }

  const daquiMatch = text.match(/daqui (\d+) dias?/);

  if (daquiMatch) {
    now.setDate(now.getDate() + Number(daquiMatch[1]));
    now.setHours(9, 0, 0, 0);
    return now;
  }

  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);

  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const year = Number(dateMatch[3]);

    return new Date(year, month, day, 9, 0, 0);
  }

  return null;
}

function formatDate(date) {
  if (!date) return "sem data";

  return new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

bot.start((ctx) => {
  ctx.reply(
    "Bot de experimentos ativo 🚀\n\nComandos:\n/testes_ativos\n/concluidos\n/aprendizados\n/ver ID\n/buscar termo\n/concluir ID\n\nOu me diga diretamente o que você quer testar."
  );
});

bot.on("text", async (ctx) => {
  try {
    const message = ctx.message.text;

    const telegramId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const username = ctx.from.username || "";
    const name = ctx.from.first_name || "";

    await supabase.from("team_members").upsert({
      telegram_user_id: telegramId,
      username,
      name,
    });

    if (message === "/testes_ativos") {
      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) return ctx.reply("Erro ao buscar testes ativos ❌");

      if (!data.length) {
        return ctx.reply("Nenhum teste ativo encontrado.");
      }

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

      if (!data.length) {
        return ctx.reply("Nenhum teste concluído encontrado.");
      }

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

      if (!data.length) {
        return ctx.reply("Nenhum aprendizado salvo ainda.");
      }

      const text = data
        .map(
          (t) =>
            `#${t.id} ${t.title}\nAprendizado: ${t.learning}`
        )
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message.startsWith("/ver")) {
      const id = message.split(" ")[1];

      if (!id) {
        return ctx.reply("Use assim:\n/ver 12");
      }

      const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) {
        return ctx.reply("Teste não encontrado.");
      }

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
        }\nAprendizado: ${
          data.learning || "não informado"
        }`
      );
    }

    if (message.startsWith("/buscar")) {
      const term = message.replace("/buscar", "").trim();

      if (!term) {
        return ctx.reply("Use assim:\n/buscar cta");
      }

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

      if (!data.length) {
        return ctx.reply("Nenhum teste encontrado.");
      }

      const text = data
        .map(
          (t) =>
            `#${t.id} ${t.title}\nStatus: ${
              t.status
            }\nMétrica: ${
              t.metric || "não informada"
            }\nAprendizado: ${
              t.learning || "sem aprendizado registrado"
            }`
        )
        .join("\n\n");

      return ctx.reply(text);
    }

    if (message.startsWith("/concluir")) {
      const experimentId = message.split(" ")[1];

      if (!experimentId) {
        return ctx.reply("Use assim:\n/concluir 12");
      }

      userState[telegramId] = {
        experimentId,
        step: "ask_result",
      };

      return ctx.reply("Qual foi o resultado do teste?");
    }

    const state = userState[telegramId];

    if (!state) {
      const { data, error } = await supabase
        .from("experiments")
        .insert({
          title: message,
          created_by: telegramId,
          telegram_chat_id: chatId,
          status: "draft",
        })
        .select()
        .single();

      if (error) {
        console.log(error);
        return ctx.reply("Erro ao criar o teste ❌");
      }

      userState[telegramId] = {
        experimentId: data.id,
        step: "ask_link",
      };

      return ctx.reply(
        "Onde esse teste vai acontecer? Envie o link ou local."
      );
    }

    if (state.step === "ask_link") {
      await supabase
        .from("experiments")
        .update({
          test_link: message,
        })
        .eq("id", state.experimentId);

      userState[telegramId].step = "ask_metric";

      return ctx.reply(
        "Qual métrica vamos olhar?\n\nExemplo: cliques, reservas, CTR, conversão."
      );
    }

    if (state.step === "ask_metric") {
      await supabase
        .from("experiments")
        .update({
          metric: message,
        })
        .eq("id", state.experimentId);

      userState[telegramId].step = "ask_review_date";

      return ctx.reply(
        "Quando você quer revisar esse teste?\n\nExemplos:\n- amanhã\n- daqui 3 dias\n- 20/05/2026"
      );
    }

    if (state.step === "ask_review_date") {
      const reviewDate = parseDate(message);

      if (!reviewDate) {
        return ctx.reply(
          "Não entendi a data.\n\nUse:\n- amanhã\n- daqui 3 dias\n- 20/05/2026"
        );
      }

      await supabase
        .from("experiments")
        .update({
          review_at: reviewDate.toISOString(),
          status: "active",
        })
        .eq("id", state.experimentId);

      const experimentId = state.experimentId;

      delete userState[telegramId];

      return ctx.reply(
        `Teste ativado ✅\n\nID do teste: ${experimentId}\nVou te lembrar aqui no Telegram.`
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

      return ctx.reply(
        "Qual foi o principal aprendizado desse teste?"
      );
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

      return ctx.reply(
        "Teste concluído e aprendizado salvo ✅"
      );
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