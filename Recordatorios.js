const cron                             = require("node-cron");
const { sendText, sendButtons, redis } = require("./bot");

async function enviarRecordatorio(cita, tipo) {
  const es24h  = tipo === "24h";
  const titulo = es24h ? `⏰ *Recordatorio — Tu cita es mañana*` : `🔔 *Recordatorio — Tu cita es en 2 horas*`;

  await sendText(cita.phone,
    `${titulo}\n\n` +
    `👤 Paciente: ${cita.nombre}\n` +
    `🏥 Servicio: ${cita.especialidad}\n` +
    `📅 Fecha: ${cita.label}\n` +
    `📍 Sede: ${cita.sede}\n\n` +
    `Por favor confirma o cancela tu cita:`
  );

  await sendButtons(cita.phone, {
    header: "🏥 IPS Salud Vida",
    body:   "¿Asistirás a tu cita?",
    footer: "Responde para que podamos prepararte",
    buttons: [
      { id: "cita_confirmar", title: "✅ Confirmar cita" },
      { id: "cita_cancelar",  title: "❌ Cancelar cita"  }
    ]
  });

  console.log(`📨 Recordatorio ${tipo} enviado a ${cita.phone} — ${cita.label}`);
}

async function verificarCitas() {
  try {
    const keys = await redis.smembers("citas:activas");

    for (const key of keys) {
      const data = await redis.get(key);
      if (!data) {
        await redis.srem("citas:activas", key);
        continue;
      }

      const cita      = JSON.parse(data);
      const ahora     = new Date();
      const fechaCita = new Date(cita.fechaISO);
      const diffHoras = (fechaCita - ahora) / (1000 * 60 * 60);

      // Cita ya pasó — eliminar
      if (diffHoras < 0) {
        await redis.del(key);
        await redis.srem("citas:activas", key);
        console.log(`🗑️ Cita pasada eliminada: ${key}`);
        continue;
      }

      // Recordatorio 24h — ventana entre 24h y 23h antes
      if (diffHoras <= 24 && diffHoras > 23 && !cita.recordatorio24) {
        await enviarRecordatorio(cita, "24h");
        cita.recordatorio24 = true;
        await redis.set(key, JSON.stringify(cita), "KEEPTTL");
      }

      // Recordatorio 2h — ventana entre 2h y 1h antes
      if (diffHoras <= 2 && diffHoras > 1 && !cita.recordatorio2) {
        await enviarRecordatorio(cita, "2h");
        cita.recordatorio2 = true;
        await redis.set(key, JSON.stringify(cita), "KEEPTTL");
      }
    }
  } catch (e) {
    console.error("❌ Error en verificarCitas:", e.message);
  }
}

// Ejecutar cada minuto
cron.schedule("* * * * *", () => {
  console.log("🔍 Verificando citas pendientes...");
  verificarCitas();
});

console.log("✅ Sistema de recordatorios activo (revisión cada minuto)");