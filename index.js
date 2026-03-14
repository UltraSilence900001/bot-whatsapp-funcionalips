const express = require("express");
const app = express();

const handleBot = require("./bot");

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "12345";

app.get("/", (req, res) => {
  res.status(200).send("Servidor WhatsApp Bot funcionando correctamente");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente");
    return res.status(200).send(challenge);
  } else {
    console.log("Error en verificación del webhook");
    return res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    let text = "";

    if (message.type === "text") {
      text = message.text.body.toLowerCase();
    }

    console.log("Mensaje recibido de:", from);
    console.log("Texto:", text);

    await handleBot(from, text);

    return res.sendStatus(200);

  } catch (error) {
    console.error("Error procesando mensaje:", error);
    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
