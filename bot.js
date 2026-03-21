const axios  = require("axios");
const Redis  = require("ioredis");

/* ======== CONFIGURACION ======== */
const TOKEN    = process.env.ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

/* ======== REDIS ======== */
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
redis.on("connect", () => console.log("Redis conectado"));
redis.on("error",   (e) => console.error("Redis error:", e.message));

const SESSION_TTL = 60 * 60 * 24;
redis.on("connect", () => console.log("✅ Redis conectado correctamente"));
redis.on("error",   (e) => console.error("❌ Redis error:", e.message));

const SESSION_TTL = 60 * 60 * 24;

/* ======================================================
   HELPERS DE FECHA
   ====================================================== */
function fechaKey(d = new Date()) { return d.toISOString().slice(0,10); }
function semanaKey(d = new Date()) {
  const x = new Date(d), day = x.getDay()||7;
  x.setDate(x.getDate()-day+1);
  return `${x.getFullYear()}-W${String(Math.ceil(x.getDate()/7)).padStart(2,"0")}`;
}
function mesKey(d = new Date()) { return d.toISOString().slice(0,7); }

/* ======================================================
   SESIONES
   ====================================================== */
async function getSession(from) {
  const data = await redis.get(`session:${from}`);
  return data ? JSON.parse(data) : { paso:"inicio", datos:{} };
}
async function saveSession(from, sesion) {
  await redis.set(`session:${from}`, JSON.stringify(sesion), "EX", SESSION_TTL);
}
async function clearSession(from) { await redis.del(`session:${from}`); }

/* ======================================================
   MÉTRICAS
   ====================================================== */
async function trackConversacion(from) {
  const hoy = fechaKey();
  await redis.sadd("usuarios:unicos", from);
  await redis.sadd(`conv:dia:${hoy}`, from);
  await redis.sadd(`conv:semana:${semanaKey()}`, from);
  await redis.sadd(`conv:mes:${mesKey()}`, from);
  const key = `usuario:${from}`;
  if (!await redis.exists(key)) await redis.hset(key, { phone:from, primeraConv:new Date().toISOString(), citas:0 });
  await redis.hset(key, "ultimaConv", new Date().toISOString());
}
async function trackCita(cita) {
  const hoy = fechaKey();
  await redis.incr(`citas:count:dia:${hoy}`);
  await redis.incr(`citas:count:semana:${semanaKey()}`);
  await redis.incr(`citas:count:mes:${mesKey()}`);
  await redis.incr(`citas:especialidad:${cita.especialidad}`);
  await redis.sadd("usuarios:con:cita", cita.phone);
  const prev = parseInt(await redis.hget(`usuario:${cita.phone}`,"citas")||0);
  await redis.hset(`usuario:${cita.phone}`, "citas", prev+1, "nombre", cita.nombre);
}

/* ======================================================
   GUARDAR CITA EN REDIS
   ====================================================== */
async function guardarCitaRedis(cita) {
  const id = `cita:${cita.phone}:${Date.now()}`;
  await redis.set(id, JSON.stringify({...cita, id, creadaEn:new Date().toISOString()}), "EX", 60*60*24*30);
  await redis.sadd("citas:activas", id);
  await trackCita(cita);
  console.log("📅 Cita guardada en Redis:", id);
  return id;
}

/* ======================================================
   FUNCIONES DE ENVIO
   ====================================================== */
async function sendText(to, body) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      { messaging_product:"whatsapp", to, type:"text", text:{ body, preview_url:false } },
      { headers:{ Authorization:`Bearer ${TOKEN}`, "Content-Type":"application/json" } }
    );
    console.log("✅ Texto →", to);
  } catch(e) { console.log("❌ Error texto:", e.response?.data||e.message); }
}

async function sendButtons(to, { header, body, footer, buttons }) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product:"whatsapp", to, type:"interactive",
        interactive:{
          type:"button",
          ...(header && { header:{ type:"text", text:header } }),
          body:{ text:body },
          ...(footer && { footer:{ text:footer } }),
          action:{ buttons:buttons.map(b=>({ type:"reply", reply:{ id:b.id, title:b.title } })) }
        }
      },
      { headers:{ Authorization:`Bearer ${TOKEN}`, "Content-Type":"application/json" } }
    );
    console.log("✅ Botones →", to);
  } catch(e) { console.log("❌ Error botones:", e.response?.data||e.message); }
}

async function sendList(to, { header, body, footer, buttonLabel, sections }) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product:"whatsapp", to, type:"interactive",
        interactive:{
          type:"list",
          ...(header && { header:{ type:"text", text:header } }),
          body:{ text:body },
          ...(footer && { footer:{ text:footer } }),
          action:{ button:buttonLabel||"Ver opciones", sections }
        }
      },
      { headers:{ Authorization:`Bearer ${TOKEN}`, "Content-Type":"application/json" } }
    );
    console.log("✅ Lista →", to);
  } catch(e) { console.log("❌ Error lista:", e.response?.data||e.message); }
}

/* ======================================================
   MENUS REUTILIZABLES
   ====================================================== */
async function enviarMenuPrincipal(to) {
  await sendButtons(to, {
    header:"🏥 IPS Salud Vida",
    body:"¡Bienvenido! ¿En qué podemos ayudarte hoy?",
    footer:"Selecciona una opción para continuar",
    buttons:[
      { id:"menu_cita",     title:"📅 Agendar cita" },
      { id:"menu_horarios", title:"🕐 Horarios"      },
      { id:"menu_sedes",    title:"📍 Sedes"         }
    ]
  });
  await sendButtons(to, {
    body:"¿Necesitas hablar con alguien?",
    buttons:[{ id:"menu_asesor", title:"👨‍💼 Hablar con asesor" }]
  });
}

async function enviarMenuEspecialidades(to) {
  await sendList(to, {
    header:"📅 Agendar Cita", body:"Selecciona el tipo de servicio:",
    footer:"IPS Salud Vida", buttonLabel:"Ver servicios",
    sections:[{ title:"Servicios disponibles", rows:[
      { id:"esp_medicina",     title:"🩺 Medicina General" },
      { id:"esp_odonto",       title:"🦷 Odontología"      },
      { id:"esp_psicologia",   title:"🧠 Psicología"       },
      { id:"esp_nutricion",    title:"🥗 Nutrición"        },
      { id:"esp_especialista", title:"👨‍⚕️ Especialistas"  }
    ]}]
  });
}

async function enviarMenuEPS(to, especialidad) {
  await sendList(to, {
    header:`🩺 ${especialidad}`, body:"¿Con qué EPS estás afiliado?",
    footer:"IPS Salud Vida", buttonLabel:"Seleccionar EPS",
    sections:[{ title:"EPS / Aseguradora", rows:[
      { id:"eps_sura",       title:"Sura"                 },
      { id:"eps_sanitas",    title:"Sanitas"              },
      { id:"eps_nueva",      title:"Nueva EPS"            },
      { id:"eps_coosalud",   title:"Coosalud"             },
      { id:"eps_particular", title:"Particular (sin EPS)" },
      { id:"eps_otra",       title:"Otra"                 }
    ]}]
  });
}

/* ── Menú de sedes para elegir antes de ver fechas ── */
async function enviarMenuSedesCita(to) {
  await sendButtons(to, {
    header:"📍 ¿En qué sede prefieres tu cita?",
    body:"Selecciona la sede para ver disponibilidad en tiempo real:",
    footer:"Mostramos solo horarios disponibles",
    buttons:[
      { id:"sede_cita_centro", title:"🏢 Sede Centro" },
      { id:"sede_cita_norte",  title:"🏢 Sede Norte"  },
      { id:"sede_cita_sur",    title:"🏢 Sede Sur"    }
    ]
  });
}

/* ── Enviar slots reales de Google Calendar ── */
async function enviarSlotsFechas(to, sede, especialidad) {
  const { obtenerSlotsConCache } = require("./calendar");

  await sendText(to, `🔍 Consultando disponibilidad en *${sede}*...\nEspera un momento ⏳`);

  const slots = await obtenerSlotsConCache(sede);

  if (!slots || slots.length === 0) {
    await sendText(to,
      `😔 No hay disponibilidad en *${sede}* para los próximos días.\n\n` +
      `¿Deseas consultar en otra sede?`
    );
    await enviarMenuSedesCita(to);
    return false;
  }

  // Tomar máximo 8 slots y construir la lista
  const rows = slots.slice(0, 8).map((slot, i) => ({
    id:          `slot_${i}`,
    title:       slot.label,
    description: sede
  }));

  // Guardar los slots en sesión temporalmente para recuperarlos al seleccionar
  await redis.set(`slots:seleccion:${to}`, JSON.stringify(slots.slice(0,8)), "EX", 60*15);

  await sendList(to, {
    header:`📅 Disponibilidad — ${sede}`,
    body:`Selecciona tu horario para *${especialidad}*:`,
    footer:"Solo se muestran horarios disponibles en tiempo real",
    buttonLabel:"Ver horarios",
    sections:[{ title:`Próximos horarios libres`, rows }]
  });

  return true;
}

async function enviarMenuSedes(to) {
  await sendButtons(to, {
    header:"📍 Nuestras Sedes", body:"¿Qué sede deseas consultar?",
    buttons:[
      { id:"sede_centro", title:"🏢 Sede Centro" },
      { id:"sede_norte",  title:"🏢 Sede Norte"  },
      { id:"sede_sur",    title:"🏢 Sede Sur"    }
    ]
  });
}

/* ======================================================
   NOTIFICAR A ASESORES
   ====================================================== */
async function notificarAsesores(phoneUsuario, nombre, motivo) {
  const { ASESORES, getAsesorDisponible, asignarAsesor, agregarACola } = require("./asesor");
  const asesorLibre = await getAsesorDisponible();

  if (asesorLibre) {
    await asignarAsesor(phoneUsuario, asesorLibre.phone);
    let infoCita = null;
    const keys = await redis.smembers("citas:activas");
    for (const key of keys) {
      if (key.includes(phoneUsuario)) {
        const data = await redis.get(key);
        if (data) infoCita = JSON.parse(data);
      }
    }
    let msgAsesor =
      `🔔 *Nueva consulta asignada*\n\n👤 ${nombre||phoneUsuario}\n📱 +${phoneUsuario}\n💬 ${motivo}\n`;
    if (infoCita) {
      msgAsesor += `\n📋 *Cita:*\n🏥 ${infoCita.especialidad} | 🏦 ${infoCita.eps}\n📅 ${infoCita.label}\n📍 ${infoCita.sede}\n`;
    }
    msgAsesor += `\n─────────────────\n💡 *Comandos:*\nEscribe para responder.\n*#fin* — terminar\n*#info* — datos usuario\n*#cola* — usuarios en espera\n─────────────────`;
    await sendText(asesorLibre.phone, msgAsesor);
    return { asignado: true, asesor: asesorLibre };
  } else {
    const posicion = await agregarACola(phoneUsuario, motivo, nombre);
    for (const [phone] of Object.entries(ASESORES)) {
      await sendText(phone, `⚠️ *Usuario en espera #${posicion}*\n👤 ${nombre||phoneUsuario}\n💬 ${motivo}\n\n*#siguiente* para atenderlo.`);
    }
    return { asignado: false, posicion };
  }
}

/* ======================================================
   MANEJAR MENSAJES DE ASESORES
   ====================================================== */
async function manejarMensajeAsesor(phoneAsesor, texto) {
  const { getUsuarioDeAsesor, finalizarAtencion, siguienteEnCola, asignarAsesor, tamañoCola, ASESORES } = require("./asesor");
  const cmd = texto?.trim().toLowerCase();
  const phoneUsuario = await getUsuarioDeAsesor(phoneAsesor);
  const asesorInfo   = ASESORES[phoneAsesor];

  if (cmd === "#fin") {
    if (!phoneUsuario) { await sendText(phoneAsesor,"ℹ️ No tienes usuarios asignados."); return; }
    await sendText(phoneUsuario, `✅ *Atención finalizada.*\nGracias por contactar a *IPS Salud Vida*. ¡Que tengas un excelente día! 💚`);
    await sendButtons(phoneUsuario, { body:"¿Algo más en lo que podamos ayudarte?", buttons:[
      { id:"menu_cita", title:"📅 Agendar cita" }, { id:"menu_principal", title:"🏠 Menú principal" }
    ]});
    await saveSession(phoneUsuario, { paso:"menu", datos:{} });
    await finalizarAtencion(phoneUsuario, phoneAsesor);
    await sendText(phoneAsesor, `✅ Atención finalizada con *+${phoneUsuario}*. Bot reactivado.`);
    const siguiente = await siguienteEnCola();
    if (siguiente) {
      await asignarAsesor(siguiente.phone, phoneAsesor);
      await sendText(phoneAsesor, `🔔 *Siguiente:*\n👤 ${siguiente.nombre||siguiente.phone}\n📱 +${siguiente.phone}\n💬 ${siguiente.motivo}\n\n*#fin* para terminar.`);
      await sendText(siguiente.phone, `✅ *¡Asesor disponible!*\n👨‍💼 *${asesorInfo.nombre}* te atenderá ahora. 💬`);
    } else {
      await sendText(phoneAsesor, "ℹ️ No hay más usuarios en cola. 🎉");
    }
    return;
  }
  if (cmd === "#siguiente") {
    if (phoneUsuario) { await sendText(phoneAsesor,`⚠️ Aún tienes activo +${phoneUsuario}. Escribe *#fin* primero.`); return; }
    const siguiente = await siguienteEnCola();
    if (siguiente) {
      await asignarAsesor(siguiente.phone, phoneAsesor);
      await sendText(phoneAsesor, `✅ *Nuevo usuario:*\n👤 ${siguiente.nombre||siguiente.phone}\n📱 +${siguiente.phone}\n💬 ${siguiente.motivo}`);
      await sendText(siguiente.phone, `✅ *¡Asesor disponible!*\n👨‍💼 *${asesorInfo.nombre}* te atenderá ahora. 💬`);
    } else { await sendText(phoneAsesor,"ℹ️ No hay usuarios en cola."); }
    return;
  }
  if (cmd === "#info") {
    if (!phoneUsuario) { await sendText(phoneAsesor,"ℹ️ No tienes usuarios asignados."); return; }
    const datos = await redis.hgetall(`usuario:${phoneUsuario}`);
    let infoCita = null;
    const keys = await redis.smembers("citas:activas");
    for (const key of keys) {
      if (key.includes(phoneUsuario)) { const d = await redis.get(key); if (d) infoCita = JSON.parse(d); }
    }
    let msg = `📋 *+${phoneUsuario}*\n👤 ${datos?.nombre||"—"}\n💬 Citas: ${datos?.citas||0}`;
    if (infoCita) msg += `\n\n✅ *Cita:*\n🏥 ${infoCita.especialidad} | ${infoCita.eps}\n📅 ${infoCita.label}\n📍 ${infoCita.sede}`;
    await sendText(phoneAsesor, msg); return;
  }
  if (cmd === "#cola") {
    const c = await tamañoCola();
    await sendText(phoneAsesor, `📊 Usuarios en cola: *${c}*`); return;
  }
  if (!phoneUsuario) {
    await sendText(phoneAsesor,`ℹ️ Sin usuarios asignados.\n*#siguiente* — tomar siguiente\n*#cola* — ver cola`); return;
  }
  await sendText(phoneUsuario, `👨‍💼 *${asesorInfo.nombre}:*\n\n${texto}`);
  console.log(`📨 Asesor ${phoneAsesor} → Usuario ${phoneUsuario}`);
}

/* ======================================================
   LOGICA PRINCIPAL DEL BOT
   ====================================================== */
async function handleBot(from, text, buttonId) {
  const { esAsesor, getAsesorDeUsuario } = require("./asesor");
  const { crearEvento, cancelarEvento, invalidarCache } = require("./calendar");

  const msg     = text?.trim().toLowerCase() || "";
  const payload = buttonId || msg;

  /* ── ¿Es asesor? ── */
  if (esAsesor(from)) { await manejarMensajeAsesor(from, text); return; }

  await trackConversacion(from);

  /* ── ¿Está con asesor? ── */
  const phoneAsesor = await getAsesorDeUsuario(from);
  if (phoneAsesor) {
    const nombre = await redis.hget(`usuario:${from}`,"nombre") || from;
    await sendText(phoneAsesor, `💬 *${nombre} (+${from}):*\n\n${text||"(tocó un botón)"}`);
    return;
  }

  const sesion = await getSession(from);

  /* ── Reinicio ── */
  if (["hola","menu","menú","inicio","start"].includes(msg) || payload === "menu_principal") {
    await clearSession(from);
    await saveSession(from, { paso:"menu", datos:{} });
    await enviarMenuPrincipal(from); return;
  }

  /* ── Confirmar / cancelar cita ── */
  if (payload === "cita_confirmar") {
    await sendText(from,`✅ *¡Cita confirmada!*\nTe esperamos. Llega 10 minutos antes. 😊`);
    await saveSession(from, sesion); return;
  }
  if (payload === "cita_cancelar") {
    const keys = await redis.smembers("citas:activas");
    for (const key of keys) {
      if (key.includes(from)) {
        const data = await redis.get(key);
        if (data) {
          const cita = JSON.parse(data);
          // Cancelar también en Google Calendar
          if (cita.googleEventId) await cancelarEvento(cita.googleEventId);
          if (cita.sede) await invalidarCache(cita.sede);
        }
        await redis.del(key); await redis.srem("citas:activas", key);
      }
    }
    await sendText(from,`❌ *Cita cancelada.*\nSi deseas reagendar, estamos aquí. 🙏`);
    await sendButtons(from, { body:"¿Deseas agendar una nueva cita?", buttons:[
      { id:"menu_cita", title:"📅 Agendar cita" }, { id:"menu_principal", title:"🏠 Menú principal" }
    ]});
    await saveSession(from,{ paso:"menu", datos:{} }); return;
  }

  /* ── Menú principal ── */
  if (sesion.paso === "inicio" || sesion.paso === "menu") {
    sesion.paso = "menu";
    if (payload === "menu_cita") {
      sesion.paso = "cita_especialidad";
      await saveSession(from, sesion); await enviarMenuEspecialidades(from);
    } else if (payload === "menu_horarios") {
      await saveSession(from, sesion);
      await sendText(from,
        `🕐 *Horarios de atención:*\n\n🏢 *Sede Centro*\nLun–Vie: 7:00 AM – 6:00 PM\nSáb: 8:00 AM – 1:00 PM\n\n` +
        `🏢 *Sede Norte*\nLun–Vie: 7:00 AM – 5:00 PM\nSáb: 8:00 AM – 12:00 PM\n\n` +
        `🏢 *Sede Sur*\nLun–Vie: 8:00 AM – 6:00 PM\nSáb: 9:00 AM – 1:00 PM\n\n` +
        `⚠️ Domingos y festivos sin atención.\n📞 Urgencias: 018000-000000`
      );
      await sendButtons(from, { body:"¿Deseas hacer algo más?", buttons:[
        { id:"menu_cita", title:"📅 Agendar cita" }, { id:"menu_sedes", title:"📍 Ver sedes" }, { id:"menu_principal", title:"🏠 Menú principal" }
      ]});
    } else if (payload === "menu_sedes") {
      sesion.paso = "sedes"; await saveSession(from, sesion); await enviarMenuSedes(from);
    } else if (payload === "menu_asesor") {
      sesion.paso = "asesor_motivo"; await saveSession(from, sesion);
      await sendText(from,`👨‍💼 Con gusto te conectamos con un asesor.\n\n¿*Cuál es el motivo de tu consulta?*\n_(Escribe tu mensaje)_`);
    } else {
      await saveSession(from, sesion); await enviarMenuPrincipal(from);
    }
    return;
  }

  /* ── Especialidad ── */
  if (sesion.paso === "cita_especialidad") {
    const esp = { esp_medicina:"Medicina General", esp_odonto:"Odontología", esp_psicologia:"Psicología", esp_nutricion:"Nutrición", esp_especialista:"Especialistas" };
    if (esp[payload]) {
      sesion.datos.especialidad = esp[payload]; sesion.paso = "cita_eps";
      await saveSession(from, sesion); await enviarMenuEPS(from, sesion.datos.especialidad);
    } else {
      await saveSession(from, sesion); await sendText(from,"Por favor selecciona una especialidad 👆"); await enviarMenuEspecialidades(from);
    }
    return;
  }

  /* ── EPS ── */
  if (sesion.paso === "cita_eps") {
    const eps = { eps_sura:"Sura", eps_sanitas:"Sanitas", eps_nueva:"Nueva EPS", eps_coosalud:"Coosalud", eps_particular:"Particular", eps_otra:"Otra" };
    if (eps[payload]) {
      sesion.datos.eps = eps[payload]; sesion.paso = "cita_documento";
      await saveSession(from, sesion); await sendText(from,`✅ EPS: *${sesion.datos.eps}*\n\nEscribe tu *número de documento:*`);
    } else {
      await saveSession(from, sesion); await sendText(from,"Por favor selecciona tu EPS 👆"); await enviarMenuEPS(from, sesion.datos.especialidad);
    }
    return;
  }

  /* ── Documento ── */
  if (sesion.paso === "cita_documento") {
    if (text && text.trim().length >= 6 && !isNaN(text.trim())) {
      sesion.datos.documento = text.trim(); sesion.paso = "cita_nombre";
      await saveSession(from, sesion); await sendText(from,`✅ Documento recibido.\n\nEscribe tu *nombre completo:*`);
    } else {
      await saveSession(from, sesion); await sendText(from,"⚠️ Documento inválido (solo números, mínimo 6 dígitos).");
    }
    return;
  }

  /* ── Nombre ── */
  if (sesion.paso === "cita_nombre") {
    if (text && text.trim().length >= 3) {
      sesion.datos.nombre = text.trim(); sesion.paso = "cita_celular";
      await saveSession(from, sesion); await sendText(from,`Gracias, *${sesion.datos.nombre}*. 😊\n\n¿Tu *número de celular*?`);
    } else {
      await saveSession(from, sesion); await sendText(from,"⚠️ Escribe tu nombre completo.");
    }
    return;
  }

  /* ── Celular ── */
  if (sesion.paso === "cita_celular") {
    if (text && text.trim().length >= 7) {
      sesion.datos.celular = text.trim(); sesion.paso = "cita_sede";
      await saveSession(from, sesion);
      // Ahora preguntar sede para consultar disponibilidad real
      await enviarMenuSedesCita(from);
    } else {
      await saveSession(from, sesion); await sendText(from,"⚠️ Número de celular inválido.");
    }
    return;
  }

  /* ── Selección de sede para cita ── */
  if (sesion.paso === "cita_sede") {
    const sedeMap = {
      sede_cita_centro: "Sede Centro",
      sede_cita_norte:  "Sede Norte",
      sede_cita_sur:    "Sede Sur"
    };
    if (sedeMap[payload]) {
      sesion.datos.sedeCita = sedeMap[payload];
      sesion.paso = "cita_fecha";
      await saveSession(from, sesion);
      // Consultar Google Calendar y mostrar slots reales
      await enviarSlotsFechas(from, sesion.datos.sedeCita, sesion.datos.especialidad);
    } else {
      await saveSession(from, sesion); await sendText(from,"Por favor selecciona una sede 👆"); await enviarMenuSedesCita(from);
    }
    return;
  }

  /* ── Selección de fecha/slot real ── */
  if (sesion.paso === "cita_fecha") {
    // Los slots tienen ID slot_0, slot_1, etc.
    const slotMatch = payload.match(/^slot_(\d+)$/);

    if (slotMatch) {
      const idx  = parseInt(slotMatch[1]);
      const slotsData = await redis.get(`slots:seleccion:${from}`);

      if (!slotsData) {
        await sendText(from,"⚠️ Los horarios expiraron. Volvemos a consultar...");
        await enviarSlotsFechas(from, sesion.datos.sedeCita, sesion.datos.especialidad);
        return;
      }

      const slots = JSON.parse(slotsData);
      const slot  = slots[idx];

      if (!slot) {
        await sendText(from,"Por favor selecciona un horario de la lista 👆");
        await enviarSlotsFechas(from, sesion.datos.sedeCita, sesion.datos.especialidad);
        return;
      }

      // Crear evento en Google Calendar
      await sendText(from,"⏳ Confirmando tu cita...");

      const googleEventId = await crearEvento({
        phone:        from,
        nombre:       sesion.datos.nombre,
        documento:    sesion.datos.documento,
        especialidad: sesion.datos.especialidad,
        eps:          sesion.datos.eps,
        sede:         slot.sede,
        fechaInicio:  slot.inicio,
        fechaFin:     slot.fin
      });

      // Invalidar caché para que otros usuarios vean el slot como ocupado
      await invalidarCache(slot.sede);

      // Guardar en Redis
      await guardarCitaRedis({
        phone:          from,
        nombre:         sesion.datos.nombre,
        documento:      sesion.datos.documento,
        especialidad:   sesion.datos.especialidad,
        eps:            sesion.datos.eps,
        sede:           slot.sede,
        label:          slot.label,
        fechaISO:       slot.inicio,
        googleEventId,
        recordatorio24: false,
        recordatorio2:  false
      });

      await sendText(from,
        `🎉 *¡Cita agendada con éxito!*\n\n` +
        `👤 ${sesion.datos.nombre}\n🪪 ${sesion.datos.documento}\n` +
        `🏥 ${sesion.datos.especialidad} | 🏦 ${sesion.datos.eps}\n` +
        `📅 ${slot.label}\n📍 ${slot.sede}\n\n` +
        `📆 Evento guardado en nuestro calendario.\n` +
        `Recibirás recordatorio 24h y 2h antes. ✅`
      );

      // Limpiar selección temporal
      await redis.del(`slots:seleccion:${from}`);
      sesion.datos = {}; sesion.paso = "menu";
      await saveSession(from, sesion);

      await sendButtons(from, { body:"¿Deseas hacer algo más?", buttons:[
        { id:"menu_cita", title:"📅 Nueva cita" }, { id:"menu_principal", title:"🏠 Menú principal" }
      ]});

    } else if (payload === "sede_cita_centro" || payload === "sede_cita_norte" || payload === "sede_cita_sur") {
      // Usuario quiere ver otra sede
      const sedeMap = { sede_cita_centro:"Sede Centro", sede_cita_norte:"Sede Norte", sede_cita_sur:"Sede Sur" };
      sesion.datos.sedeCita = sedeMap[payload];
      await saveSession(from, sesion);
      await enviarSlotsFechas(from, sesion.datos.sedeCita, sesion.datos.especialidad);
    } else {
      await sendText(from,"Por favor selecciona un horario de la lista 👆");
      await enviarSlotsFechas(from, sesion.datos.sedeCita, sesion.datos.especialidad);
    }
    return;
  }

  /* ── Sedes ── */
  if (sesion.paso === "sedes") {
    const sedes = {
      sede_centro:{ nombre:"Sede Centro", dir:"Calle 10 #5-32, Piso 2",  tel:"(604) 321-0000", hora:"Lun–Vie 7–6 | Sáb 8–1",  ref:"Frente al Parque Principal." },
      sede_norte: { nombre:"Sede Norte",  dir:"Carrera 45 #80-15",       tel:"(604) 321-0001", hora:"Lun–Vie 7–5 | Sáb 8–12", ref:"Junto al Centro Comercial Norte." },
      sede_sur:   { nombre:"Sede Sur",    dir:"Avenida 30 #12-40",       tel:"(604) 321-0002", hora:"Lun–Vie 8–6 | Sáb 9–1",  ref:"Diagonal al Hospital del Sur." }
    };
    if (sedes[payload]) {
      const s = sedes[payload];
      await saveSession(from, sesion);
      await sendText(from,`🏢 *${s.nombre}*\n\n📌 ${s.dir}\n📞 ${s.tel}\n🕐 ${s.hora}\n🗺️ ${s.ref}`);
      await sendButtons(from,{ body:"¿Qué deseas hacer?", buttons:[
        { id:"menu_cita", title:"📅 Agendar cita" }, { id:"menu_sedes", title:"📍 Ver otra sede" }, { id:"menu_principal", title:"🏠 Menú principal" }
      ]});
    } else if (payload === "menu_sedes") {
      await saveSession(from, sesion); await enviarMenuSedes(from);
    } else {
      await saveSession(from, sesion); await sendText(from,"Por favor selecciona una sede 👆"); await enviarMenuSedes(from);
    }
    return;
  }

  /* ── Asesor motivo ── */
  if (sesion.paso === "asesor_motivo") {
    if (text && text.trim().length >= 3) {
      const motivo = text.trim();
      const nombre = await redis.hget(`usuario:${from}`,"nombre") || from;
      await sendText(from,`⏳ *Conectando con un asesor...*\nPor favor espera. 🔄`);
      const resultado = await notificarAsesores(from, nombre, motivo);
      if (resultado.asignado) {
        await sendText(from,`✅ *¡Asesor conectado!*\n\n👨‍💼 *${resultado.asesor.nombre}* te atenderá ahora.\nEscribe tu consulta. 💬`);
      } else {
        await sendText(from,`⏳ *Todos ocupados.*\nEstás en posición *#${resultado.posicion}*.\nTe notificamos cuando haya un asesor. 🔔`);
      }
      sesion.paso = "con_asesor"; sesion.datos.motivo = motivo;
      await saveSession(from, sesion);
    } else {
      await saveSession(from, sesion); await sendText(from,"Por favor cuéntanos el motivo. ✍️");
    }
    return;
  }

  /* ── Fallback ── */
  await clearSession(from);
  await saveSession(from,{ paso:"menu", datos:{} });
  await sendText(from,"😅 No entendí tu mensaje. Te mostramos el menú principal:");
  await enviarMenuPrincipal(from);
}

module.exports = { handleBot, sendText, sendButtons, enviarMenuPrincipal, saveSession, redis };