/* ======================================================
   calendar.js — IPS Salud Vida

   MODO ACTUAL: Fechas de ejemplo (sin Google Calendar)

   Cuando tengas el archivo google-credentials.json y el
   CALENDAR_ID listos, cambia USAR_GOOGLE_CALENDAR a true
   y el bot empezará a usar disponibilidad en tiempo real.
   ====================================================== */

const { redis } = require("./bot");

/* ======================================================
   CONFIGURACION — EDITA AQUI
   ====================================================== */

// Cambia a true cuando tengas google-credentials.json y CALENDAR_ID listos
const USAR_GOOGLE_CALENDAR = false;

// Ruta al archivo JSON de Google Cloud
const CREDENTIALS_PATH = "./google-credentials.json";

// ID del calendario (lo encuentras en Google Calendar -> Configuracion)
const CALENDAR_ID = "TU_CALENDAR_ID_AQUI";

// Duracion de cada cita en minutos
const DURACION_CITA = 20;

// Horarios de atencion por sede
const HORARIOS_SEDES = {
  "Sede Centro": { inicio: 7, fin: 18, sabado: { inicio: 8, fin: 13 } },
  "Sede Norte":  { inicio: 7, fin: 17, sabado: { inicio: 8, fin: 12 } },
  "Sede Sur":    { inicio: 8, fin: 18, sabado: { inicio: 9, fin: 13 } }
};

/* ======================================================
   MODO FALLBACK — fechas dinamicas de ejemplo
   Se usa cuando USAR_GOOGLE_CALENDAR = false
   ====================================================== */
function obtenerFechasEjemplo(sede) {
  const ahora = new Date();
  const slots = [];

  for (let d = 1; d <= 7; d++) {
    const fecha = new Date(ahora);
    fecha.setDate(fecha.getDate() + d);
    const diaSemana = fecha.getDay();
    if (diaSemana === 0) continue; // Sin domingos

    const config     = HORARIOS_SEDES[sede];
    const esSabado   = diaSemana === 6;
    const horaInicio = esSabado ? config.sabado?.inicio : config.inicio;
    const horaFin    = esSabado ? config.sabado?.fin    : config.fin;
    if (!horaInicio) continue;

    // Generar 2 slots por dia como ejemplo
    const horas = [horaInicio, horaInicio + 2];
    for (const h of horas) {
      if (h >= horaFin) continue;
      const slotInicio = new Date(fecha);
      slotInicio.setHours(h, 0, 0, 0);
      const slotFin = new Date(slotInicio);
      slotFin.setMinutes(slotFin.getMinutes() + DURACION_CITA);

      slots.push({
        inicio: slotInicio.toISOString(),
        fin:    slotFin.toISOString(),
        label:  formatearSlot(slotInicio),
        sede
      });

      if (slots.length >= 8) break;
    }
    if (slots.length >= 8) break;
  }
  return slots;
}

/* ======================================================
   MODO GOOGLE CALENDAR — disponibilidad real
   ====================================================== */
async function obtenerDisponibilidadGoogle(sede, dias = 5) {
  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes:  ["https://www.googleapis.com/auth/calendar"]
    });
    const calendar = google.calendar({ version: "v3", auth });

    const ahora = new Date();
    const hasta = new Date();
    hasta.setDate(hasta.getDate() + dias);

    const response = await calendar.events.list({
      calendarId:   CALENDAR_ID,
      timeMin:      ahora.toISOString(),
      timeMax:      hasta.toISOString(),
      singleEvents: true,
      orderBy:      "startTime",
      q:            sede
    });

    const eventosOcupados  = response.data.items || [];
    const slotsDisponibles = [];
    const config           = HORARIOS_SEDES[sede];

    for (let d = 0; d < dias; d++) {
      const fecha = new Date(ahora);
      fecha.setDate(fecha.getDate() + d);
      fecha.setHours(0, 0, 0, 0);

      const diaSemana  = fecha.getDay();
      if (diaSemana === 0) continue;

      const esSabado   = diaSemana === 6;
      const horaInicio = esSabado ? config.sabado?.inicio : config.inicio;
      const horaFin    = esSabado ? config.sabado?.fin    : config.fin;
      if (!horaInicio) continue;

      for (let h = horaInicio; h < horaFin; h++) {
        for (let m = 0; m < 60; m += DURACION_CITA) {
          const slotInicio = new Date(fecha);
          slotInicio.setHours(h, m, 0, 0);
          const slotFin = new Date(slotInicio);
          slotFin.setMinutes(slotFin.getMinutes() + DURACION_CITA);

          if (slotInicio <= ahora) continue;

          const ocupado = eventosOcupados.some(ev => {
            const eI = new Date(ev.start.dateTime);
            const eF = new Date(ev.end.dateTime);
            return slotInicio < eF && slotFin > eI;
          });

          if (!ocupado) {
            slotsDisponibles.push({
              inicio: slotInicio.toISOString(),
              fin:    slotFin.toISOString(),
              label:  formatearSlot(slotInicio),
              sede
            });
          }
          if (slotsDisponibles.length >= 8) break;
        }
        if (slotsDisponibles.length >= 8) break;
      }
      if (slotsDisponibles.length >= 8) break;
    }

    return slotsDisponibles;

  } catch (e) {
    console.error("Error Google Calendar:", e.message);
    return [];
  }
}

/* ======================================================
   CREAR EVENTO EN GOOGLE CALENDAR
   ====================================================== */
async function crearEvento(cita) {
  if (!USAR_GOOGLE_CALENDAR) {
    console.log("Google Calendar no configurado — cita guardada solo en Redis");
    return null;
  }
  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes:  ["https://www.googleapis.com/auth/calendar"]
    });
    const calendar = google.calendar({ version: "v3", auth });

    const evento = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: {
        summary:     `Cita - ${cita.especialidad} | ${cita.nombre}`,
        description:
          `Paciente: ${cita.nombre}\n` +
          `Documento: ${cita.documento}\n` +
          `Especialidad: ${cita.especialidad}\n` +
          `EPS: ${cita.eps}\n` +
          `Telefono: +${cita.phone}\n` +
          `Sede: ${cita.sede}`,
        location: cita.sede,
        start: { dateTime: cita.fechaInicio, timeZone: "America/Bogota" },
        end:   { dateTime: cita.fechaFin,    timeZone: "America/Bogota" },
        colorId: "2"
      }
    });

    console.log("Evento creado en Google Calendar:", evento.data.id);
    return evento.data.id;

  } catch (e) {
    console.error("Error creando evento:", e.message);
    return null;
  }
}

/* ======================================================
   CANCELAR EVENTO EN GOOGLE CALENDAR
   ====================================================== */
async function cancelarEvento(eventId) {
  if (!USAR_GOOGLE_CALENDAR || !eventId) return false;
  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes:  ["https://www.googleapis.com/auth/calendar"]
    });
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
    console.log("Evento cancelado en Google Calendar:", eventId);
    return true;
  } catch (e) {
    console.error("Error cancelando evento:", e.message);
    return false;
  }
}

/* ======================================================
   OBTENER SLOTS CON CACHE REDIS (10 minutos)
   ====================================================== */
async function obtenerSlotsConCache(sede) {
  const cacheKey = `slots:${sede}`;
  const cached   = await redis.get(cacheKey);

  if (cached) {
    console.log("Slots desde cache:", sede);
    return JSON.parse(cached);
  }

  let slots;
  if (USAR_GOOGLE_CALENDAR) {
    slots = await obtenerDisponibilidadGoogle(sede);
  } else {
    slots = obtenerFechasEjemplo(sede);
    console.log("Usando fechas de ejemplo para:", sede);
  }

  if (slots.length > 0) {
    await redis.set(cacheKey, JSON.stringify(slots), "EX", 60 * 10);
  }
  return slots;
}

/* ======================================================
   INVALIDAR CACHE DE UNA SEDE
   ====================================================== */
async function invalidarCache(sede) {
  await redis.del(`slots:${sede}`);
  console.log("Cache invalidado:", sede);
}

/* ======================================================
   FORMATEAR SLOT PARA WHATSAPP
   ====================================================== */
function formatearSlot(fecha) {
  const dias  = ["Dom","Lun","Mar","Mie","Jue","Vie","Sab"];
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const d     = new Date(fecha);
  const h     = d.getHours();
  const m     = String(d.getMinutes()).padStart(2,"0");
  const ampm  = h >= 12 ? "PM" : "AM";
  const h12   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]} - ${h12}:${m} ${ampm}`;
}

module.exports = {
  obtenerSlotsConCache,
  crearEvento,
  cancelarEvento,
  invalidarCache,
  HORARIOS_SEDES
};