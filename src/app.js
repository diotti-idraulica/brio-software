/* ============================================================
 * BRIO · src/app.js
 * ============================================================
 * Single-page app vanilla. Hash routing. Event delegation.
 * Tutte le funzioni globali invocate da HTML via data-action devono
 * essere definite con `function nome(){}` (NON `const`), perché build.js
 * usa terser con mangle.toplevel: false (vedi build.js per dettagli).
 *
 * Convenzioni:
 * - Console log con prefisso `[Brio]` o `[modulo]` (es. `[cassa]`, `[magazzino]`)
 * - Numeri in formato italiano: numFmt(n) → "12,50"
 * - Date in formato italiano: dateFmt(d) → "15/05/2026"
 * - Importi sempre in centesimi (bigint) lato DB; conversione ai bordi
 * ============================================================ */

// ============================================================
// STATO GLOBALE
// ============================================================
const BRIO = {
  org: null,        // riga organizations
  user: null,       // auth.user
  member: null,     // riga members per (org_id, user_id)
  ready: false,     // supabase pronto + bootstrap fatto
};

const STORAGE_KEYS = {
  ORG: "brio.org",
  MEMBER: "brio.member",
  AUTH: "brio.auth_email",  // ultima email loggata (precompilazione)
};

// ============================================================
// HELPERS
// ============================================================
function supa(){ return window.supabase; }

function log(){
  const args = Array.from(arguments);
  if (typeof args[0] === "string" && !args[0].startsWith("[")) args[0] = "[Brio] " + args[0];
  console.log.apply(console, args);
}

function err(){ console.error.apply(console, ["[Brio]"].concat(Array.from(arguments))); }

function $(sel, root){ return (root || document).querySelector(sel); }
function $$(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }

function el(tag, attrs, children){
  const e = document.createElement(tag);
  if (attrs){
    for (const k in attrs){
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
  }
  if (children){
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
  }
  return e;
}

function escapeHtml(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Formattazione italiana
function numFmt(n, decimals){
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("it-IT", { minimumFractionDigits: decimals == null ? 2 : decimals, maximumFractionDigits: decimals == null ? 2 : decimals });
}
function euroFmt(cents){
  if (cents == null) return "—";
  return "€ " + numFmt(Number(cents) / 100, 2);
}
function dateFmt(d){
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "—";
  return dt.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function timeFmt(d){
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "—";
  return dt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

// Toast
function toast(msg, kind){
  const host = document.getElementById("toastHost");
  if (!host) return;
  const t = el("div", { class: "toast " + (kind || "") }, msg);
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .2s ease"; }, 2400);
  setTimeout(() => { t.remove(); }, 2800);
}

// ============================================================
// SPLASH
// ============================================================
function hideSplash(){
  const s = document.getElementById("splash");
  if (s) s.classList.add("hidden");
}

// ============================================================
// BOOT
// ============================================================
window.addEventListener("supabase-ready", boot);

async function boot(){
  log("Boot");
  try {
    // 1. Recupera sessione esistente
    const { data: { session } } = await supa().auth.getSession();
    BRIO.user = session ? session.user : null;
    log("Sessione:", BRIO.user ? BRIO.user.email : "nessuna");

    // 2. Se loggato, carica org + member
    if (BRIO.user) {
      await bootstrapFromBrio();
    }

    // 3. Reagisci a cambi di sessione
    supa().auth.onAuthStateChange((event, session) => {
      log("Auth state:", event);
      BRIO.user = session ? session.user : null;
      if (event === "SIGNED_OUT") {
        BRIO.org = null;
        BRIO.member = null;
        localStorage.removeItem(STORAGE_KEYS.ORG);
        localStorage.removeItem(STORAGE_KEYS.MEMBER);
        navigate("#/login");
      }
      if (event === "SIGNED_IN") {
        bootstrapFromBrio().then(() => {
          if (location.hash === "#/login" || !location.hash) navigate("#/");
          else render();
        });
      }
    });

    BRIO.ready = true;

    // 4. Routing
    window.addEventListener("hashchange", render);
    render();

    // 5. Event delegation globale
    document.addEventListener("click", onDelegatedClick);
    document.addEventListener("submit", onDelegatedSubmit);

    hideSplash();
  } catch (e) {
    err("Boot fallito:", e);
    document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:Helvetica,sans-serif"><h2>Errore di avvio</h2><pre style="text-align:left;background:#f5f5f5;padding:12px;border-radius:8px;overflow:auto">' + escapeHtml(e.message || String(e)) + '</pre></div>';
  }
}

// Carica org + member dell'utente loggato
async function bootstrapFromBrio(){
  if (!BRIO.user) return;
  log("Bootstrap…");

  const { data: members, error } = await supa()
    .from("members")
    .select("*, organizations(*)")
    .eq("user_id", BRIO.user.id)
    .eq("active", true)
    .limit(1);

  if (error){
    err("Bootstrap error:", error);
    toast("Errore caricamento profilo: " + error.message, "error");
    return;
  }

  if (!members || members.length === 0){
    err("Nessun member per user", BRIO.user.id);
    toast("Account senza accesso a nessuna organizzazione", "error");
    return;
  }

  BRIO.member = members[0];
  BRIO.org = members[0].organizations;
  delete BRIO.member.organizations;
  localStorage.setItem(STORAGE_KEYS.ORG, JSON.stringify(BRIO.org));
  localStorage.setItem(STORAGE_KEYS.MEMBER, JSON.stringify(BRIO.member));
  log("Org:", BRIO.org.name, "Ruolo:", BRIO.member.role);
}

// ============================================================
// PERMESSI
// ============================================================
function isAdmin(){ return BRIO.member && BRIO.member.role === "admin"; }
function isManager(){ return BRIO.member && BRIO.member.role === "manager"; }
function isStaff(){ return BRIO.member && BRIO.member.role === "staff"; }
function canManage(){ return isAdmin() || isManager(); }

// ============================================================
// ROUTER
// ============================================================
const ROUTES = {
  "#/login":      { name: "login",      public: true,  render: renderLoginPage },
  "#/":           { name: "home",       render: renderHomePage },
  "#/cassa":      { name: "cassa",      render: renderCassaPage },
  "#/kiosk":      { name: "kiosk",      fullscreen: true, render: renderKioskPage },
  "#/kds":        { name: "kds",        fullscreen: true, render: renderKdsPage },
  "#/dashboard":  { name: "dashboard",  adminOnly: true, render: renderDashboardPage },
  "#/magazzino":  { name: "magazzino",  managerUp: true, render: renderMagazzinoPage },
  "#/fornitori":  { name: "fornitori",  managerUp: true, render: renderFornitoriPage },
  "#/chiusura":   { name: "chiusura",   managerUp: true, render: renderChiusuraPage },
  "#/menu":       { name: "menu",       public: true, fullscreen: true, render: renderMenuClientePage },
};

function navigate(hash){
  if (!hash.startsWith("#")) hash = "#" + hash;
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render(){
  const hash = location.hash || "#/";
  const route = ROUTES[hash] || ROUTES["#/"];

  // Auth gate
  if (!route.public && !BRIO.user){
    if (hash !== "#/login") { navigate("#/login"); return; }
  }
  if (BRIO.user && hash === "#/login"){ navigate("#/"); return; }

  // Permessi
  if (route.adminOnly && !isAdmin()){ renderForbidden(); return; }
  if (route.managerUp && !canManage()){ renderForbidden(); return; }

  // Chrome (sidebar) o fullscreen?
  const root = document.getElementById("appRoot");
  if (route.fullscreen || route.public){
    root.innerHTML = "";
    const main = el("main", { id: "appContent" });
    root.appendChild(main);
    route.render(main);
  } else {
    renderChrome(root);
    const main = document.getElementById("appContent");
    main.innerHTML = "";
    route.render(main);
    highlightActiveNav(route.name);
  }
}

function renderForbidden(){
  const root = document.getElementById("appRoot");
  root.innerHTML = '<div class="login-screen"><div class="login-box text-center"><div class="brio-logo"><span class="b">b</span><span class="rio">rio</span></div><h2 class="mt-16">Accesso negato</h2><p class="muted">Non hai i permessi per questa sezione.</p><button class="btn mt-16" data-action="goHome">Torna alla home</button></div></div>';
}
function goHome(){ navigate("#/"); }

// Chrome con sidebar
function renderChrome(root){
  if (root.querySelector(".app")) return; // già renderizzato

  const nav = [
    { hash: "#/",          icon: "🏠", label: "Home",       show: () => true },
    { hash: "#/cassa",     icon: "💳", label: "Cassa",      show: () => true },
    { hash: "#/kds",       icon: "🍳", label: "KDS",        show: () => true },
    { hash: "#/kiosk",     icon: "📱", label: "Kiosk",      show: () => canManage() },
    { hash: "#/magazzino", icon: "📦", label: "Magazzino",  show: () => canManage() },
    { hash: "#/fornitori", icon: "🚚", label: "Fornitori",  show: () => canManage() },
    { hash: "#/dashboard", icon: "📊", label: "Dashboard",  show: () => isAdmin() },
    { hash: "#/chiusura",  icon: "🔒", label: "Chiusura",   show: () => canManage() },
  ];

  const navHtml = nav.filter(n => n.show()).map(n => (
    '<a class="nav-link" data-nav="' + escapeHtml(n.hash) + '" data-action="navigate" data-args=\'["' + n.hash + '"]\'>' +
      '<span class="icon">' + n.icon + '</span><span class="label">' + escapeHtml(n.label) + '</span>' +
    '</a>'
  )).join("");

  root.innerHTML =
    '<div class="app">' +
      '<aside class="sidebar">' +
        '<div class="brand"><div class="brio-logo on-dark"><span class="b">b</span><span class="rio">rio</span></div></div>' +
        navHtml +
        '<div class="spacer"></div>' +
        '<div class="user-box">' +
          '<div class="name">' + escapeHtml((BRIO.member && BRIO.member.full_name) || (BRIO.user && BRIO.user.email) || "—") + '</div>' +
          '<div class="role">' + escapeHtml((BRIO.member && BRIO.member.role) || "") + '</div>' +
          '<button class="btn btn-ghost mt-8" style="width:100%;color:rgba(239,230,213,.7);border-color:rgba(255,255,255,.12)" data-action="logout">Esci</button>' +
        '</div>' +
      '</aside>' +
      '<main id="appContent"></main>' +
    '</div>';
}

function highlightActiveNav(routeName){
  const hash = location.hash || "#/";
  $$(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-nav") === hash);
  });
}

// ============================================================
// AUTH: LOGIN
// ============================================================
function renderLoginPage(main){
  const lastEmail = localStorage.getItem(STORAGE_KEYS.AUTH) || "";
  main.outerHTML = (
    '<div class="login-screen">' +
      '<div class="login-box">' +
        '<div class="brio-logo"><span class="b">b</span><span class="rio">rio</span></div>' +
        '<div class="tagline">Dal caffè al calice</div>' +
        '<form data-form="login">' +
          '<div id="loginErr"></div>' +
          '<label class="field"><span class="label">Email</span>' +
            '<input class="input" type="email" name="email" required autocomplete="email" value="' + escapeHtml(lastEmail) + '" />' +
          '</label>' +
          '<label class="field"><span class="label">Password</span>' +
            '<input class="input" type="password" name="password" required autocomplete="current-password" />' +
          '</label>' +
          '<button class="btn btn-primary btn-lg" style="width:100%" type="submit">Accedi</button>' +
        '</form>' +
        '<div class="muted text-center mt-16" style="font-size:12px">Per recuperare password contatta un amministratore.</div>' +
      '</div>' +
    '</div>'
  );
}

async function onLoginSubmit(form){
  const email = form.email.value.trim();
  const password = form.password.value;
  const errBox = document.getElementById("loginErr");
  errBox.innerHTML = "";

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = "Accesso in corso…";

  const { data, error } = await supa().auth.signInWithPassword({ email, password });

  if (error){
    errBox.innerHTML = '<div class="login-error">' + escapeHtml(error.message || "Credenziali non valide") + '</div>';
    btn.disabled = false; btn.textContent = "Accedi";
    return;
  }
  localStorage.setItem(STORAGE_KEYS.AUTH, email);
  // onAuthStateChange si occuperà di bootstrap + redirect
}

async function logout(){
  await supa().auth.signOut();
  toast("Sessione chiusa");
}

// ============================================================
// HOME
// ============================================================
function renderHomePage(main){
  const now = new Date();
  const greet = greetingFromHour(now.getHours());
  const name = (BRIO.member && BRIO.member.full_name) ? BRIO.member.full_name.split(" ")[0] : "";

  const modules = [
    { hash: "#/cassa",     icon: "💳", title: "Cassa",      desc: "Batti ordini, incassa, stampa scontrino", show: () => true },
    { hash: "#/kds",       icon: "🍳", title: "KDS",        desc: "Schermo preparazione ordini",            show: () => true },
    { hash: "#/kiosk",     icon: "📱", title: "Kiosk",      desc: "Auto-ordine cliente al totem",           show: () => canManage() },
    { hash: "#/magazzino", icon: "📦", title: "Magazzino",  desc: "Giacenze real-time + soglie",            show: () => canManage() },
    { hash: "#/fornitori", icon: "🚚", title: "Fornitori",  desc: "Ordini automatici e anagrafica",         show: () => canManage() },
    { hash: "#/dashboard", icon: "📊", title: "Dashboard",  desc: "KPI giorno, food cost, allarmi",         show: () => isAdmin() },
    { hash: "#/chiusura",  icon: "🔒", title: "Chiusura",   desc: "Chiusura cassa giornaliera",             show: () => canManage() },
  ];

  const cards = modules.filter(m => m.show()).map(m => (
    '<div class="module-card" data-action="navigate" data-args=\'["' + m.hash + '"]\'>' +
      '<div class="icon">' + m.icon + '</div>' +
      '<div class="title">' + escapeHtml(m.title) + '</div>' +
      '<div class="desc">' + escapeHtml(m.desc) + '</div>' +
    '</div>'
  )).join("");

  main.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1>' + greet + (name ? ", " + escapeHtml(name) : "") + '</h1>' +
        '<div class="sub">' + escapeHtml(BRIO.org ? BRIO.org.name : "Brio") + ' · ' + dateFmt(now) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="module-grid">' + cards + '</div>';
}

function greetingFromHour(h){
  if (h < 5)  return "Buonanotte";
  if (h < 12) return "Buongiorno";
  if (h < 18) return "Buon pomeriggio";
  return "Buonasera";
}

// ============================================================
// PAGINE PLACEHOLDER (saranno implementate nei prossimi step)
// ============================================================
function placeholderPage(main, title, desc){
  main.innerHTML =
    '<div class="page-header"><h1>' + escapeHtml(title) + '</h1></div>' +
    '<div class="card card-pad-lg">' +
      '<p class="muted">' + escapeHtml(desc) + '</p>' +
      '<p class="dim mt-16" style="font-size:13px">In costruzione — Claude lo implementa nel prossimo step.</p>' +
    '</div>';
}

function renderCassaPage(main){      placeholderPage(main, "Cassa", "Batti ordini, gestisci pagamenti, stampa scontrini fiscali."); }
function renderKioskPage(main){      placeholderPage(main, "Kiosk self-order", "Modalità auto-ordine per totem cliente."); }
function renderKdsPage(main){        placeholderPage(main, "KDS retrobanco", "Schermo preparazione ordini in tempo reale."); }
function renderDashboardPage(main){  placeholderPage(main, "Dashboard", "KPI del giorno, food cost, allarmi magazzino, performance."); }
function renderMagazzinoPage(main){  placeholderPage(main, "Magazzino", "Giacenze in tempo reale, soglie, inventario settimanale."); }
function renderFornitoriPage(main){  placeholderPage(main, "Fornitori", "Anagrafica, ordini automatici via email, ricezione merce."); }
function renderChiusuraPage(main){   placeholderPage(main, "Chiusura cassa", "Riconciliazione incassi atteso vs reale, export corrispettivi."); }
function renderMenuClientePage(main){placeholderPage(main, "Menu cliente", "Pagina pubblica menu — accessibile da QR tavolo o link."); }

// ============================================================
// EVENT DELEGATION
// ============================================================
function onDelegatedClick(e){
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  let args = [];
  const rawArgs = target.getAttribute("data-args");
  if (rawArgs){
    try { args = JSON.parse(rawArgs); if (!Array.isArray(args)) args = [args]; }
    catch (e2){ err("data-args JSON non valido su", target, rawArgs); }
  }
  const fn = window[action];
  if (typeof fn !== "function"){
    err("Funzione globale non trovata:", action);
    return;
  }
  fn.apply(null, args);
}

function onDelegatedSubmit(e){
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const name = form.getAttribute("data-form");
  const handlerName = "on" + name.charAt(0).toUpperCase() + name.slice(1) + "Submit";
  const fn = window[handlerName];
  if (typeof fn === "function"){ fn(form, e); }
  else { err("Form handler non trovato:", handlerName); }
}
