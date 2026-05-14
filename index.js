require("dotenv").config();

const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");

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

bot.start((ctx) => {
  ctx.reply("Bot de experimentos ativo 🚀\n\nMe diga o que você quer testar.");
});

bot.on("text", async (ctx) => {
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

  if (message.startsWith("/concluir")) {
    const parts = message.split(" ");
    const experimentId = parts[1];

    if (!experimentId) {
      return ctx.reply("Me envie assim:\n\n/concluir 1");
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

    return ctx.reply("Onde esse teste vai acontecer? Envie o link ou local.");
  }

  if (state.step === "ask_link") {
    await supabase
      .from("experiments")
      .update({ test_link: message })
      .eq("id", state.experimentId);

    userState[telegramId].step = "ask_metric";

    return ctx.reply("Qual métrica vamos olhar? Ex: cliques, reservas, conversão, CTR.");
  }

  if (state.step === "ask_metric") {
    await supabase
      .from("experiments")
      .update({ metric: message })
      .eq("id", state.experimentId);

    userState[telegramId].step = "ask_review_date";

    return ctx.reply(
      "Quando você quer revisar esse teste?\n\nUse um destes formatos:\n- amanhã\n- daqui 3 dias\n- 20/05/2026"
    );
  }

  if (state.step === "ask_review_date") {
    const reviewDate = parseDate(message);

    if (!reviewDate) {
      return ctx.reply("Não entendi a data. Use: amanhã, daqui 3 dias ou 20/05/2026.");
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
      `Teste ativado ✅\n\nID do teste: ${experimentId}\nVou te lembrar no Telegram na data combinada.`
    );
  }

  if (state.step === "ask_result") {
    await supabase
      .from("experiments")
      .update({ result: message })
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
    console.log("Erro ao buscar lembretes:", error);
    return;
  }

  for (const experiment of data) {
    if (!experiment.telegram_chat_id) continue;

    await bot.telegram.sendMessage(
      experiment.telegram_chat_id,
      `🔔 Hora de revisar o teste:\n\n${experiment.title}\n\nMétrica: ${experiment.metric || "não informada"}\nLink/local: ${experiment.test_link || "não informado"}\n\nPara concluir, envie:\n/concluir ${experiment.id}`
    );

    await supabase
      .from("experiments")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", experiment.id);
  }
}

setInterval(checkReminders, 60 * 1000);

bot.launch();

console.log("Bot rodando 🚀");