// app.js

// === URLs (Sheets) ===
const BASE_SHEETS =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub";

const SHEET_FOTOS_MES = `${BASE_SHEETS}?gid=0&single=true&output=csv`;
const SHEET_EFEMERIDES = `${BASE_SHEETS}?gid=1305356303&single=true&output=csv`;
// si no l'uses, la pots deixar igual; no és crítica
const SHEET_CONFIG = `${BASE_SHEETS}?gid=1324899531&single=true&output=csv`;

// ✅ Festius (A=data DD-MM-YYYY, B=nom)
const SHEET_FESTIUS = `${BASE_SHEETS}?gid=1058273430&single=true&output=csv`;

// ✅ Calendari ICS (via proxy per evitar CORS a iOS/PWA)
const CALENDAR_ICS =
  "https://r.jina.ai/https://calendar.google.com/calendar/ical/astromca%40gmail.com/public/basic.ics";

// Mesos en català
const MESOS_CA = [
  "Gener","Febrer","Març","Abril","Maig","Juny",
  "Juliol","Agost","Setembre","Octubre","Novembre","Desembre"
];

// === ESTAT ===
let mesActual = "2026-08";

let efemerides = {};           // data/efemerides_2026.json -> dies[ISO]
let efemeridesEspecials = {};  // sheet -> per dia ISO
let activitats = {};           // ICS -> per dia ISO
let fotosMes = {};             // sheet fotos -> "MM-YYYY"
let festius = new Map();       // ISO -> nom

// === DOM ===
const graella = document.getElementById("graellaDies");
const modal = document.getElementById("modalDia");
const contingutDia = document.getElementById("contingutDia");
const botoNocturn = document.getElementById("toggleNocturn");
const swipeArea = document.getElementById("swipeArea");
const swipeInner = document.getElementById("swipeInner");

// =======================
// Utils dates i format
// =======================
function ddmmyyyyToISO(s) {
  if (s == null) return null;
  const clean = String(s).replace(/\u00A0/g, " ").trim();
  const m = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function isoToMonthKey(isoYM) {
  // "2026-08" -> "08-2026"
  return `${isoYM.slice(5,7)}-${isoYM.slice(0,4)}`;
}

function actualitzaTitolMes(isoYM){
  const [y, m] = isoYM.split("-").map(Number);
  const el = document.getElementById("titolMes");
  if (el) el.textContent = `${MESOS_CA[m-1]} ${y}`.toUpperCase();
}

function monthToParts(isoYM){
  const [y, m] = isoYM.split("-").map(Number);
  return { y, m };
}
function partsToMonth(y, m){
  return `${y}-${String(m).padStart(2,"0")}`;
}
function nextMonth(isoYM){
  let { y, m } = monthToParts(isoYM);
  m += 1; if (m === 13){ m = 1; y += 1; }
  return partsToMonth(y, m);
}
function prevMonth(isoYM){
  let { y, m } = monthToParts(isoYM);
  m -= 1; if (m === 0){ m = 12; y -= 1; }
  return partsToMonth(y, m);
}
function clamp2026(isoYM){
  const { y } = monthToParts(isoYM);
  if (y < 2026) return "2026-01";
  if (y > 2026) return "2026-12";
  return isoYM;
}
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

// =======================
// CSV helpers
// =======================
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (c === "," && !inQuotes) { row.push(cur); cur = ""; continue; }

    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (cur.length || row.length) { row.push(cur); rows.push(row); }
      row = []; cur = "";
      if (c === "\r" && next === "\n") i++;
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => (h || "").trim().toLowerCase());
  return rows.slice(1)
    .filter(r => r.some(x => (x || "").trim() !== ""))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
      return obj;
    });
}

// =======================
// ICS helpers
// =======================
function parseICS(icsText) {
  const rawLines = icsText.split(/\r?\n/);
  const lines = [];
  for (const l of rawLines) {
    if (l.startsWith(" ") && lines.length) lines[lines.length - 1] += l.slice(1);
    else lines.push(l);
  }

  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = left.split(";")[0];
    cur[key] = value;
  }

  return events.map(e => ({
    titol: e.SUMMARY || "Activitat",
    lloc: e.LOCATION || "",
    descripcio: e.DESCRIPTION || "",
    url: e.URL || "",
    dtstart: e.DTSTART || ""
  }));
}

function icsDateToISODate(dt) {
  if (!dt) return null;
  const d = dt.replace("Z", "");
  const y = d.slice(0, 4);
  const m = d.slice(4, 6);
  const day = d.slice(6, 8);
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

// =======================
// Fetch loaders
// =======================
async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar ${path} (${r.status})`);
  return r.json();
}
async function loadCSV(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar CSV (${r.status})`);
  const t = await r.text();
  return rowsToObjects(parseCSV(t));
}
async function loadICS(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar ICS (${r.status})`);
  let t = await r.text();
  // r.jina.ai pot afegir text abans del calendari real
  const idx = t.indexOf("BEGIN:VCALENDAR");
  if (idx !== -1) t = t.slice(idx);
  return t;
}

// =======================
// Builders
// =======================
function buildEfemeridesEspecials(objs) {
  const out = {};
  for (const o of objs) {
    const iso = ddmmyyyyToISO(o.data);
    if (!iso) continue;
    out[iso] ??= [];
    out[iso].push({
      codi: o.codi,
      titol: o.titol || "",
      hora: o.hora || "",
      importancia: Number(o.importancia || 3)
    });
  }
  return out;
}

function buildFotosMes(objs) {
  const out = {};
  for (const o of objs) {
    const key = (o.any_mes || "").trim(); // MM-YYYY
    if (!key) continue;
    out[key] = o;
  }
  return out;
}

function buildActivitatsFromICS(events) {
  const out = {};
  for (const ev of events) {
    const iso = icsDateToISODate(ev.dtstart);
    if (!iso) continue;
    out[iso] ??= [];
    out[iso].push({
      titol: ev.titol,
      lloc: ev.lloc,
      descripcio: ev.descripcio,
      url: ev.url
    });
  }
  return out;
}

// =======================
// UI funcs
// =======================
function getFotoField(f, keys) {
  for (const k of keys) {
    if (f && f[k] != null && String(f[k]).trim() !== "") return String(f[k]).trim();
  }
  return "";
}

function ensureCaptionEl() {
  // Ens asseguram que existeix un element per la llegenda
  let el = document.getElementById("titolFoto");
  if (el) return el;

  const img = document.getElementById("imgFotoMes");
  if (!img) return null;

  el = document.createElement("div");
  el.id = "titolFoto";
  el.style.margin = "10px 12px 0 12px";
  el.style.fontSize = "18px";
  el.style.lineHeight = "1.2";
  el.style.fontWeight = "500";

  // Inserta JUST davall la imatge
  img.insertAdjacentElement("afterend", el);
  return el;
}

function setFotoMes(isoYM) {
  const key = isoToMonthKey(isoYM); // "MM-YYYY"
  const f = fotosMes[key];

  const img = document.getElementById("imgFotoMes");
  const cap = ensureCaptionEl();

  const fallbackPath = `assets/months/2026/${isoYM}.png`;
  const src = (f && f.imatge) ? f.imatge : fallbackPath;
  if (img) img.src = src;

  // ✅ Accepta diferents noms de columna (per si el Sheet no és exactament "titol"/"autor")
  const nom = getFotoField(f, ["titol", "títol", "titulo", "title", "nom"]);
  const autor = getFotoField(f, ["autor", "author", "fotograf", "fotògraf", "credit", "crèdit"]);

  if (cap) cap.textContent = autor ? `${nom} — ${autor}` : nom;

  if (img) {
    img.onclick = (f ? () => obreModalDetallFoto(f) : null);
    img.onerror = () => {
      img.onerror = null;
      img.src = "assets/months/2026/default.png";
    };
  }
}


function obreModalDetallFoto(f) {
  contingutDia.innerHTML = `
    <h2>${f.titol || ""}</h2>
    ${f.imatge ? `<img src="${f.imatge}" alt="${f.titol || ""}" style="width:100%;border-radius:10px">` : ""}
    <p><b>Autor:</b> ${f.autor || ""}</p>
    <p><b>Lloc:</b> ${f.lloc || ""}</p>
    <p>${f.descripcio_llarga || f.descripcio_curta || ""}</p>
  `;
  modal.classList.remove("ocult");
}

function dibuixaMes(isoYM) {
  graella.innerHTML = "";

  const [Y, M] = isoYM.split("-").map(Number);
  const daysInMonth = new Date(Y, M, 0).getDate();

  // offset dilluns=0
  const firstDow = new Date(Y, M - 1, 1).getDay(); // 0 dg..6 ds
  const offset = (firstDow + 6) % 7;

  // buits inicials
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "dia buit";
    graella.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, "0");
    const mm = String(M).padStart(2, "0");
    const iso = `${Y}-${mm}-${dd}`;

    const info = efemerides[iso] || null;
    const esp = efemeridesEspecials[iso] || [];
    const act = activitats[iso] || [];

    const cel = document.createElement("div");
    cel.className = "dia";

    // diumenge o festiu -> verd
    const dow = new Date(Y, M - 1, d).getDay(); // 0 diumenge
    const esDiumenge = (dow === 0);
    const esFestiu = festius.has(iso);
    if (esDiumenge || esFestiu) cel.classList.add("festiu");

    // foscor lluna (si existeix)
    if (info?.lluna_foscor?.color) {
      cel.style.background = info.lluna_foscor.color;
      cel.style.color =
        (info.lluna_foscor.color === "#000000" || info.lluna_foscor.color === "#333333")
          ? "#fff"
          : "#000";
    }

    // ✅ només logo petit AM si hi ha activitat
    const amIcon = act.length
      ? `<img class="am-mini" src="assets/icons/astromallorca.png" alt="AstroMallorca">`
      : "";

    cel.innerHTML = `
      <div class="num">${d}</div>
      <div class="badges">
        ${esp.slice(0,2).map(x => `<span class="badge">${x.codi}</span>`).join("")}
        ${amIcon}
      </div>
    `;

    cel.onclick = () => obreDia(iso);
    graella.appendChild(cel);
  }
}

function obreDia(iso) {
  const info = efemerides[iso] || {};
  const esp = efemeridesEspecials[iso] || [];
  const act = activitats[iso] || [];
  const nomFestiu = festius.get(iso);

  const llunaTxt = info.lluna ? `${info.lluna.fase || ""} (${info.lluna.il_luminacio_percent ?? ""}%)` : "—";
  const astrofoto = info.lluna_foscor?.apte_astrofotografia ? "🌑 Dia favorable per astrofotografia" : "";

  const espHtml = esp.length
    ? `<h3>Efemèrides</h3><ul>${esp.map(e => `<li>${(e.titol || e.codi)}${e.hora ? " — " + e.hora : ""}</li>`).join("")}</ul>`
    : `<h3>Efemèrides</h3><p>Cap destacat.</p>`;

  // 👇 No mostram noms a la graella, però al detall sí és útil
  const actHtml = act.length
    ? `<h3>Activitats AstroMallorca</h3><ul>${act.map(a => `<li><b>${a.titol}</b>${a.lloc ? " — " + a.lloc : ""}${a.url ? ` — <a href="${a.url}" target="_blank">Enllaç</a>` : ""}</li>`).join("")}</ul>`
    : `<h3>Activitats AstroMallorca</h3><p>Cap activitat.</p>`;

  contingutDia.innerHTML = `
    <h2>${iso}</h2>
    ${nomFestiu ? `<p>🎉 <b>${nomFestiu}</b></p>` : ""}
    <p><b>Lluna:</b> ${llunaTxt}</p>
    <p>${astrofoto}</p>
    ${espHtml}
    ${actHtml}
  `;
  modal.classList.remove("ocult");
}

// modal close + nocturn
const btnClose = document.querySelector(".tancar");
if (btnClose) btnClose.onclick = () => modal.classList.add("ocult");
if (botoNocturn) botoNocturn.onclick = () => document.body.classList.toggle("nocturn");

// =======================
// Swipe anim
// =======================
let animant = false;

async function animaCanviMes(direccio){
  if (animant) return;
  const nouMes = clamp2026(direccio === "next" ? nextMonth(mesActual) : prevMonth(mesActual));
  if (nouMes === mesActual) return;

  animant = true;

  swipeInner.classList.add("swipe-anim");
  swipeInner.classList.remove("swipe-reset", "swipe-in-left", "swipe-in-right", "swipe-out-left", "swipe-out-right");
  swipeInner.classList.add(direccio === "next" ? "swipe-out-left" : "swipe-out-right");

  await wait(220);

  swipeInner.classList.remove("swipe-out-left", "swipe-out-right");
  swipeInner.classList.add(direccio === "next" ? "swipe-in-left" : "swipe-in-right");

  renderMes(nouMes);

  swipeInner.offsetHeight;

  swipeInner.classList.remove("swipe-in-left", "swipe-in-right");
  swipeInner.classList.add("swipe-reset");

  await wait(220);

  swipeInner.classList.remove("swipe-anim");
  animant = false;
}

// detector swipe
let startX = 0, startY = 0, startT = 0;
let tracking = false;

if (swipeArea) {
  swipeArea.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startT = Date.now();
    tracking = true;
  }, { passive: true });

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
  }, { passive: true });
}

// =======================
// Render / init
// =======================
function renderMes(isoYM){
  mesActual = isoYM;
  setFotoMes(mesActual);
  actualitzaTitolMes(mesActual);
  dibuixaMes(mesActual);
}

async function inicia() {
  try {
    // local efemèrides
    const e = await loadJSON("data/efemerides_2026.json");
    efemerides = e.dies || {};

    // sheets
    const [fotos, esp, fest] = await Promise.all([
      loadCSV(SHEET_FOTOS_MES),
      loadCSV(SHEET_EFEMERIDES),
      loadCSV(SHEET_FESTIUS)
    ]);

    fotosMes = buildFotosMes(fotos);
    efemeridesEspecials = buildEfemeridesEspecials(esp);

    // festius Map ISO -> nom
    festius = new Map();
    fest.forEach(r => {
      const iso = ddmmyyyyToISO(r.data);
      if (!iso) return;
      festius.set(iso, r.nom || "Festiu");
    });

    // calendari (ICS)
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

// =======================
// Service Worker: auto update
// =======================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");

      if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            nw.postMessage("SKIP_WAITING");
          }
        });
      });
    } catch (e) {
      console.warn("⚠️ No s'ha pogut registrar el Service Worker", e);
    }
  });
}
