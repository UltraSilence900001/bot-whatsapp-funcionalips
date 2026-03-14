const axios = require("axios");

/* ======== CONFIGURACION ======== */
const TOKEN = process.env.ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

/* ======== ESTADO DE SESION POR USUARIO ======== */
const sesiones = {};

/* ======== ENVIAR MENSAJE ======== */
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("✅ Mensaje enviado a:", to);
  } catch (error) {
    console.log(
      "❌ Error enviando mensaje:",
      error.response?.data || error.message
    );
  }
}

/* ======== MENU PRINCIPAL ======== */
function menuPrincipal() {
  return `👋 ¡Bienvenido a *IPS Salud Vida*!
Estamos aquí para ayudarte. ¿En qué podemos asistirte hoy?

1️⃣ Agendar cita
2️⃣ Horarios
3️⃣ Sedes
4️⃣ Hablar con un asesor`;
}

/* ======== LOGICA DEL BOT ======== */
async function handleBot(from, text) {
  const msg = text?.trim().toLowerCase();

  if (!sesiones[from]) {
    sesiones[from] = { paso: "inicio", datos: {} };
  }

  const sesion = sesiones[from];
  let response = "";

  /* ── REINICIO ── */
  if (msg === "hola" || msg === "menu" || msg === "menú" || msg === "inicio") {
    sesiones[from] = { paso: "menu", datos: {} };
    await sendMessage(from, menuPrincipal());
    return;
  }

  /* ── MENU PRINCIPAL ── */
  if (sesion.paso === "inicio" || sesion.paso === "menu") {
    sesiones[from] = { paso: "menu", datos: {} };

    if (msg === "1") {
      sesion.paso = "cita_especialidad";
      response = `Perfecto, vamos a agendar tu cita 📅
Por favor, selecciona el tipo de servicio:

1️⃣ Medicina general
2️⃣ Odontología
3️⃣ Psicología
4️⃣ Nutrición
5️⃣ Especialistas
🔙 Escribe *menu* para volver`;

    } else if (msg === "2") {
      response = `🕐 *Horarios de atención por sede:*

🏢 *Sede Centro*
Lunes a viernes: 7:00 AM – 6:00 PM
Sábados: 8:00 AM – 1:00 PM

🏢 *Sede Norte*
Lunes a viernes: 7:00 AM – 5:00 PM
Sábados: 8:00 AM – 12:00 PM

🏢 *Sede Sur*
Lunes a viernes: 8:00 AM – 6:00 PM
Sábados: 9:00 AM – 1:00 PM

⚠️ Los domingos y festivos no hay atención presencial.
Para urgencias llama al 📞 018000-000000

¿Deseas algo más?
1️⃣ Agendar una cita
3️⃣ Ver sedes
🔙 Escribe *menu* para volver`;

    } else if (msg === "3") {
      sesion.paso = "sedes";
      response = `📍 *Nuestras sedes disponibles:*

1️⃣ Sede Centro
2️⃣ Sede Norte
3️⃣ Sede Sur
🔙 Escribe *menu* para volver`;

    } else if (msg === "4") {
      sesion.paso = "asesor_motivo";
      response = `👨‍💼 Con gusto te conectamos con un asesor.

Por favor cuéntanos: ¿*Cuál es el motivo de tu consulta?*
(Escribe tu mensaje y te responderemos a la brevedad)`;

    } else {
      response = `😅 No entendí tu mensaje.
Por favor selecciona una opción válida o escribe *menu* para ver el menú principal.

${menuPrincipal()}`;
    }

    await sendMessage(from, response);
    return;
  }

  /* ── FLUJO: AGENDAR CITA ── */
  if (sesion.paso === "cita_especialidad") {
    const especialidades = {
      "1": "Medicina General",
      "2": "Odontología",
      "3": "Psicología",
      "4": "Nutrición",
      "5": "Especialistas"
    };

    if (especialidades[msg]) {
      sesion.datos.especialidad = especialidades[msg];
      sesion.paso = "cita_eps";
      response = `Has seleccionado *${sesion.datos.especialidad}* 🩺
¿Con qué EPS o aseguradora estás afiliado?

1️⃣ Sura
2️⃣ Sanitas
3️⃣ Nueva EPS
4️⃣ Coosalud
5️⃣ Particular (sin EPS)
6️⃣ Otra
🔙 Escribe *menu* para volver`;
    } else {
      response = `Por favor selecciona una opción válida:

1️⃣ Medicina general
2️⃣ Odontología
3️⃣ Psicología
4️⃣ Nutrición
5️⃣ Especialistas
🔙 Escribe *menu* para volver`;
    }

    await sendMessage(from, response);
    return;
  }

  if (sesion.paso === "cita_eps") {
    const eps = {
      "1": "Sura",
      "2": "Sanitas",
      "3": "Nueva EPS",
      "4": "Coosalud",
      "5": "Particular",
      "6": "Otra"
    };

    if (eps[msg]) {
      sesion.datos.eps = eps[msg];
      sesion.paso = "cita_documento";
      response = `Gracias. Ahora necesitamos algunos datos para continuar 📋

Por favor escribe tu *número de documento de identidad:*`;
    } else {
      response = `Por favor selecciona una opción válida (1 al 6) o escribe *menu* para volver.`;
    }

    await sendMessage(from, response);
    return;
  }

  if (sesion.paso === "cita_documento") {
    if (msg && msg.length >= 6 && !isNaN(text.trim())) {
      sesion.datos.documento = text.trim();
      sesion.paso = "cita_nombre";
      response = `✅ Documento recibido.
Ahora escribe tu *nombre completo:*`;
    } else {
      response = `Por favor escribe un número de documento válido (solo números, mínimo 6 dígitos).`;
    }

    await sendMessage(from, response);
    return;
  }

  if (sesion.paso === "cita_nombre") {
    if (text.trim().length >= 3) {
      sesion.datos.nombre = text.trim();
      sesion.paso = "cita_celular";
      response = `Gracias, *${sesion.datos.nombre}*. 😊
¿Cuál es tu *número de celular* para confirmar la cita?`;
    } else {
      response = `Por favor escribe tu nombre completo.`;
    }

    await sendMessage(from, response);
    return;
  }

  if (sesion.paso === "cita_celular") {
    if (text.trim().length >= 7) {
      sesion.datos.celular = text.trim();
      sesion.paso = "cita_fecha";
      response = `Perfecto. Estas son las *fechas disponibles* para tu cita de ${sesion.datos.especialidad}:

1️⃣ Lunes 17 de marzo — 8:00 AM
2️⃣ Lunes 17 de marzo — 10:30 AM
3️⃣ Martes 18 de marzo — 2:00 PM
4️⃣ Miércoles 19 de marzo — 9:00 AM
🔙 Escribe *menu* para volver`;
    } else {
      response = `Por favor escribe un número de celular válido.`;
    }

    await sendMessage(from, response);
    return;
  }

  if (sesion.paso === "cita_fecha") {
    const fechas = {
      "1": "Lunes 17 de marzo — 8:00 AM",
      "2": "Lunes 17 de marzo — 10:30 AM",
      "3": "Martes 18 de marzo — 2:00 PM",
      "4": "Miércoles 19 de marzo — 9:00 AM"
    };

    if (fechas[msg]) {
      sesion.datos.fecha = fechas[msg];
      sesion.paso = "menu";

      response = `🎉 *¡Tu cita ha sido agendada con éxito!*

📋 *Resumen de tu cita:*
👤 Paciente: ${sesion.datos.nombre}
🏥 Servicio: ${sesion.datos.especialidad}
🏦 EPS: ${sesion.datos.eps}
📅 Fecha: ${sesion.datos.fecha}
📍 Sede: Centro — Calle 10 #5-32

Recibirás un recordatorio 24 horas antes por este mismo medio. ✅

¿Deseas hacer algo más?
1️⃣ Agendar otra cita
🔙 Escribe *menu* para volver al inicio`;

      sesion.datos = {};
    } else {
      response = `Por favor selecciona una fecha válida (1 al 4) o escribe *menu* para volver.`;
    }

    await sendMessage(from, response);
    return;
  }

  /* ── FLUJO: SEDES ── */
  if (sesion.paso === "sedes") {
    const infoSedes = {
      "1": `🏢 *Sede Centro*\n\n📌 Dirección: Calle 10 #5-32, Piso 2\n📞 Teléfono: (604) 321-0000\n🕐 Horario: Lunes a viernes 7:00 AM – 6:00 PM | Sábados 8:00 AM – 1:00 PM\n🗺️ Frente al Parque Principal, edificio azul.`,
      "2": `🏢 *Sede Norte*\n\n📌 Dirección: Carrera 45 #80-15\n📞 Teléfono: (604) 321-0001\n🕐 Horario: Lunes a viernes 7:00 AM – 5:00 PM | Sábados 8:00 AM – 12:00 PM\n🗺️ Barrio Santa Lucía, junto al Centro Comercial Norte.`,
      "3": `🏢 *Sede Sur*\n\n📌 Dirección: Avenida 30 #12-40\n📞 Teléfono: (604) 321-0002\n🕐 Horario: Lunes a viernes 8:00 AM – 6:00 PM | Sábados 9:00 AM – 1:00 PM\n🗺️ Diagonal al Hospital del Sur, entrada principal.`
    };

    if (infoSedes[msg]) {
      response = `${infoSedes[msg]}

¿Deseas hacer algo más?
1️⃣ Ver otra sede
2️⃣ Agendar una cita en esta sede
🔙 Escribe *menu* para volver al inicio`;

      if (msg === "2") sesion.paso = "cita_especialidad";

    } else {
      response = `Por favor selecciona una sede válida (1 al 3) o escribe *menu* para volver.`;
    }

    await sendMessage(from, response);
    return;
  }

  /* ── FLUJO: ASESOR ── */
  if (sesion.paso === "asesor_motivo") {
    if (text.trim().length >= 3) {
      sesion.datos.motivo = text.trim();
      sesion.paso = "asesor_espera";
      response = `✅ Hemos recibido tu mensaje.
⏳ Tiempo estimado de espera: *3 a 5 minutos*

Un asesor de *IPS Salud Vida* te atenderá en breve. 😊
Por favor mantén este chat abierto.

¿Deseas hacer algo mientras esperas?
1️⃣ Ver horarios
2️⃣ Ver sedes`;
    } else {
      response = `Por favor cuéntanos el motivo de tu consulta para poder ayudarte mejor.`;
    }

    await sendMessage(from, response);
    return;
  }

  if (sesion.paso === "asesor_espera") {
    if (msg === "1") {
      response = `🕐 *Horarios de atención por sede:*

🏢 *Sede Centro*
Lunes a viernes: 7:00 AM – 6:00 PM | Sábados: 8:00 AM – 1:00 PM

🏢 *Sede Norte*
Lunes a viernes: 7:00 AM – 5:00 PM | Sábados: 8:00 AM – 12:00 PM

🏢 *Sede Sur*
Lunes a viernes: 8:00 AM – 6:00 PM | Sábados: 9:00 AM – 1:00 PM

🔙 Escribe *menu* para volver al inicio`;

    } else if (msg === "2") {
      sesion.paso = "sedes";
      response = `📍 *Nuestras sedes disponibles:*

1️⃣ Sede Centro
2️⃣ Sede Norte
3️⃣ Sede Sur
🔙 Escribe *menu* para volver`;

    } else {
      response = `⏳ Sigue en espera, un asesor te atenderá pronto.
Escribe *menu* si deseas volver al inicio.`;
    }

    await sendMessage(from, response);
    return;
  }

  /* ── FALLBACK GLOBAL ── */
  sesiones[from] = { paso: "menu", datos: {} };
  response = `😅 No entendí tu mensaje.
Escribe *menu* para ver las opciones disponibles o selecciona una opción:

${menuPrincipal()}`;

  await sendMessage(from, response);
}

module.exports = handleBot;
