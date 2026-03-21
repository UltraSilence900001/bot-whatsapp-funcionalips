const express = require("express");
const app     = express();

const { handleBot } = require("./bot");
const panelRouter   = require("./Panel");

require("./Recordatorios");

app.use(express.json());
app.use("/panel", panelRouter);

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ipsbot2026";

app.get("/", (req, res) => {
  res.send(`<h2>IPS Salud Vida - Bot activo</h2><a href="/panel">Panel de administracion</a>`);
});

app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from     = message.from;
    let text       = null;
    let buttonId   = null;

    if (message.type === "text") {
      text = message.text.body;
    } else if (message.type === "interactive") {
      if (message.interactive.type === "button_reply") {
        buttonId = message.interactive.button_reply.id;
        text     = message.interactive.button_reply.title;
      } else if (message.interactive.type === "list_reply") {
        buttonId = message.interactive.list_reply.id;
        text     = message.interactive.list_reply.title;
      }
    }

    console.log(`De: ${from} | Texto: ${text} | ButtonId: ${buttonId}`);
    await handleBot(from, text, buttonId);
    return res.sendStatus(200);

  } catch (e) {
    console.error("Error:", e);
    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor activo en puerto ${PORT}`);
  console.log(`Panel: http://localhost:${PORT}/panel`);
});
