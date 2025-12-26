// app.js (Calendari AstroMallorca 2026)
// Palma (Europe/Madrid) — interfície en català

// =========================
// Service Worker (offline)
// =========================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// =========================
// Fonts de dades (Sheets + ICS)
// =========================
const BASE_SHEETS =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub";

const SHEET_FOTOS_MES = `${BASE_SHEETS}?gid=0&single=true&output=csv`;
const SHEET_EFEMERIDES = `${BASE_SHEETS}?gid=1305356303&single=true&output=csv`;
const SHEET_FESTIUS = `${BASE_SHEETS}?gid=1058273430&single=true&output=csv`;

// ICS públic (via r.jina.ai per evitar CORS)
const CALENDAR_ICS =
  "https://r.jina.ai/https://calendar.google.com/calendar/ical/astromca%40gmail.com/public/basic.ics";

// =========================
// Constants UI
// =========================
const MESOS_CA = [
  "Gener","Febrer","Març","Abril","Maig","Juny",
  "Juliol","Agost","Setembre","Octubre","Novembre","Desembre"
];

let mesActual = "2026-08"; // inici

// =========================
// Estat
// =========================
let efemerides = {};           // data/efemerides_2026.json (per dia ISO)
let efemeridesEspecials = {};  // del sheet (per dia ISO)
let activitats = {};           // del calendari (per dia ISO)
let fotosMes = {};             // "MM-YYYY" -> info foto
let festius = new Map();       // "YYYY-MM-DD" -> nom

// =========================
// Helpers
// =========================
function pad2(n){ return String(n).padStart(2,"0"); }

function monthToParts(isoYM){
  const [y,m] = isoYM.split("-").map(Number);
  return {y,m};
}
function partsToMonth(y,m){ return `${y}-${pad2(m)}`; }
function nextMonth(isoYM){
  let {y,m} = monthToParts(isoYM);
  m += 1;
  if (m === 13){ m = 1; y += 1; }
  return partsToMonth(y,m);
}
function prevMonth(isoYM){
  let {y,m} = monthToParts(isoYM);
  m -= 1;
  if (m === 0){ m = 12; y -= 1; }
  return partsToMonth(y,m);
}
function clamp2026(isoYM){
  const {y} = monthToParts(isoYM);
  if (y < 2026) return "2026-01";
  if (y > 2026) return "2026-12";
  return isoYM;
}

function isoToMonthKey(isoYM){
  // "2026-08" -> "08-2026"
  return `${isoYM.slice(5,7)}-${isoYM.slice(0,4)}`;
}

function ddmmyyyyToISO(s){
  if (s == null) return null;
  const clean = String(s).replace(/\u00A0/g," ").trim();
  const m = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
}

function normKey(s){
  return String(s||"")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// =========================
// CSV
// =========================
function parseCSV(text){
  const rows=[];
  let row=[], cur="", inQuotes=false;

  for (let i=0;i<text.length;i++){
    const c=text[i];
    const next=text[i+1];

    if (c==='"' && inQuotes && next==='"'){ cur+='"'; i++; continue; }
    if (c==='"'){ inQuotes=!inQuotes; continue; }

    if (c===',' && !inQuotes){ row.push(cur); cur=""; continue; }

    if ((c==='\n' || c==='\r') && !inQuotes){
      if (cur.length || row.length){ row.push(cur); rows.push(row); }
      row=[]; cur="";
      if (c==='\r' && next==='\n') i++;
      continue;
    }

    cur+=c;
  }
  if (cur.length || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

function rowsToObjects(rows){
  if (!rows.length) return [];
  const header = rows[0].map(h => normKey(h));
  return rows.slice(1)
    .filter(r => r.some(x => String(x||"").trim() !== ""))
    .map(r => {
      const o = {};
      header.forEach((h, idx) => { o[h] = String(r[idx] ?? "").trim(); });
      return o;
    });
}

async function loadCSV(url){
  const r = await fetch(url, {cache:"no-store"});
  if (!r.ok) throw new Error(`No puc carregar CSV (${r.status})`);
  const t = await r.text();
  return rowsToObjects(parseCSV(t));
}

async function loadJSON(path){
  const r = await fetch(path, {cache:"no-store"});
  if (!r.ok) throw new Error(`No puc carregar ${path} (${r.status})`);
  return r.json();
}

// =========================
// ICS (mínim)
// =========================
function parseICS(icsText){
  const rawLines = icsText.split(/\r?\n/);
  const lines=[];
  for (const l of rawLines){
    if (l.startsWith(" ") && lines.length) lines[lines.length-1] += l.slice(1);
    else lines.push(l);
  }

  const events=[];
  let cur=null;
  for (const line of lines){
    if (line === "BEGIN:VEVENT"){ cur={}; continue; }
    if (line === "END:VEVENT"){ if (cur) events.push(cur); cur=null; continue; }
    if (!cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const left = line.slice(0, idx);
    const value = line.slice(idx+1);
    const key = left.split(";")[0];
    cur[key] = value;
  }

  return events.map(e => ({
    titol: e.SUMMARY || "Activitat",
    lloc: e.LOCATION || "",
    descripcio: e.DESCRIPTION || "",
    url: e.URL || "",
    dtstart: e.DTSTART || "",
    dtend: e.DTEND || ""
  }));
}

function icsDateToISODate(dt){
  if (!dt) return null;
  const d = dt.replace("Z","");
  const y=d.slice(0,4), m=d.slice(4,6), day=d.slice(6,8);
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

async function loadICS(url){
  const r = await fetch(url, {cache:"no-store"});
  if (!r.ok) throw new Error(`No puc carregar ICS (${r.status})`);
  let t = await r.text();
  const idx = t.indexOf("BEGIN:VCALENDAR");
  if (idx !== -1) t = t.slice(idx);
  return t;
}

// =========================
// Transformacions
// =========================
function buildFotosMes(rows){
  const out = {};
  for (const r of rows){
    const key = (r.any_mes || "").trim(); // MM-YYYY
    if (!key) continue;
    out[key] = r;
  }
  return out;
}

function buildEfemeridesEspecials(rows){
  const out = {};
  for (const r of rows){
    const iso = ddmmyyyyToISO(r.data);
    if (!iso) continue;
    (out[iso] ??= []).push({
      codi: r.codi || r.clau || "",
      titol: r.titol || "",
      hora: r.hora || ""
    });
  }
  return out;
}

function buildFestius(rows){
  const m = new Map();
  for (const r of rows){
    const iso = ddmmyyyyToISO(r.data);
    if (!iso) continue;
    m.set(iso, r.nom || "Festiu");
  }
  return m;
}

function buildActivitatsFromICS(events){
  const out = {};
  for (const ev of events){
    const iso = icsDateToISODate(ev.dtstart);
    if (!iso) continue;
    (out[iso] ??= []).push(ev);
  }
  return out;
}

// =========================
// UI
// =========================
const graella = document.getElementById("graellaDies");
const modal = document.getElementById("modalDia");
const contingutDia = document.getElementById("contingutDia");
const botoNocturn = document.getElementById("toggleNocturn");

function actualitzaTitolMes(isoYM){
  const {y,m} = monthToParts(isoYM);
  const el = document.getElementById("titolMes");
  if (el) el.textContent = `${MESOS_CA[m-1]} ${y}`.toUpperCase();
}

function setFotoMes(isoYM){
  const key = isoToMonthKey(isoYM); // MM-YYYY
  const f = fotosMes[key];

  const img = document.getElementById("imgFotoMes");
  const titolEl = document.getElementById("titolFoto");

  const fallbackPath = `assets/months/2026/${isoYM}.png`;
  const src = (f && f.imatge) ? f.imatge : fallbackPath;
  img.src = src;

  const nom = (f && f.titol) ? f.titol : "—";
  const autor = (f && f.autor) ? f.autor : "";
  titolEl.textContent = autor ? `${nom} — ${autor}` : nom;

  img.onclick = (f ? () => obreModalDetallFoto(f) : null);

  img.onerror = () => {
    img.onerror = null;
    img.src = fallbackPath; // darrer intent (per si la imatge del sheet fallava)
  };
}

function obreModalDetallFoto(f){
  const titol = f.titol || "";
  const autor = f.autor || "";
  const lloc = f.lloc || "";
  const des = f.descripcio_llarga || f.descripcio_curta || "";
  const im = f.imatge || "";

  contingutDia.innerHTML = `
    <h2>${titol}</h2>
    ${im ? `<img src="${im}" alt="${titol}" style="width:100%;border-radius:10px">` : ""}
    ${autor ? `<p><b>Autor:</b> ${autor}</p>` : ""}
    ${lloc ? `<p><b>Lloc:</b> ${lloc}</p>` : ""}
    ${des ? `<p>${des}</p>` : ""}
  `;
  modal.classList.remove("ocult");
}

function dibuixaMes(isoYM){
  graella.innerHTML = "";

  const {y:Y, m:M} = monthToParts(isoYM);
  const daysInMonth = new Date(Y, M, 0).getDate();
  const firstDow = new Date(Y, M-1, 1).getDay(); // 0=dg..6=ds
  const offset = (firstDow + 6) % 7; // dl=0..dg=6

  for (let i=0;i<offset;i++){
    const empty = document.createElement("div");
    empty.className = "dia buit";
    graella.appendChild(empty);
  }

  for (let d=1; d<=daysInMonth; d++){
    const iso = `${Y}-${pad2(M)}-${pad2(d)}`;
    const info = efemerides[iso] || null;
    const esp = efemeridesEspecials[iso] || [];
    const act = activitats[iso] || [];

    const cel = document.createElement("div");
    cel.className = "dia";

    const dow = new Date(Y, M-1, d).getDay();
    const esDiumenge = (dow === 0);
    const esFestiu = festius.has(iso);
    if (esDiumenge || esFestiu) cel.classList.add("festiu");

    if (info?.lluna_foscor?.color){
      cel.style.background = info.lluna_foscor.color;
      cel.style.color = (info.lluna_foscor.color === "#000000") ? "#fff" : "#000";
    }

    cel.innerHTML = `
      <div class="num">${d}</div>
      <div class="badges">
        ${esp.slice(0,2).map(x => `<span class="badge">${x.codi}</span>`).join("")}
        ${act.length ? `<img class="am-mini" src="assets/icons/astromallorca.png" alt="AstroMallorca">` : ""}
      </div>
    `;

    cel.onclick = () => obreDia(iso);
    graella.appendChild(cel);
  }
}

function obreDia(iso){
  const info = efemerides[iso] || {};
  const esp = efemeridesEspecials[iso] || [];
  const act = activitats[iso] || [];
  const nomFestiu = festius.get(iso);

  const llunaTxt = info.lluna
    ? `${info.lluna.fase || ""}${(info.lluna.il_luminacio_percent != null) ? ` (${info.lluna.il_luminacio_percent}%)` : ""}`
    : "—";

  const espHtml = esp.length
    ? `<h3>Efemèrides</h3><ul>${esp.map(e => `<li>${(e.titol || e.codi)}${e.hora ? ` — ${e.hora}` : ""}</li>`).join("")}</ul>`
    : `<h3>Efemèrides</h3><p>Cap destacat.</p>`;

  const actHtml = act.length
    ? `<h3>Activitats AstroMallorca</h3><ul>${act.map(a => `<li><b>${a.titol}</b>${a.lloc ? ` — ${a.lloc}` : ""}${a.url ? ` — <a href="${a.url}" target="_blank" rel="noopener">Enllaç</a>` : ""}</li>`).join("")}</ul>`
    : `<h3>Activitats AstroMallorca</h3><p>Cap activitat.</p>`;

  contingutDia.innerHTML = `
    <h2>${iso}</h2>
    ${nomFestiu ? `<p>🎉 <b>${nomFestiu}</b></p>` : ""}
    <p><b>Lluna:</b> ${llunaTxt}</p>
    ${espHtml}
    ${actHtml}
  `;

  modal.classList.remove("ocult");
}

// Modal + nocturn
const btnTancar = document.querySelector(".tancar");
if (btnTancar) btnTancar.onclick = () => modal.classList.add("ocult");
if (botoNocturn) botoNocturn.onclick = () => document.body.classList.toggle("nocturn");

// =========================
// Swipe entre mesos
// =========================
const swipeInner = document.getElementById("swipeInner");
const swipeArea  = document.getElementById("swipeArea");
let animant = false;

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

async function animaCanviMes(dir){
  if (animant) return;

  const nouMes = clamp2026(dir === "next" ? nextMonth(mesActual) : prevMonth(mesActual));
  if (nouMes === mesActual) return;

  animant = true;
  swipeInner.classList.add("swipe-anim");
  swipeInner.classList.remove("swipe-reset","swipe-in-left","swipe-in-right","swipe-out-left","swipe-out-right");
  swipeInner.classList.add(dir === "next" ? "swipe-out-left" : "swipe-out-right");

  await wait(220);

  swipeInner.classList.remove("swipe-out-left","swipe-out-right");
  swipeInner.classList.add(dir === "next" ? "swipe-in-left" : "swipe-in-right");

  renderMes(nouMes);

  // forçar reflow
  void swipeInner.offsetHeight;

  swipeInner.classList.remove("swipe-in-left","swipe-in-right");
  swipeInner.classList.add("swipe-reset");

  await wait(220);
  swipeInner.classList.remove("swipe-anim");
  animant = false;
}

let startX=0, startY=0, startT=0, tracking=false;

if (swipeArea){
  swipeArea.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; startT = Date.now();
    tracking = true;
  }, {passive:true});

  swipeArea.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startT;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX < 50) return;
    if (absY > absX * 0.7) return;
    if (dt > 600) return;

    if (dx < 0) animaCanviMes("next");
    else animaCanviMes("prev");
  }, {passive:true});
}

// =========================
// Render
// =========================
function renderMes(isoYM){
  mesActual = isoYM;
  setFotoMes(mesActual);
  actualitzaTitolMes(mesActual);
  dibuixaMes(mesActual);
}

// =========================
// Inici
// =========================
async function inicia(){
  try {
    // local efemèrides
    const e = await loadJSON("data/efemerides_2026.json");
    efemerides = e.dies || {};

    // sheets
    const [fotosRows, efeRows, festRows] = await Promise.all([
      loadCSV(SHEET_FOTOS_MES),
      loadCSV(SHEET_EFEMERIDES),
      loadCSV(SHEET_FESTIUS)
    ]);

    fotosMes = buildFotosMes(fotosRows);
    efemeridesEspecials = buildEfemeridesEspecials(efeRows);
    festius = buildFestius(festRows);

    // calendari
    try {
      const icsText = await loadICS(CALENDAR_ICS);
      activitats = buildActivitatsFromICS(parseICS(icsText));
    } catch (err) {
      console.warn("No he pogut carregar el calendari ICS:", err);
      activitats = {};
    }

    renderMes(mesActual);

  } catch (err) {
    graella.innerHTML = `<p style="padding:10px">Error carregant dades: ${err.message}</p>`;
    console.error(err);
  }
}

inicia();
