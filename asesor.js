const { redis } = require("./bot");

/* ======================================================
   ✏️  ZONA DE CONFIGURACIÓN — EDITA AQUÍ LOS ASESORES

   Formato: código de país + número sin espacios ni +
   Ejemplo Colombia: 57 + 3001234567 = "573001234567"

   Para AGREGAR un asesor: añade una línea nueva
   Para ELIMINAR un asesor: borra su línea completa
   Para CAMBIAR un número:  reemplaza el número entre comillas

   ⚠️  Recuerda agregar cada número en Meta Developers
       (WhatsApp → API Setup → sección "To")
   ====================================================== */
const ASESORES = {
  "573153730300": { nombre: "Luis Garcia", disponible: true }  // ← Cambia por número real
};
/* ======================================================
   FIN ZONA DE CONFIGURACIÓN — no edites debajo de aquí
   ====================================================== */

function esAsesor(phone) {
  return !!ASESORES[phone];
}

async function asignarAsesor(phoneUsuario, phoneAsesor) {
  await redis.set(`asesor:usuario:${phoneUsuario}`, phoneAsesor, "EX", 60 * 60 * 8);
  await redis.set(`asesor:atendiendo:${phoneAsesor}`, phoneUsuario, "EX", 60 * 60 * 8);
  await redis.sadd("usuarios:con:asesor", phoneUsuario);
}

async function getAsesorDeUsuario(phoneUsuario) {
  return await redis.get(`asesor:usuario:${phoneUsuario}`);
}

async function getUsuarioDeAsesor(phoneAsesor) {
  return await redis.get(`asesor:atendiendo:${phoneAsesor}`);
}

async function finalizarAtencion(phoneUsuario, phoneAsesor) {
  await redis.del(`asesor:usuario:${phoneUsuario}`);
  await redis.del(`asesor:atendiendo:${phoneAsesor}`);
  await redis.srem("usuarios:con:asesor", phoneUsuario);
}

async function agregarACola(phoneUsuario, motivo, nombre) {
  const datos = JSON.stringify({ phone: phoneUsuario, motivo, nombre, hora: new Date().toISOString() });
  await redis.rpush("cola:asesores", datos);
  return await redis.llen("cola:asesores");
}

async function siguienteEnCola() {
  const datos = await redis.lpop("cola:asesores");
  return datos ? JSON.parse(datos) : null;
}

async function tamañoCola() {
  return await redis.llen("cola:asesores");
}

async function getAsesorDisponible() {
  for (const [phone, info] of Object.entries(ASESORES)) {
    const ocupado = await redis.get(`asesor:atendiendo:${phone}`);
    if (!ocupado) return { phone, ...info };
  }
  return null;
}

module.exports = {
  ASESORES,
  esAsesor,
  asignarAsesor,
  getAsesorDeUsuario,
  getUsuarioDeAsesor,
  finalizarAtencion,
  agregarACola,
  siguienteEnCola,
  tamañoCola,
  getAsesorDisponible
};