require("dotenv").config();

const http = require("http");
const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/oauth2callback"
);

const scopes = ["https://www.googleapis.com/auth/analytics.readonly"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes,
});

console.log("\nAbra este link no navegador:\n");
console.log(authUrl);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) return;

  const url = new URL(req.url, "http://localhost:3000");
  const code = url.searchParams.get("code");

  const { tokens } = await oauth2Client.getToken(code);

  console.log("\nTOKEN GERADO:\n");
  console.log(JSON.stringify(tokens, null, 2));

  res.end("Autorizado! Pode voltar ao terminal.");

  server.close();
});

server.listen(3000, () => {
  console.log("\nAguardando autorização em http://localhost:3000/oauth2callback\n");
});