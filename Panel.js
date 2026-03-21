const express = require("express");
const { redis } = require("./bot");
const router  = express.Router();

/* ── Helpers de fecha ── */
function fechaKey(date = new Date()) { return date.toISOString().slice(0, 10); }
function semanaKey(date = new Date()) {
  const d = new Date(date); const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2,"0")}`;
}
function mesKey(date = new Date()) { return date.toISOString().slice(0, 7); }

/* ======================================================
   API ENDPOINTS
   ====================================================== */

/* ── GET /panel/api/resumen ── */
router.get("/api/resumen", async (req, res) => {
  try {
    const hoy = fechaKey();
    const citasHoy    = parseInt(await redis.get(`citas:count:dia:${hoy}`)            || 0);
    const citasSemana = parseInt(await redis.get(`citas:count:semana:${semanaKey()}`) || 0);
    const citasMes    = parseInt(await redis.get(`citas:count:mes:${mesKey()}`)       || 0);

    const usuariosUnicos = await redis.scard("usuarios:unicos");
    const convHoy        = await redis.scard(`conv:dia:${hoy}`);
    const convSemana     = await redis.scard(`conv:semana:${semanaKey()}`);
    const convMes        = await redis.scard(`conv:mes:${mesKey()}`);
    const conCita        = await redis.scard("usuarios:con:cita");
    const sinCita        = usuariosUnicos - conCita;

    const especialidades = ["Medicina General","Odontología","Psicología","Nutrición","Especialistas"];
    const statsEsp = {};
    for (const esp of especialidades) {
      statsEsp[esp] = parseInt(await redis.get(`citas:especialidad:${esp}`) || 0);
    }

    res.json({
      citas:    { hoy: citasHoy, semana: citasSemana, mes: citasMes },
      conv:     { hoy: convHoy, semana: convSemana, mes: convMes, total: usuariosUnicos },
      usuarios: { total: usuariosUnicos, conCita, sinCita },
      especialidades: statsEsp
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── GET /panel/api/citas ── */
router.get("/api/citas", async (req, res) => {
  try {
    const keys  = await redis.smembers("citas:activas");
    const citas = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) citas.push(JSON.parse(data));
    }
    citas.sort((a, b) => new Date(a.fechaISO) - new Date(b.fechaISO));
    res.json(citas);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DELETE /panel/api/citas/:id ── */
router.delete("/api/citas/:id", async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    await redis.del(id);
    await redis.srem("citas:activas", id);
    res.json({ ok: true, mensaje: "Cita cancelada correctamente" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── GET /panel/api/conversaciones ── */
router.get("/api/conversaciones", async (req, res) => {
  try {
    const phones = await redis.smembers("usuarios:unicos");
    const lista  = [];
    for (const phone of phones) {
      const data = await redis.hgetall(`usuario:${phone}`);
      if (data) lista.push(data);
    }
    lista.sort((a, b) => new Date(b.ultimaConv || 0) - new Date(a.ultimaConv || 0));
    res.json(lista);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ======================================================
   PANEL HTML
   ====================================================== */
router.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Panel — IPS Salud Vida</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',sans-serif; background:#f0f4f8; color:#1a202c; }
    header { background:linear-gradient(135deg,#00b09b,#096c7a); color:white; padding:18px 32px; display:flex; align-items:center; gap:14px; box-shadow:0 2px 8px rgba(0,0,0,.2); }
    header h1 { font-size:1.4rem; font-weight:700; }
    .badge { background:rgba(255,255,255,.2); padding:3px 10px; border-radius:20px; font-size:.75rem; }
    .tabs { display:flex; background:#fff; border-bottom:2px solid #e2e8f0; padding:0 32px; }
    .tab  { padding:14px 22px; cursor:pointer; font-weight:600; color:#718096; border-bottom:3px solid transparent; transition:.2s; }
    .tab.active,.tab:hover { color:#00b09b; border-bottom-color:#00b09b; }
    .content { padding:28px 32px; }
    .section { display:none; }
    .section.active { display:block; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; margin-bottom:28px; }
    .card  { background:#fff; border-radius:12px; padding:20px; box-shadow:0 1px 4px rgba(0,0,0,.08); text-align:center; }
    .card .num { font-size:2.2rem; font-weight:800; color:#00b09b; line-height:1; }
    .card .lbl { font-size:.78rem; color:#718096; margin-top:6px; text-transform:uppercase; letter-spacing:.5px; }
    .card .sub { font-size:.7rem; color:#a0aec0; margin-top:4px; }
    .tabla-wrap { background:#fff; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.08); overflow:hidden; }
    table { width:100%; border-collapse:collapse; }
    th { background:#f7fafc; padding:11px 16px; font-size:.75rem; color:#718096; text-transform:uppercase; text-align:left; letter-spacing:.5px; }
    td { padding:12px 16px; font-size:.85rem; border-bottom:1px solid #f0f4f8; }
    tr:last-child td { border-bottom:none; }
    tr:hover td { background:#f7fafc; }
    .badge-ok   { background:#c6f6d5; color:#276749; padding:3px 10px; border-radius:20px; font-size:.72rem; font-weight:600; }
    .badge-pend { background:#fefcbf; color:#744210; padding:3px 10px; border-radius:20px; font-size:.72rem; font-weight:600; }
    .badge-sin  { background:#fed7d7; color:#742a2a; padding:3px 10px; border-radius:20px; font-size:.72rem; font-weight:600; }
    .btn-cancel { background:#fed7d7; color:#c53030; border:none; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:.8rem; font-weight:600; }
    .btn-cancel:hover { background:#fc8181; color:#fff; }
    .charts { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
    .chart-box { background:#fff; border-radius:12px; padding:20px; box-shadow:0 1px 4px rgba(0,0,0,.08); }
    .chart-box h3 { font-size:.9rem; font-weight:700; margin-bottom:16px; color:#2d3748; }
    .btn-refresh { background:#00b09b; color:#fff; border:none; padding:8px 18px; border-radius:8px; cursor:pointer; font-size:.82rem; font-weight:600; }
    .btn-refresh:hover { background:#00897b; }
    .empty { text-align:center; padding:40px; color:#a0aec0; font-size:.9rem; }
    @media(max-width:700px){ .charts{grid-template-columns:1fr;} .content{padding:16px;} }
  </style>
</head>
<body>

<header>
  <div>
    <h1>🏥 IPS Salud Vida — Panel de Administración</h1>
    <span class="badge" id="hora-actual"></span>
  </div>
</header>

<div class="tabs">
  <div class="tab active" onclick="showTab('resumen',this)">📊 Resumen</div>
  <div class="tab" onclick="showTab('citas',this)">📅 Citas</div>
  <div class="tab" onclick="showTab('conversaciones',this)">💬 Conversaciones</div>
  <div class="tab" onclick="showTab('estadisticas',this)">📈 Estadísticas</div>
</div>

<div class="content">

  <!-- RESUMEN -->
  <div id="tab-resumen" class="section active">
    <div class="cards">
      <div class="card"><div class="num" id="r-citas-hoy">-</div><div class="lbl">Citas hoy</div></div>
      <div class="card"><div class="num" id="r-citas-semana">-</div><div class="lbl">Citas semana</div></div>
      <div class="card"><div class="num" id="r-citas-mes">-</div><div class="lbl">Citas mes</div></div>
      <div class="card"><div class="num" id="r-conv-hoy">-</div><div class="lbl">Conversaciones hoy</div></div>
      <div class="card"><div class="num" id="r-conv-total">-</div><div class="lbl">Usuarios únicos</div></div>
      <div class="card"><div class="num" id="r-sin-cita">-</div><div class="lbl">Sin cita agendada</div><div class="sub">Iniciaron conv. pero no agendaron</div></div>
    </div>
    <div class="charts">
      <div class="chart-box"><h3>🏥 Citas por especialidad</h3><canvas id="chartEsp" height="220"></canvas></div>
      <div class="chart-box"><h3>👥 Usuarios con vs sin cita</h3><canvas id="chartUsuarios" height="220"></canvas></div>
    </div>
  </div>

  <!-- CITAS -->
  <div id="tab-citas" class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h2 style="font-size:1.1rem;font-weight:700;">📅 Citas agendadas activas</h2>
      <button class="btn-refresh" onclick="cargarCitas()">🔄 Actualizar</button>
    </div>
    <div class="tabla-wrap">
      <table>
        <thead><tr>
          <th>Paciente</th><th>Documento</th><th>Especialidad</th>
          <th>EPS</th><th>Fecha</th><th>Sede</th><th>Recordatorios</th><th>Acción</th>
        </tr></thead>
        <tbody id="tbody-citas"><tr><td colspan="8" class="empty">Cargando...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- CONVERSACIONES -->
  <div id="tab-conversaciones" class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h2 style="font-size:1.1rem;font-weight:700;">💬 Usuarios y conversaciones</h2>
      <button class="btn-refresh" onclick="cargarConversaciones()">🔄 Actualizar</button>
    </div>
    <div class="tabla-wrap">
      <table>
        <thead><tr>
          <th>Teléfono</th><th>Nombre</th><th>Primera conv.</th><th>Última conv.</th><th>Citas</th><th>Estado</th>
        </tr></thead>
        <tbody id="tbody-conv"><tr><td colspan="6" class="empty">Cargando...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ESTADÍSTICAS -->
  <div id="tab-estadisticas" class="section">
    <div class="cards">
      <div class="card"><div class="num" id="e-conv-semana">-</div><div class="lbl">Conversaciones semana</div></div>
      <div class="card"><div class="num" id="e-conv-mes">-</div><div class="lbl">Conversaciones mes</div></div>
      <div class="card"><div class="num" id="e-citas-semana">-</div><div class="lbl">Citas semana</div></div>
      <div class="card"><div class="num" id="e-citas-mes">-</div><div class="lbl">Citas mes</div></div>
    </div>
    <div class="charts">
      <div class="chart-box"><h3>📊 Top especialidades (histórico)</h3><canvas id="chartEsp2" height="260"></canvas></div>
      <div class="chart-box"><h3>📉 Conversaciones vs Citas</h3><canvas id="chartComparacion" height="260"></canvas></div>
    </div>
  </div>

</div>

<script>
let chartEsp, chartUsr, chartEsp2, chartComp;

function showTab(name, el) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  el.classList.add("active");
  if (name === "citas")          cargarCitas();
  if (name === "conversaciones") cargarConversaciones();
  if (name === "estadisticas")   cargarEstadisticas();
}

function actualizarHora() {
  document.getElementById("hora-actual").textContent =
    new Date().toLocaleString("es-CO", { dateStyle:"full", timeStyle:"short" });
}
actualizarHora();
setInterval(actualizarHora, 60000);

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", { dateStyle:"short", timeStyle:"short" });
}

async function cargarResumen() {
  const r = await fetch("/panel/api/resumen").then(r => r.json());
  document.getElementById("r-citas-hoy").textContent    = r.citas.hoy;
  document.getElementById("r-citas-semana").textContent = r.citas.semana;
  document.getElementById("r-citas-mes").textContent    = r.citas.mes;
  document.getElementById("r-conv-hoy").textContent     = r.conv.hoy;
  document.getElementById("r-conv-total").textContent   = r.conv.total;
  document.getElementById("r-sin-cita").textContent     = r.usuarios.sinCita;

  const labels = Object.keys(r.especialidades);
  const values = Object.values(r.especialidades);
  const colors = ["#00b09b","#4299e1","#9f7aea","#f6ad55","#fc8181"];

  if (chartEsp) chartEsp.destroy();
  chartEsp = new Chart(document.getElementById("chartEsp"), {
    type:"bar",
    data:{ labels, datasets:[{ data:values, backgroundColor:colors, borderRadius:6 }] },
    options:{ plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });

  if (chartUsr) chartUsr.destroy();
  chartUsr = new Chart(document.getElementById("chartUsuarios"), {
    type:"doughnut",
    data:{
      labels:["Con cita agendada","Sin cita agendada"],
      datasets:[{ data:[r.usuarios.conCita, r.usuarios.sinCita], backgroundColor:["#00b09b","#fc8181"], borderWidth:0 }]
    },
    options:{ plugins:{ legend:{ position:"bottom" } }, cutout:"65%" }
  });
}

async function cargarCitas() {
  const citas = await fetch("/panel/api/citas").then(r => r.json());
  const tbody = document.getElementById("tbody-citas");
  if (!citas.length) { tbody.innerHTML='<tr><td colspan="8" class="empty">No hay citas activas</td></tr>'; return; }
  tbody.innerHTML = citas.map(c => {
    const r24 = c.recordatorio24 ? '<span class="badge-ok">✅ 24h</span>' : '<span class="badge-pend">⏳ 24h</span>';
    const r2  = c.recordatorio2  ? '<span class="badge-ok">✅ 2h</span>'  : '<span class="badge-pend">⏳ 2h</span>';
    const idEnc = encodeURIComponent(c.id);
    return \`<tr>
      <td><strong>\${c.nombre||"—"}</strong><br><small style="color:#718096">\${c.phone}</small></td>
      <td>\${c.documento||"—"}</td><td>\${c.especialidad}</td><td>\${c.eps}</td>
      <td>\${c.label}</td><td>\${c.sede}</td>
      <td>\${r24} \${r2}</td>
      <td><button class="btn-cancel" onclick="cancelarCita('\${idEnc}',this)">❌ Cancelar</button></td>
    </tr>\`;
  }).join("");
}

async function cancelarCita(idEnc, btn) {
  if (!confirm("¿Cancelar esta cita?")) return;
  const res = await fetch("/panel/api/citas/" + idEnc, { method:"DELETE" }).then(r => r.json());
  if (res.ok) { btn.closest("tr").remove(); alert("✅ Cita cancelada"); }
  else alert("Error: " + res.error);
}

async function cargarConversaciones() {
  const lista = await fetch("/panel/api/conversaciones").then(r => r.json());
  const tbody = document.getElementById("tbody-conv");
  if (!lista.length) { tbody.innerHTML='<tr><td colspan="6" class="empty">No hay conversaciones</td></tr>'; return; }
  tbody.innerHTML = lista.map(u => {
    const tieneCita = parseInt(u.citas||0) > 0;
    const badge = tieneCita ? '<span class="badge-ok">✅ Agendó cita</span>' : '<span class="badge-sin">❌ Sin cita</span>';
    return \`<tr>
      <td>\${u.phone}</td><td>\${u.nombre||"—"}</td>
      <td>\${fmt(u.primeraConv)}</td><td>\${fmt(u.ultimaConv)}</td>
      <td style="text-align:center">\${u.citas||0}</td><td>\${badge}</td>
    </tr>\`;
  }).join("");
}

async function cargarEstadisticas() {
  const r = await fetch("/panel/api/resumen").then(r => r.json());
  document.getElementById("e-conv-semana").textContent  = r.conv.semana;
  document.getElementById("e-conv-mes").textContent     = r.conv.mes;
  document.getElementById("e-citas-semana").textContent = r.citas.semana;
  document.getElementById("e-citas-mes").textContent    = r.citas.mes;

  const labels = Object.keys(r.especialidades);
  const values = Object.values(r.especialidades);
  const colors = ["#00b09b","#4299e1","#9f7aea","#f6ad55","#fc8181"];

  if (chartEsp2) chartEsp2.destroy();
  chartEsp2 = new Chart(document.getElementById("chartEsp2"), {
    type:"bar",
    data:{ labels, datasets:[{ label:"Citas", data:values, backgroundColor:colors, borderRadius:6 }] },
    options:{ indexAxis:"y", plugins:{ legend:{ display:false } }, scales:{ x:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });

  if (chartComp) chartComp.destroy();
  chartComp = new Chart(document.getElementById("chartComparacion"), {
    type:"bar",
    data:{
      labels:["Hoy","Semana","Mes"],
      datasets:[
        { label:"Conversaciones", data:[r.conv.hoy, r.conv.semana, r.conv.mes], backgroundColor:"#4299e1", borderRadius:6 },
        { label:"Citas agendadas", data:[r.citas.hoy, r.citas.semana, r.citas.mes], backgroundColor:"#00b09b", borderRadius:6 }
      ]
    },
    options:{ plugins:{ legend:{ position:"bottom" } }, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });
}

cargarResumen();
setInterval(cargarResumen, 60000);
</script>
</body>
</html>`);
});

module.exports = router;