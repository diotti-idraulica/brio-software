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
// Caso 1: supabase-init.js non ha ancora dispatchato → ascoltiamo l'evento.
// Caso 2: i defer hanno già eseguito supabase-init.js prima di noi → l'evento
//         è già passato. Verifichiamo se il client esiste e boottiamo direttamente.
window.addEventListener("supabase-ready", boot);
if (window.supabase && typeof window.supabase.auth === "object") {
  boot();
}

// Failsafe: se entro 5s non si è bootato (es. CDN Supabase offline) mostra errore
setTimeout(function(){
  if (BRIO.ready) return;
  err("Boot non avviato entro 5s. Supabase pronto?", !!(window.supabase && window.supabase.auth));
  const s = document.getElementById("splash");
  if (s) s.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:12px">⚠️</div><h2 style="margin:0 0 8px">Impossibile avviare</h2><p style="color:rgba(10,9,7,.55);margin:0 0 16px">Controlla la connessione a internet e ricarica la pagina.</p><button onclick="location.reload()" style="padding:10px 20px;border-radius:10px;border:1px solid rgba(10,9,7,.14);background:white;cursor:pointer">Ricarica</button></div>';
}, 5000);

async function boot(){
  if (BRIO.ready) return; // idempotente

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
  "#/kds":        { name: "kds",        render: renderKdsPage },
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
  main.innerHTML = (
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
async function renderHomePage(main){
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
    // Widget Oggi (KPI giorno corrente)
    '<div id="homeOggi" class="mb-24"></div>' +
    '<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin:0 0 12px;font-weight:600">Moduli</h2>' +
    '<div class="module-grid">' + cards + '</div>';

  // Carica recap "Oggi" in background
  loadHomeOggi();
}

async function loadHomeOggi(){
  const host = document.getElementById("homeOggi");
  if (!host) return;
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayISO = today.toISOString();

  // Query: ordini paid di oggi + righe (per top prodotti)
  const { data: orders, error } = await supa()
    .from("orders")
    .select("id, daily_number, total_cents, status, channel, created_at, order_items(qty, product_name)")
    .eq("org_id", BRIO.org.id)
    .eq("daily_date", today.toISOString().slice(0,10))
    .in("status", ["paid","preparing","ready","delivered"])
    .order("created_at", { ascending: false });

  if (error){ err("[home] oggi", error); return; }

  const list = orders || [];
  const fatturato = list.reduce((a, o) => a + Number(o.total_cents || 0), 0);
  const ticket = list.length > 0 ? Math.round(fatturato / list.length) : 0;

  // Aggrega top prodotti
  const prodCount = {};
  list.forEach((o) => (o.order_items || []).forEach((it) => {
    prodCount[it.product_name] = (prodCount[it.product_name] || 0) + Number(it.qty);
  }));
  const topProds = Object.entries(prodCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Ultimi 5 ordini
  const lastOrders = list.slice(0, 5);

  host.innerHTML =
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div style="padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">' +
        '<div>' +
          '<div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Oggi</div>' +
          '<div style="font-size:18px;font-weight:600;margin-top:2px">' + dateFmt(today) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:24px;text-align:right">' +
          '<div><div style="font-size:11px;color:var(--text-muted)">Ordini</div><div style="font-size:22px;font-weight:700">' + list.length + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted)">Fatturato</div><div style="font-size:22px;font-weight:700;color:var(--emerald)">' + euroFmt(fatturato) + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted)">Ticket medio</div><div style="font-size:22px;font-weight:700">' + euroFmt(ticket) + '</div></div>' +
        '</div>' +
      '</div>' +
      (list.length === 0
        ? '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">Nessun ordine ancora oggi. Batti il primo dalla cassa.</div>'
        : '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0">' +
            // Ultimi ordini
            '<div style="padding:16px 20px;border-right:1px solid var(--line)">' +
              '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px">Ultimi ordini</div>' +
              lastOrders.map((o) => {
                const items = (o.order_items || []).slice(0, 2).map((it) => it.qty + "× " + it.product_name).join(", ");
                const more = (o.order_items || []).length > 2 ? " +" + ((o.order_items || []).length - 2) : "";
                return '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid var(--line);">' +
                  '<div><div style="font-weight:600">#' + o.daily_number + ' · ' + timeFmt(o.created_at) + '</div><div style="color:var(--text-muted);font-size:12px">' + escapeHtml(items + more) + '</div></div>' +
                  '<div style="font-weight:600">' + euroFmt(o.total_cents) + '</div>' +
                '</div>';
              }).join("") +
            '</div>' +
            // Top prodotti
            '<div style="padding:16px 20px">' +
              '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px">Più venduti oggi</div>' +
              (topProds.length === 0 ? '<div style="color:var(--text-muted);font-size:13px">—</div>' :
                topProds.map(([nm, qty]) => (
                  '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid var(--line);">' +
                    '<div>' + escapeHtml(nm) + '</div>' +
                    '<div style="font-weight:600">' + qty + '×</div>' +
                  '</div>'
                )).join("")
              ) +
            '</div>' +
          '</div>'
      ) +
    '</div>';
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

// renderCassaPage: vedi sezione CASSA in fondo al file
// renderKioskPage: vedi sezione KIOSK in fondo al file
function renderKdsPage(main){        placeholderPage(main, "KDS retrobanco", "Schermo preparazione ordini in tempo reale."); }
function renderDashboardPage(main){  placeholderPage(main, "Dashboard", "KPI del giorno, food cost, allarmi magazzino, performance."); }
// renderMagazzinoPage: vedi sezione MAGAZZINO in fondo al file
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

/* ============================================================
 * MODULO CASSA
 * ============================================================
 * Funzionalità:
 *  - Carica categorie + prodotti del menu
 *  - Tab categorie + griglia prodotti (con shortcut F1-F12)
 *  - Carrello laterale con +/- e totale
 *  - Checkout: pagamento contanti (con calcolo resto) o carta
 *  - INSERT order + order_items → trigger DB scarica magazzino
 *  - Mostra scontrino digitale + numero ordine giornaliero
 * ============================================================ */
const CASSA = {
  categories: [],
  products: [],
  productsByCat: {},
  activeCatId: null,
  cart: [],
  paymentMethod: "cash",
  cashGiven: 0,
  saving: false,
  shortcutMap: {},  // "F1" → product
  realtimeChan: null,
};

async function renderCassaPage(main){
  main.innerHTML =
    '<div class="page-header">' +
      '<h1>Cassa</h1>' +
      '<div class="flex gap-8 items-center">' +
        '<div class="sub muted" id="cassaSubinfo">Caricamento…</div>' +
      '</div>' +
    '</div>' +
    '<div class="cassa-layout">' +
      '<div class="cassa-products">' +
        '<div class="cassa-tabs" id="cassaTabs"></div>' +
        '<div class="product-grid" id="productGrid"></div>' +
      '</div>' +
      '<div class="cassa-cart" id="cassaCart"></div>' +
    '</div>';

  await cassaLoadData();
  cassaRenderTabs();
  cassaRenderProducts();
  cassaRenderCart();
  cassaAttachShortcuts();
}

async function cassaLoadData(){
  // Carica categorie + prodotti + ingredienti delle ricette per check disponibilità
  const orgId = BRIO.org.id;
  const [catRes, prodRes] = await Promise.all([
    supa().from("categories").select("*").eq("org_id", orgId).eq("visible", true).order("sort_order"),
    supa().from("products")
      .select("*, recipes(qty, ingredient:ingredients(id, name, stock_qty, critical_stock_qty))")
      .eq("org_id", orgId)
      .neq("status", "hidden")
      .order("sort_order"),
  ]);
  if (catRes.error){ err("[cassa]", catRes.error); toast("Errore categorie", "error"); return; }
  if (prodRes.error){ err("[cassa]", prodRes.error); toast("Errore prodotti", "error"); return; }

  CASSA.categories = catRes.data || [];
  CASSA.products = prodRes.data || [];
  CASSA.productsByCat = {};
  CASSA.shortcutMap = {};
  CASSA.products.forEach((p) => {
    if (!CASSA.productsByCat[p.category_id]) CASSA.productsByCat[p.category_id] = [];
    CASSA.productsByCat[p.category_id].push(p);
    if (p.shortcut_key) CASSA.shortcutMap[p.shortcut_key.toUpperCase()] = p;
  });
  CASSA.activeCatId = CASSA.categories.length > 0 ? CASSA.categories[0].id : null;
  log("[cassa] caricati", CASSA.products.length, "prodotti in", CASSA.categories.length, "categorie");
  const sub = document.getElementById("cassaSubinfo");
  if (sub) sub.textContent = CASSA.products.length + " prodotti · " + CASSA.categories.length + " categorie";
}

function cassaRenderTabs(){
  const host = document.getElementById("cassaTabs");
  if (!host) return;
  host.innerHTML = CASSA.categories.map((c) => {
    const count = (CASSA.productsByCat[c.id] || []).length;
    return '<div class="cassa-tab ' + (c.id === CASSA.activeCatId ? "active" : "") + '"' +
      ' data-action="cassaSwitchCat" data-args=\'["' + c.id + '"]\'>' +
      (c.icon ? c.icon + " " : "") + escapeHtml(c.name) +
      '<span class="count">' + count + '</span></div>';
  }).join("");
}

function cassaSwitchCat(catId){
  CASSA.activeCatId = catId;
  cassaRenderTabs();
  cassaRenderProducts();
}

function cassaRenderProducts(){
  const host = document.getElementById("productGrid");
  if (!host) return;
  const list = CASSA.productsByCat[CASSA.activeCatId] || [];
  if (list.length === 0){
    host.innerHTML = '<div class="muted" style="padding:40px;text-align:center;grid-column:1/-1">Nessun prodotto in questa categoria.</div>';
    return;
  }
  host.innerHTML = list.map((p) => {
    const unavail = !productAvailable(p);
    return '<div class="product-tile ' + (unavail ? "unavailable" : "") + '"' +
      ' data-action="' + (unavail ? "cassaUnavailable" : "cassaAddToCart") + '" data-args=\'["' + p.id + '"]\'>' +
      (p.shortcut_key ? '<div class="shortcut">' + escapeHtml(p.shortcut_key) + '</div>' : "") +
      '<div class="name">' + escapeHtml(p.name) + '</div>' +
      '<div class="price">' + euroFmt(p.price_cents) + '</div>' +
    '</div>';
  }).join("");
}

// Un prodotto è disponibile se:
//  - status === 'available' (no out_of_stock manuale)
//  - tutti gli ingredienti della ricetta hanno stock_qty > critical_stock_qty
//    (NB: il check critico è opzionale per MVP, possiamo allargare)
function productAvailable(p){
  if (p.status === "out_of_stock" || p.status === "hidden") return false;
  if (!p.recipes || p.recipes.length === 0) return true; // prodotto senza ricetta: sempre disponibile
  for (let i = 0; i < p.recipes.length; i++){
    const r = p.recipes[i];
    if (!r.ingredient) continue;
    if (Number(r.ingredient.stock_qty) <= Number(r.ingredient.critical_stock_qty)) return false;
  }
  return true;
}

function cassaUnavailable(){ toast("Prodotto esaurito", "error"); }

function cassaAddToCart(productId){
  const p = CASSA.products.find((x) => x.id === productId);
  if (!p) return;
  const existing = CASSA.cart.find((c) => c.product_id === productId);
  if (existing){
    existing.qty += 1;
  } else {
    CASSA.cart.push({
      product_id: p.id,
      product_name: p.name,
      unit_price_cents: p.price_cents,
      vat_rate: p.vat_rate,
      qty: 1,
    });
  }
  cassaRenderCart();
}

function cassaIncQty(idx){ CASSA.cart[idx].qty += 1; cassaRenderCart(); }
function cassaDecQty(idx){
  CASSA.cart[idx].qty -= 1;
  if (CASSA.cart[idx].qty <= 0) CASSA.cart.splice(idx, 1);
  cassaRenderCart();
}
function cassaRemoveRow(idx){ CASSA.cart.splice(idx, 1); cassaRenderCart(); }
function cassaClearCart(){
  if (CASSA.cart.length === 0) return;
  if (!confirm("Svuotare il carrello?")) return;
  CASSA.cart = [];
  cassaRenderCart();
}

function cassaCartTotals(){
  let subtotal = 0;
  let vat = 0;
  for (const r of CASSA.cart){
    const lineTotal = r.unit_price_cents * r.qty;
    subtotal += lineTotal;
    // IVA scorporata: lineTotal include IVA. vat = lineTotal - (lineTotal / (1 + rate/100))
    vat += Math.round(lineTotal - (lineTotal / (1 + Number(r.vat_rate) / 100)));
  }
  return { subtotal, vat, total: subtotal };
}

function cassaRenderCart(){
  const host = document.getElementById("cassaCart");
  if (!host) return;

  if (CASSA.cart.length === 0){
    host.innerHTML =
      '<div class="cart-head"><h3>Carrello</h3></div>' +
      '<div class="cart-items"><div class="cart-empty"><div class="icon">🛒</div>Tocca un prodotto per iniziare</div></div>';
    return;
  }

  const rows = CASSA.cart.map((r, idx) => {
    const lineTotal = r.unit_price_cents * r.qty;
    return '<div class="cart-row">' +
      '<div class="info">' +
        '<div class="name">' + escapeHtml(r.product_name) + '</div>' +
        '<div class="unit">' + euroFmt(r.unit_price_cents) + ' · IVA ' + numFmt(r.vat_rate, 0) + '%</div>' +
        '<div class="qty-ctrl mt-8">' +
          '<button class="qty-btn" data-action="cassaDecQty" data-args="[' + idx + ']">−</button>' +
          '<span class="qty">' + r.qty + '</span>' +
          '<button class="qty-btn" data-action="cassaIncQty" data-args="[' + idx + ']">+</button>' +
          '<button class="qty-btn remove" data-action="cassaRemoveRow" data-args="[' + idx + ']" title="Rimuovi">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="row-total">' + euroFmt(lineTotal) + '</div>' +
    '</div>';
  }).join("");

  const t = cassaCartTotals();

  host.innerHTML =
    '<div class="cart-head">' +
      '<h3>Carrello (' + CASSA.cart.reduce((a, r) => a + r.qty, 0) + ')</h3>' +
      '<button class="clear" data-action="cassaClearCart">Svuota</button>' +
    '</div>' +
    '<div class="cart-items">' + rows + '</div>' +
    '<div class="cart-totals">' +
      '<div class="cart-total-line"><span>Imponibile</span><span>' + euroFmt(t.total - t.vat) + '</span></div>' +
      '<div class="cart-total-line"><span>IVA</span><span>' + euroFmt(t.vat) + '</span></div>' +
      '<div class="cart-total-line grand"><span>Totale</span><span>' + euroFmt(t.total) + '</span></div>' +
    '</div>' +
    '<div class="cart-actions">' +
      '<button class="btn btn-primary btn-lg" data-action="cassaOpenCheckout">Paga ' + euroFmt(t.total) + '</button>' +
    '</div>';
}

// ========================================================
// CHECKOUT MODAL
// ========================================================
function cassaOpenCheckout(){
  if (CASSA.cart.length === 0) return;
  CASSA.paymentMethod = "cash";
  CASSA.cashGiven = 0;
  showCheckoutModal();
}

function showCheckoutModal(){
  const t = cassaCartTotals();
  const total = t.total;
  // suggerimenti contanti: il totale arrotondato + multipli di 5/10/20
  const ceilEuro = Math.ceil(total / 100) * 100;
  const suggestions = [total, ceilEuro, 500 + ceilEuro - (ceilEuro % 500), 1000 + ceilEuro - (ceilEuro % 1000), 2000 + ceilEuro - (ceilEuro % 2000)]
    .filter((v, i, a) => v >= total && a.indexOf(v) === i).slice(0, 5);

  const change = Math.max(0, CASSA.cashGiven - total);
  const canConfirm = CASSA.paymentMethod === "card" || CASSA.cashGiven >= total;

  document.body.insertAdjacentHTML("beforeend",
    '<div class="modal-backdrop" id="checkoutModal" onclick="if(event.target===this) cassaCloseCheckout()">' +
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<h2>Pagamento · ' + euroFmt(total) + '</h2>' +
          '<button class="modal-close" data-action="cassaCloseCheckout">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="pay-methods">' +
            '<div class="pay-method ' + (CASSA.paymentMethod === "cash" ? "active" : "") + '" data-action="cassaSetPayment" data-args=\'["cash"]\'>' +
              '<div class="icon">💵</div><div class="label">Contanti</div>' +
            '</div>' +
            '<div class="pay-method ' + (CASSA.paymentMethod === "card" ? "active" : "") + '" data-action="cassaSetPayment" data-args=\'["card"]\'>' +
              '<div class="icon">💳</div><div class="label">Carta</div>' +
            '</div>' +
          '</div>' +
          (CASSA.paymentMethod === "cash" ?
            '<div class="cash-input">' +
              '<label>Importo ricevuto</label>' +
              '<input class="input" id="cashGivenInput" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" value="' + (CASSA.cashGiven > 0 ? (CASSA.cashGiven/100).toFixed(2) : "") + '" oninput="cassaOnCashChange(this.value)" />' +
              '<div class="cash-quick">' +
                suggestions.map((s) => '<button data-action="cassaQuickCash" data-args="[' + s + ']">' + euroFmt(s) + '</button>').join("") +
              '</div>' +
            '</div>' +
            '<div class="change-box"><div><div class="label">Resto da dare</div><div class="value">' + euroFmt(change) + '</div></div></div>'
            :
            '<div class="muted" style="padding:20px;text-align:center;background:var(--bg-soft);border-radius:10px">Prepara il POS al cliente, poi conferma.</div>'
          ) +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn" data-action="cassaCloseCheckout">Annulla</button>' +
          '<button class="btn btn-primary" ' + (canConfirm ? "" : "disabled") + ' data-action="cassaConfirmOrder">Conferma ordine</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function cassaCloseCheckout(){
  const m = document.getElementById("checkoutModal");
  if (m) m.remove();
}

function cassaSetPayment(method){
  CASSA.paymentMethod = method;
  cassaCloseCheckout();
  showCheckoutModal();
}

function cassaOnCashChange(value){
  const v = parseFloat((value || "0").toString().replace(",", ".")) || 0;
  CASSA.cashGiven = Math.round(v * 100);
  // ri-renderizziamo solo cambio + bottone abilitato
  cassaCloseCheckout();
  showCheckoutModal();
  // riposiziona il focus
  setTimeout(() => { const inp = document.getElementById("cashGivenInput"); if (inp){ inp.focus(); inp.select(); } }, 0);
}

function cassaQuickCash(cents){
  CASSA.cashGiven = cents;
  cassaCloseCheckout();
  showCheckoutModal();
}

// ========================================================
// CONFERMA ORDINE → INSERT su Supabase
// ========================================================
async function cassaConfirmOrder(){
  if (CASSA.saving) return;
  if (CASSA.cart.length === 0) return;
  const t = cassaCartTotals();
  if (CASSA.paymentMethod === "cash" && CASSA.cashGiven < t.total){
    toast("Importo contanti insufficiente", "error"); return;
  }

  CASSA.saving = true;

  const orgId = BRIO.org.id;
  const change = CASSA.paymentMethod === "cash" ? Math.max(0, CASSA.cashGiven - t.total) : 0;

  // 1) INSERT order con status='pending' (gli items vanno inseriti PRIMA che lo status
  //    passi a 'paid', altrimenti il trigger DB di scaricamento non trova gli items)
  const orderPayload = {
    org_id: orgId,
    channel: "cassa",
    status: "pending",
    subtotal_cents: t.total,
    total_cents: t.total,
    vat_cents: t.vat,
    payment_method: CASSA.paymentMethod,
    paid_cash_cents: CASSA.paymentMethod === "cash" ? CASSA.cashGiven : 0,
    paid_card_cents: CASSA.paymentMethod === "card" ? t.total : 0,
    change_given_cents: change,
    created_by: BRIO.user.id,
  };
  const { data: ord, error: ordErr } = await supa()
    .from("orders").insert(orderPayload).select().single();

  if (ordErr){
    err("[cassa] insert order", ordErr);
    toast("Errore salvataggio ordine: " + ordErr.message, "error");
    CASSA.saving = false; return;
  }

  // 2) INSERT order_items in batch
  const items = CASSA.cart.map((r) => ({
    order_id: ord.id,
    product_id: r.product_id,
    product_name: r.product_name,
    qty: r.qty,
    unit_price_cents: r.unit_price_cents,
    total_cents: r.unit_price_cents * r.qty,
    vat_rate: r.vat_rate,
    kds_status: "queued",
  }));
  const { error: itErr } = await supa().from("order_items").insert(items);
  if (itErr){
    err("[cassa] insert items", itErr);
    toast("Errore voci ordine: " + itErr.message, "error");
    CASSA.saving = false; return;
  }

  // 3) UPDATE order a 'paid' → fa scattare il trigger che scarica magazzino + registra movimenti
  const { error: payErr } = await supa()
    .from("orders").update({ status: "paid" }).eq("id", ord.id);
  if (payErr){
    err("[cassa] update paid", payErr);
    toast("Ordine salvato ma errore pagamento: " + payErr.message, "error");
  }

  // 4) INSERT transaction (registro cassa)
  await supa().from("transactions").insert({
    org_id: orgId,
    order_id: ord.id,
    type: "sale",
    amount_cents: t.total,
    method: CASSA.paymentMethod,
    created_by: BRIO.user.id,
  });

  // Aggiorna l'oggetto locale con il status finale per la receipt
  ord.status = "paid";

  // 4) UI: chiudi modal pagamento, mostra modal successo
  cassaCloseCheckout();
  showReceiptModal(ord, change);

  // 5) Svuota carrello + ricarica giacenze (i trigger DB hanno scalato)
  CASSA.cart = [];
  await cassaLoadData();
  cassaRenderProducts();
  cassaRenderCart();
  CASSA.saving = false;
}

function showReceiptModal(order, change){
  document.body.insertAdjacentHTML("beforeend",
    '<div class="modal-backdrop" id="receiptModal" onclick="if(event.target===this) cassaCloseReceipt()">' +
      '<div class="modal">' +
        '<div class="modal-body">' +
          '<div class="receipt-success">' +
            '<div class="icon">✅</div>' +
            '<div class="muted" style="font-size:13px">Ordine</div>' +
            '<div class="num">#' + order.daily_number + '</div>' +
            '<div class="hint">Totale ' + euroFmt(order.total_cents) + ' · ' + (order.payment_method === "cash" ? "Contanti" : "Carta") + '</div>' +
            (change > 0 ? '<div style="background:var(--bg-soft);padding:14px;border-radius:10px;margin-top:14px"><div class="muted" style="font-size:12px">Resto da dare</div><div style="font-size:28px;font-weight:700;color:var(--emerald)">' + euroFmt(change) + '</div></div>' : "") +
            '<div class="hint mt-16" style="font-size:11px">Numero ordine giornaliero · ' + timeFmt(new Date()) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-primary btn-lg" style="width:100%" data-action="cassaCloseReceipt">Nuovo ordine</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}
function cassaCloseReceipt(){
  const m = document.getElementById("receiptModal");
  if (m) m.remove();
}

/* ============================================================
 * MODULO KIOSK · self-order totem (v2)
 * ============================================================
 * Step:
 *  - splash → menu → (personalize?) → menu → ... → success
 * Funzionalità:
 *  - Hero time-based (colazione/pranzo/aperitivo/giornaliera)
 *  - Personalizzazione ingredienti via modal "bottom sheet"
 *  - Cross-sell intelligente dopo aggiunta al carrello
 *  - Annulla riga + annulla intero carrello sempre visibili
 *  - Carrello persistito in sessionStorage (no reset su tab switch)
 *  - Idle timer pause su document.hidden
 *  - Uscita admin: 4 tap rapidi corner top-right
 * ============================================================ */
const KIOSK = {
  step: "splash",
  categories: [],
  products: [],
  byCat: {},
  activeCatId: null,
  cart: [],
  pendingProduct: null,
  pendingSelections: {},     // { customizationLabel: true|false }
  lastOrder: null,
  idleTimer: null,
  idleStartMs: 0,
  exitTaps: [],
  recentSuggestion: null,     // ultimo prodotto aggiunto (per evidenziare cross-sell)
};
const KIOSK_SS_KEY = "brio.kiosk.cart";

async function renderKioskPage(main){
  document.getElementById("appRoot").innerHTML = '<div class="kiosk-root" id="kioskRoot"></div>';

  await kioskLoadData();
  // Carrello da sessionStorage (sopravvive a tab switch / reload)
  try {
    const saved = sessionStorage.getItem(KIOSK_SS_KEY);
    if (saved){
      const data = JSON.parse(saved);
      if (Array.isArray(data.cart) && data.cart.length){
        KIOSK.cart = data.cart;
        KIOSK.step = "menu"; // resume direttamente al menu, non al splash
      }
    }
  } catch(e){ /* ignore */ }

  kioskRender();

  // Listener idle + visibility
  ["click","touchstart","keydown"].forEach((ev) => {
    document.addEventListener(ev, kioskBumpIdle, true);
  });
  document.addEventListener("visibilitychange", kioskOnVisibility, true);
}

async function kioskLoadData(){
  const orgId = BRIO.org.id;
  const [catRes, prodRes] = await Promise.all([
    supa().from("categories").select("*").eq("org_id", orgId).eq("visible", true).order("sort_order"),
    supa().from("products")
      .select("*, recipes(qty, ingredient:ingredients(stock_qty, critical_stock_qty))")
      .eq("org_id", orgId).neq("status", "hidden").order("sort_order"),
  ]);
  KIOSK.categories = catRes.data || [];
  KIOSK.products = prodRes.data || [];
  KIOSK.byCat = {};
  KIOSK.products.forEach((p) => {
    if (!KIOSK.byCat[p.category_id]) KIOSK.byCat[p.category_id] = [];
    KIOSK.byCat[p.category_id].push(p);
  });
  KIOSK.activeCatId = KIOSK.categories.length > 0 ? KIOSK.categories[0].id : null;
}

function kioskGoto(step){
  KIOSK.step = step;
  if (step === "splash"){
    KIOSK.cart = [];
    KIOSK.recentSuggestion = null;
    sessionStorage.removeItem(KIOSK_SS_KEY);
    clearTimeout(KIOSK.idleTimer);
  }
  kioskRender();
}

function kioskPersistCart(){
  try {
    sessionStorage.setItem(KIOSK_SS_KEY, JSON.stringify({ cart: KIOSK.cart }));
  } catch(e){ /* ignore */ }
}

function kioskRender(){
  const root = document.getElementById("kioskRoot");
  if (!root) return;
  let body = "";

  const exitTrigger = '<div class="kiosk-exit" data-action="kioskCornerTap"></div>';

  if (KIOSK.step === "splash"){
    body =
      '<div class="kiosk-splash" data-action="kioskStart">' +
        exitTrigger +
        '<div class="lang"><button>🇮🇹 IT</button><button>🇬🇧 EN</button></div>' +
        '<div class="logo brio-logo"><span class="b">b</span><span class="rio">rio</span></div>' +
        '<div class="tagline">Dal caffè al calice</div>' +
        '<button class="cta">Tocca per ordinare</button>' +
      '</div>';
  } else if (KIOSK.step === "menu"){
    body = kioskRenderMenu();
  } else if (KIOSK.step === "success"){
    body = kioskRenderSuccess();
  }

  root.innerHTML = body;

  // Personalize è un modal sopra al menu (non sostituisce il body)
  if (KIOSK.step === "personalize" && KIOSK.pendingProduct){
    document.body.insertAdjacentHTML("beforeend", kioskRenderPersonalize());
  } else {
    const open = document.getElementById("kpzModal");
    if (open) open.remove();
  }

  kioskBumpIdle();
}

function kioskRenderMenu(){
  const cats = KIOSK.categories.map((c) => (
    '<div class="kiosk-cat ' + (c.id === KIOSK.activeCatId ? "active" : "") + '"' +
    ' data-action="kioskSwitchCat" data-args=\'["' + c.id + '"]\'>' +
      '<span class="icon">' + (c.icon || "🍽") + '</span>' +
      '<span>' + escapeHtml(c.name) + '</span>' +
    '</div>'
  )).join("");

  const products = (KIOSK.byCat[KIOSK.activeCatId] || []).map((p) => {
    const avail = kioskProductAvailable(p);
    const photo = p.image_url
      ? '<div class="photo-area" style="background-image:url(\'' + escapeHtml(p.image_url) + '\');background-size:cover;background-position:center"></div>'
      : '<div class="photo-area">' + kioskProductEmoji(p) + '</div>';
    return '<div class="kiosk-product ' + (avail ? "" : "unavailable") + '"' +
      ' data-action="' + (avail ? "kioskOnProductTap" : "noop") + '" data-args=\'["' + p.id + '"]\'>' +
      photo +
      '<div>' +
        '<div class="name">' + escapeHtml(p.name) + '</div>' +
        '<div class="desc">' + escapeHtml(p.description || "") + '</div>' +
      '</div>' +
      '<div class="price-row">' +
        '<div class="price">' + euroFmt(p.price_cents) + '</div>' +
        '<button class="add-btn">+</button>' +
      '</div>' +
    '</div>';
  }).join("");

  return (
    '<div class="kiosk-exit" data-action="kioskCornerTap"></div>' +
    '<div class="kiosk-header">' +
      '<div class="logo-small"><span class="b">b</span>rio</div>' +
      '<button class="home-btn" data-action="kioskReset">⟲ Nuovo ordine</button>' +
    '</div>' +
    '<div class="kiosk-body">' +
      '<div class="kiosk-content">' +
        kioskRenderHero() +
        '<div class="kiosk-cats">' + cats + '</div>' +
        '<div class="kiosk-products">' + products + '</div>' +
      '</div>' +
      kioskRenderCart() +
    '</div>'
  );
}

// =========== HERO time-based offerta ==========
function kioskRenderHero(){
  const hr = new Date().getHours();
  let badge, title, msg, icon;
  if (hr >= 7 && hr < 11){
    badge = "Offerta colazione";
    title = "Caffè + brioche · €2,30";
    msg = "Fino alle 10:00 · risparmi €0,20";
    icon = "☕🥐";
  } else if (hr >= 11 && hr < 15){
    badge = "Menù pranzo";
    title = "Piadina + bevanda · €7,50";
    msg = "Pranzo veloce 11:30-14:30 · risparmi €0,50";
    icon = "🥙🥤";
  } else if (hr >= 17 && hr < 20){
    badge = "Aperitivo del giorno";
    title = "Birra + tagliere mini · €8,50";
    msg = "Happy hour 17:30-19:30 · risparmi €1,00";
    icon = "🍺🧀";
  } else {
    badge = "Sempre con te";
    title = "Caffè in qualsiasi momento";
    msg = "Vieni quando vuoi · siamo aperti";
    icon = "☕";
  }
  return (
    '<div class="kiosk-hero">' +
      '<div>' +
        '<div class="badge">' + escapeHtml(badge) + '</div>' +
        '<h2>' + escapeHtml(title) + '</h2>' +
        '<p>' + escapeHtml(msg) + '</p>' +
      '</div>' +
      '<div class="icon">' + icon + '</div>' +
    '</div>'
  );
}

// =========== PERSONALIZZAZIONE (bottom sheet) ==========
function kioskRenderPersonalize(){
  const p = KIOSK.pendingProduct;
  if (!p) return "";
  const customs = Array.isArray(p.customizations) ? p.customizations : [];

  // Calcolo prezzo corrente
  let extra = 0;
  customs.forEach((c) => {
    if (KIOSK.pendingSelections[c.label]) extra += Number(c.price_delta_cents || 0);
  });
  const finalPrice = Number(p.price_cents) + extra;

  const opts = customs.map((c) => {
    const sel = !!KIOSK.pendingSelections[c.label];
    const delta = Number(c.price_delta_cents || 0);
    return '<div class="kpz-opt ' + (sel ? "selected" : "") + '"' +
      ' data-action="kioskToggleCustomization" data-args=\'["' + c.label.replace(/'/g, "\\u0027").replace(/"/g, "&quot;") + '"]\'>' +
      '<div>' + escapeHtml(c.label) + '</div>' +
      '<div class="flex items-center">' +
        (delta > 0 ? '<span class="delta">+' + euroFmt(delta) + '</span>' : '') +
        '<span class="check">' + (sel ? '✓' : '') + '</span>' +
      '</div>' +
    '</div>';
  }).join("");

  return (
    '<div class="kpz-back" id="kpzModal" onclick="if(event.target===this) kioskCancelPersonalize()">' +
      '<div class="kpz-sheet">' +
        '<div class="kpz-head">' +
          '<div>' +
            '<h2>' + escapeHtml(p.name) + '</h2>' +
            '<div class="sub">' + escapeHtml(p.description || "Personalizza il tuo prodotto") + '</div>' +
          '</div>' +
          '<button class="modal-close" data-action="kioskCancelPersonalize">×</button>' +
        '</div>' +
        '<div class="kpz-body">' +
          (customs.length === 0
            ? '<div class="muted text-center" style="padding:30px;font-size:14px">Questo prodotto non ha personalizzazioni. Aggiungilo direttamente.</div>'
            : '<div class="kpz-section">' +
                '<div class="lbl">Opzioni</div>' +
                opts +
              '</div>'
          ) +
        '</div>' +
        '<div class="kpz-foot">' +
          '<button class="cancel" data-action="kioskCancelPersonalize">Annulla</button>' +
          '<button class="add" data-action="kioskConfirmPersonalize">Aggiungi · ' + euroFmt(finalPrice) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function kioskRenderCart(){
  const totals = kioskCartTotals();
  if (KIOSK.cart.length === 0){
    return (
      '<div class="kiosk-cart">' +
        '<div class="cart-h"><h3>Il tuo ordine</h3><div class="count">Carrello vuoto</div></div>' +
        '<div class="cart-l"><div class="cart-empty"><div class="icon">🛒</div>Tocca un prodotto per iniziare</div></div>' +
        '<div class="cart-f"><button class="cta-pay" disabled>Procedi</button></div>' +
      '</div>'
    );
  }
  const items = KIOSK.cart.map((r, idx) => {
    const chips = (r.customizations || []).map((c) => '<span class="chip">' + escapeHtml(c.label) + (c.price_delta_cents > 0 ? " +" + euroFmt(c.price_delta_cents) : "") + '</span>').join("");
    return '<div class="citem">' +
      '<div>' +
        '<div class="n">' + escapeHtml(r.product_name) + '</div>' +
        '<div class="u">' + euroFmt(r.unit_price_cents) + ' cad.</div>' +
        (chips ? '<div class="chips">' + chips + '</div>' : '') +
        '<div class="qc">' +
          '<button data-action="kioskDecQty" data-args="[' + idx + ']">−</button>' +
          '<span class="qty">' + r.qty + '</span>' +
          '<button data-action="kioskIncQty" data-args="[' + idx + ']">+</button>' +
        '</div>' +
      '</div>' +
      '<button class="x-row" data-action="kioskRemoveRow" data-args="[' + idx + ']" title="Rimuovi">×</button>' +
      '<div class="lt" style="grid-column:2">' + euroFmt(r.unit_price_cents * r.qty) + '</div>' +
    '</div>';
  }).join("");

  return (
    '<div class="kiosk-cart">' +
      '<div class="cart-h">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div>' +
            '<h3>Il tuo ordine</h3>' +
            '<div class="count">' + KIOSK.cart.reduce((a, r) => a + r.qty, 0) + ' articoli</div>' +
          '</div>' +
          '<button class="cancel-all" data-action="kioskClearCart">Annulla ordine</button>' +
        '</div>' +
      '</div>' +
      '<div class="cart-l">' + items + kioskRenderCrossSell() + '</div>' +
      '<div class="cart-f">' +
        '<div class="total-line"><span>Imponibile</span><span>' + euroFmt(totals.total - totals.vat) + '</span></div>' +
        '<div class="total-line"><span>IVA</span><span>' + euroFmt(totals.vat) + '</span></div>' +
        '<div class="total-line grand"><span>Totale</span><span>' + euroFmt(totals.total) + '</span></div>' +
        '<button class="cta-pay" data-action="kioskConfirmOrder">Conferma e paga alla cassa</button>' +
      '</div>' +
    '</div>'
  );
}

// =========== CROSS-SELL ==========
function kioskRenderCrossSell(){
  const suggestions = kioskGetSuggestions();
  if (suggestions.length === 0) return "";
  return (
    '<div class="xsell">' +
      '<h4>Spesso ordinato anche</h4>' +
      '<div class="xsell-grid">' +
        suggestions.slice(0, 6).map((p) => (
          '<div class="xsell-item" data-action="kioskOnProductTap" data-args=\'["' + p.id + '"]\'>' +
            '<div class="ico">' + kioskProductEmoji(p) + '</div>' +
            '<div class="nm">' + escapeHtml(p.name) + '</div>' +
            '<div class="pr">+ ' + euroFmt(p.price_cents) + '</div>' +
          '</div>'
        )).join("") +
      '</div>' +
    '</div>'
  );
}

// Logica: deriva dai tag dei prodotti già nel carrello.
// Se un prodotto in carrello ha tag "suggests-bevande", suggerisce prodotti della categoria Bevande.
// Mappa: suggests-bevande → category slug "bevande", suggests-brioche → cerca per nome, suggests-tagliere → cerca per nome.
function kioskGetSuggestions(){
  if (KIOSK.cart.length === 0) return [];
  const cartProductIds = new Set(KIOSK.cart.map((r) => r.product_id));
  const wantedTags = new Set();
  KIOSK.cart.forEach((r) => {
    const p = KIOSK.products.find((x) => x.id === r.product_id);
    if (!p || !Array.isArray(p.tags)) return;
    p.tags.forEach((t) => { if (t.startsWith("suggests-")) wantedTags.add(t.replace("suggests-", "")); });
  });
  if (wantedTags.size === 0) return [];

  // Map wantedTag → category slug or keyword
  const out = [];
  const seen = new Set();
  wantedTags.forEach((tag) => {
    let pool = [];
    if (tag === "bevande"){
      pool = KIOSK.products.filter((p) => {
        const cat = KIOSK.categories.find((c) => c.id === p.category_id);
        return cat && cat.slug === "bevande";
      });
    } else if (tag === "caffe"){
      pool = KIOSK.products.filter((p) => /caff|cappuccino|marocchino|ginseng|orzo/i.test(p.name));
    } else if (tag === "brioche"){
      pool = KIOSK.products.filter((p) => /brioche/i.test(p.name));
    } else if (tag === "tagliere"){
      pool = KIOSK.products.filter((p) => /tagliere/i.test(p.name));
    }
    pool.forEach((p) => {
      if (cartProductIds.has(p.id) || seen.has(p.id)) return;
      if (!kioskProductAvailable(p)) return;
      seen.add(p.id);
      out.push(p);
    });
  });
  return out;
}

function kioskRenderSuccess(){
  const ord = KIOSK.lastOrder;
  return (
    '<div class="kiosk-exit" data-action="kioskCornerTap"></div>' +
    '<div class="kiosk-success">' +
      '<div class="ok">✅</div>' +
      '<h1>Grazie!</h1>' +
      '<div class="muted" style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;margin-top:8px">Il tuo numero d\'ordine è</div>' +
      '<div class="num">#' + (ord ? ord.daily_number : "?") + '</div>' +
      '<div class="msg">Mostra questo numero alla cassa per pagare e ritirare.</div>' +
      '<div class="countdown" id="kioskCountdown">Tornerò all\'inizio tra <span id="kioskTimer">10</span> secondi</div>' +
    '</div>'
  );
}

function kioskProductAvailable(p){
  if (p.status === "out_of_stock" || p.status === "hidden") return false;
  if (!p.recipes || p.recipes.length === 0) return true;
  for (let i = 0; i < p.recipes.length; i++){
    const r = p.recipes[i];
    if (!r.ingredient) continue;
    if (Number(r.ingredient.stock_qty) <= Number(r.ingredient.critical_stock_qty)) return false;
  }
  return true;
}

function kioskProductEmoji(p){
  const n = (p.name || "").toLowerCase();
  if (n.includes("caffè") || n.includes("cappuccino") || n.includes("marocchino")) return "☕";
  if (n.includes("brioche")) return "🥐";
  if (n.includes("piadina")) return "🥙";
  if (n.includes("tramezzino")) return "🥪";
  if (n.includes("insalat")) return "🥗";
  if (n.includes("tagliere")) return "🧀";
  if (n.includes("birra")) return "🍺";
  if (n.includes("calice") || n.includes("prosecco") || n.includes("gutturnio") || n.includes("vino")) return "🍷";
  if (n.includes("orzo") || n.includes("ginseng")) return "☕";
  return "🍽";
}

function kioskCartTotals(){
  let subtotal = 0, vat = 0;
  for (const r of KIOSK.cart){
    const lt = r.unit_price_cents * r.qty;
    subtotal += lt;
    vat += Math.round(lt - (lt / (1 + Number(r.vat_rate) / 100)));
  }
  return { subtotal, vat, total: subtotal };
}

// =========== Azioni ==========
function kioskStart(){ kioskGoto("menu"); }

function kioskReset(){
  if (KIOSK.cart.length > 0){
    if (!confirm("Annullare l'ordine corrente e ricominciare?")) return;
  }
  KIOSK.cart = [];
  KIOSK.lastOrder = null;
  KIOSK.recentSuggestion = null;
  sessionStorage.removeItem(KIOSK_SS_KEY);
  kioskGoto("splash");
}

function kioskSwitchCat(catId){
  KIOSK.activeCatId = catId;
  kioskRender();
}

// Quando si tocca un prodotto nella griglia: se ha customizations, apri sheet personalizza.
// Altrimenti aggiungi direttamente al carrello.
function kioskOnProductTap(productId){
  const p = KIOSK.products.find((x) => x.id === productId);
  if (!p) return;
  const hasCustom = Array.isArray(p.customizations) && p.customizations.length > 0;
  if (!hasCustom){
    kioskAddToCart(p, []);
    return;
  }
  KIOSK.pendingProduct = p;
  KIOSK.pendingSelections = {};
  KIOSK.step = "personalize";
  kioskRender();
}

function kioskToggleCustomization(label){
  KIOSK.pendingSelections[label] = !KIOSK.pendingSelections[label];
  kioskRender();
}

function kioskCancelPersonalize(){
  KIOSK.pendingProduct = null;
  KIOSK.pendingSelections = {};
  KIOSK.step = "menu";
  kioskRender();
}

function kioskConfirmPersonalize(){
  const p = KIOSK.pendingProduct;
  if (!p) return;
  const customs = Array.isArray(p.customizations) ? p.customizations : [];
  const selected = customs.filter((c) => KIOSK.pendingSelections[c.label]);
  kioskAddToCart(p, selected);
  KIOSK.pendingProduct = null;
  KIOSK.pendingSelections = {};
  KIOSK.step = "menu";
  kioskRender();
}

// Aggiunge al carrello.
// Items con customizations diverse sono righe separate (non incrementa qty).
function kioskAddToCart(p, customizations){
  customizations = customizations || [];
  const extra = customizations.reduce((a, c) => a + Number(c.price_delta_cents || 0), 0);
  const unitPrice = Number(p.price_cents) + extra;
  const customKey = customizations.map((c) => c.label).sort().join("|");

  const existing = KIOSK.cart.find((c) =>
    c.product_id === p.id &&
    (c.customizations || []).map((x) => x.label).sort().join("|") === customKey
  );
  if (existing){
    existing.qty += 1;
  } else {
    KIOSK.cart.push({
      product_id: p.id,
      product_name: p.name,
      base_price_cents: Number(p.price_cents),
      unit_price_cents: unitPrice,
      vat_rate: p.vat_rate,
      qty: 1,
      customizations: customizations.map((c) => ({ label: c.label, price_delta_cents: Number(c.price_delta_cents || 0) })),
    });
  }
  KIOSK.recentSuggestion = p.id;
  kioskPersistCart();
  kioskRender();
}

function kioskIncQty(idx){ KIOSK.cart[idx].qty += 1; kioskPersistCart(); kioskRender(); }
function kioskDecQty(idx){
  KIOSK.cart[idx].qty -= 1;
  if (KIOSK.cart[idx].qty <= 0) KIOSK.cart.splice(idx, 1);
  kioskPersistCart(); kioskRender();
}
function kioskRemoveRow(idx){
  KIOSK.cart.splice(idx, 1);
  kioskPersistCart(); kioskRender();
}
function kioskClearCart(){
  if (KIOSK.cart.length === 0) return;
  if (!confirm("Annullare tutto l'ordine?")) return;
  KIOSK.cart = [];
  sessionStorage.removeItem(KIOSK_SS_KEY);
  kioskRender();
}

async function kioskConfirmOrder(){
  if (KIOSK.cart.length === 0) return;
  const t = kioskCartTotals();
  // INSERT order con status='pending' (paga alla cassa = pending)
  const { data: ord, error: ordErr } = await supa().from("orders").insert({
    org_id: BRIO.org.id,
    channel: "kiosk",
    status: "pending",
    subtotal_cents: t.total,
    total_cents: t.total,
    vat_cents: t.vat,
    payment_method: "pending",
  }).select().single();

  if (ordErr){ err("[kiosk] insert", ordErr); toast("Errore: " + ordErr.message, "error"); return; }

  const items = KIOSK.cart.map((r) => ({
    order_id: ord.id,
    product_id: r.product_id,
    product_name: r.product_name,
    qty: r.qty,
    unit_price_cents: r.unit_price_cents,
    total_cents: r.unit_price_cents * r.qty,
    vat_rate: r.vat_rate,
    customizations: r.customizations || [],
    kds_status: "queued",
  }));
  await supa().from("order_items").insert(items);

  KIOSK.lastOrder = ord;
  sessionStorage.removeItem(KIOSK_SS_KEY);
  kioskGoto("success");

  // Auto-reset dopo 15s
  let cd = 15;
  const tick = setInterval(() => {
    cd--;
    const el = document.getElementById("kioskTimer");
    if (el) el.textContent = cd;
    if (cd <= 0){ clearInterval(tick); kioskReset(); }
  }, 1000);
}

// =========== Idle / Visibility / Esci ==========
// L'idle resetta dopo 90s di inattività SE c'è qualcosa nel carrello.
// Se il documento è hidden (cliente passa ad altro / app in background), il timer è messo in pausa.
function kioskBumpIdle(){
  clearTimeout(KIOSK.idleTimer);
  if (document.hidden) return;          // pausa quando tab non attiva
  if (KIOSK.step !== "menu") return;
  if (KIOSK.cart.length === 0) return;
  KIOSK.idleTimer = setTimeout(() => {
    log("[kiosk] auto-reset per inattività (90s)");
    KIOSK.cart = [];
    sessionStorage.removeItem(KIOSK_SS_KEY);
    kioskGoto("splash");
  }, 90000);
}

function kioskOnVisibility(){
  if (document.hidden){
    clearTimeout(KIOSK.idleTimer);
    log("[kiosk] tab nascosta — idle in pausa");
  } else {
    log("[kiosk] tab visibile — riprendo idle");
    kioskBumpIdle();
  }
}

function kioskCornerTap(){
  KIOSK.exitTaps.push(Date.now());
  KIOSK.exitTaps = KIOSK.exitTaps.filter((t) => Date.now() - t < 1500);
  if (KIOSK.exitTaps.length >= 4){
    KIOSK.exitTaps = [];
    if (confirm("Uscire dalla modalità Kiosk?")){
      // Stacca listener idle
      ["click","touchstart","keydown"].forEach((ev) => document.removeEventListener(ev, kioskBumpIdle, true));
      navigate("#/");
    }
  }
}

function noop(){}

/* ============================================================
 * MODULO MAGAZZINO
 * ============================================================
 * Funzionalità:
 *  - Lista ingredienti con stato visuale (OK/da riordinare/critico/esaurito)
 *  - Statistiche aggregate in alto
 *  - Filtri per stato
 *  - Modal dettaglio con: carica merce, registra spreco, rettifica
 *  - Storico movimenti per ingrediente
 *  - Realtime: si aggiorna automaticamente quando la cassa scala il magazzino
 * ============================================================ */
const MAGAZZINO = {
  ingredients: [],
  suppliers: {},     // id → riga
  filter: "all",     // all | low | critical | empty | ok
  search: "",
  rtChan: null,
  detailId: null,
  detailAction: "purchase",  // purchase | waste | adjustment
  history: [],
};

async function renderMagazzinoPage(main){
  main.innerHTML =
    '<div class="page-header"><h1>Magazzino</h1><div class="sub muted" id="magSubinfo">Caricamento…</div></div>' +
    '<div class="stats-row" id="magStats"></div>' +
    '<div class="filter-bar">' +
      '<input class="input" id="magSearch" placeholder="Cerca ingrediente…" style="max-width:280px" oninput="magOnSearch(this.value)" />' +
      '<div id="magFilters" style="display:flex;gap:8px;flex-wrap:wrap"></div>' +
    '</div>' +
    '<div class="inv-table" id="magTable"></div>';

  await magLoadAll();
  magRender();
  magSubscribeRealtime();
}

async function magLoadAll(){
  const orgId = BRIO.org.id;
  const [ingRes, supRes] = await Promise.all([
    supa().from("ingredients").select("*").eq("org_id", orgId).eq("active", true).order("name"),
    supa().from("suppliers").select("id, name").eq("org_id", orgId),
  ]);
  if (ingRes.error){ err("[magazzino]", ingRes.error); toast("Errore caricamento", "error"); return; }
  MAGAZZINO.ingredients = ingRes.data || [];
  MAGAZZINO.suppliers = {};
  (supRes.data || []).forEach((s) => { MAGAZZINO.suppliers[s.id] = s; });
  const sub = document.getElementById("magSubinfo");
  if (sub) sub.textContent = MAGAZZINO.ingredients.length + " ingredienti";
}

function magStatus(ing){
  const stock = Number(ing.stock_qty);
  if (stock <= 0) return "empty";
  if (stock <= Number(ing.critical_stock_qty)) return "critical";
  if (stock <= Number(ing.min_stock_qty)) return "low";
  return "ok";
}
function magStatusLabel(s){
  return s === "empty" ? "Esaurito"
       : s === "critical" ? "Critico"
       : s === "low" ? "Da riordinare"
       : "OK";
}

function magRender(){
  // Stats
  const all = MAGAZZINO.ingredients;
  const counts = { all: all.length, ok: 0, low: 0, critical: 0, empty: 0 };
  all.forEach((i) => { counts[magStatus(i)]++; });

  const statsHost = document.getElementById("magStats");
  if (statsHost){
    statsHost.innerHTML =
      '<div class="stat-card"><div class="stat-label">Totale</div><div class="stat-value">' + counts.all + '</div></div>' +
      '<div class="stat-card success"><div class="stat-label">OK</div><div class="stat-value">' + counts.ok + '</div></div>' +
      '<div class="stat-card warn"><div class="stat-label">Da riordinare</div><div class="stat-value">' + counts.low + '</div></div>' +
      '<div class="stat-card danger"><div class="stat-label">Critico / esaurito</div><div class="stat-value">' + (counts.critical + counts.empty) + '</div></div>';
  }

  // Filter chips
  const chips = [
    { key: "all", label: "Tutti", n: counts.all },
    { key: "low", label: "Da riordinare", n: counts.low },
    { key: "critical", label: "Critico", n: counts.critical },
    { key: "empty", label: "Esaurito", n: counts.empty },
    { key: "ok", label: "OK", n: counts.ok },
  ];
  const fHost = document.getElementById("magFilters");
  if (fHost){
    fHost.innerHTML = chips.map((c) => (
      '<div class="filter-chip ' + (MAGAZZINO.filter === c.key ? "active" : "") + '"' +
      ' data-action="magSetFilter" data-args=\'["' + c.key + '"]\'>' +
      escapeHtml(c.label) + '<span class="badge">' + c.n + '</span></div>'
    )).join("");
  }

  // Table
  const tHost = document.getElementById("magTable");
  if (!tHost) return;

  const q = MAGAZZINO.search.toLowerCase().trim();
  let list = MAGAZZINO.ingredients;
  if (MAGAZZINO.filter !== "all"){
    list = list.filter((i) => magStatus(i) === MAGAZZINO.filter);
  }
  if (q){
    list = list.filter((i) => i.name.toLowerCase().includes(q));
  }

  if (list.length === 0){
    tHost.innerHTML = '<div class="muted text-center" style="padding:32px">Nessun ingrediente in questa vista.</div>';
    return;
  }

  const rows = list.map((i) => {
    const s = magStatus(i);
    const supplier = i.supplier_id ? MAGAZZINO.suppliers[i.supplier_id] : null;
    return '<tr data-action="magOpenDetail" data-args=\'["' + i.id + '"]\'>' +
      '<td class="name-cell"><div class="name">' + escapeHtml(i.name) + '</div></td>' +
      '<td data-label="Giacenza" class="qty">' + numFmt(i.stock_qty, 0) + ' <span class="qty-small">' + escapeHtml(i.unit) + '</span></td>' +
      '<td data-label="Soglia" class="qty-small">min ' + numFmt(i.min_stock_qty, 0) + ' · crit ' + numFmt(i.critical_stock_qty, 0) + '</td>' +
      '<td data-label="Costo" class="qty-small">' + euroFmt(i.cost_per_unit_cents) + '/' + escapeHtml(i.unit) + '</td>' +
      '<td data-label="Fornitore" class="qty-small">' + (supplier ? escapeHtml(supplier.name) : '—') + '</td>' +
      '<td data-label="Stato"><span class="inv-status ' + s + '"><span class="dot"></span>' + magStatusLabel(s) + '</span></td>' +
    '</tr>';
  }).join("");

  tHost.innerHTML =
    '<table>' +
      '<thead><tr>' +
        '<th>Ingrediente</th><th>Giacenza</th><th>Soglie</th><th>Costo</th><th>Fornitore</th><th>Stato</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
}

function magSetFilter(key){ MAGAZZINO.filter = key; magRender(); }
function magOnSearch(v){ MAGAZZINO.search = v || ""; magRender(); }

// ========================================================
// REALTIME — si aggiorna quando la cassa scarica magazzino
// ========================================================
function magSubscribeRealtime(){
  if (MAGAZZINO.rtChan) supa().removeChannel(MAGAZZINO.rtChan);
  MAGAZZINO.rtChan = supa().channel("mag-" + BRIO.org.id)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "ingredients", filter: "org_id=eq." + BRIO.org.id },
      (payload) => {
        log("[magazzino] realtime update", payload.eventType, payload.new && payload.new.name);
        if (payload.eventType === "UPDATE" && payload.new){
          const idx = MAGAZZINO.ingredients.findIndex((i) => i.id === payload.new.id);
          if (idx >= 0){
            MAGAZZINO.ingredients[idx] = payload.new;
            magRender();
            // Se il modal del dettaglio è aperto su questo ingrediente, aggiorniamolo
            if (MAGAZZINO.detailId === payload.new.id){
              magRefreshDetailHeader();
            }
          }
        } else if (payload.eventType === "INSERT" && payload.new){
          MAGAZZINO.ingredients.push(payload.new);
          MAGAZZINO.ingredients.sort((a, b) => a.name.localeCompare(b.name));
          magRender();
        } else if (payload.eventType === "DELETE" && payload.old){
          MAGAZZINO.ingredients = MAGAZZINO.ingredients.filter((i) => i.id !== payload.old.id);
          magRender();
        }
      })
    .subscribe();
}

// ========================================================
// MODAL DETTAGLIO INGREDIENTE
// ========================================================
async function magOpenDetail(ingredientId){
  MAGAZZINO.detailId = ingredientId;
  MAGAZZINO.detailAction = "purchase";
  // carica ultimi 20 movimenti
  const { data, error } = await supa()
    .from("inventory_movements")
    .select("*")
    .eq("ingredient_id", ingredientId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error){ err("[magazzino] history", error); }
  MAGAZZINO.history = data || [];
  magShowDetailModal();
}

function magShowDetailModal(){
  const ing = MAGAZZINO.ingredients.find((i) => i.id === MAGAZZINO.detailId);
  if (!ing) return;
  const supplier = ing.supplier_id ? MAGAZZINO.suppliers[ing.supplier_id] : null;
  const status = magStatus(ing);
  const action = MAGAZZINO.detailAction;

  const history = MAGAZZINO.history.map((m) => {
    const cls = Number(m.qty) > 0 ? "pos" : "neg";
    const sign = Number(m.qty) > 0 ? "+" : "";
    const typeLabel = ({sale:"vendita",purchase:"carico",waste:"spreco",adjustment:"rettifica",transfer:"trasf."})[m.type] || m.type;
    return '<div class="hist-row">' +
      '<div><div>' + escapeHtml(typeLabel) + (m.reason ? ' · <span class="reason">' + escapeHtml(m.reason) + '</span>' : '') + '</div><div class="when">' + dateFmt(m.created_at) + ' ' + timeFmt(m.created_at) + '</div></div>' +
      '<div class="delta ' + cls + '">' + sign + numFmt(m.qty, 0) + ' ' + escapeHtml(ing.unit) + '</div>' +
    '</div>';
  }).join("");

  const actionForm =
    action === "purchase"
      ? '<form data-form="magPurchase">' +
        '<label class="field"><span class="label">Quantità caricata (' + escapeHtml(ing.unit) + ')</span>' +
          '<input class="input" name="qty" type="number" step="0.01" min="0.01" required placeholder="es. 1000" autofocus />' +
        '</label>' +
        '<label class="field"><span class="label">Costo unitario (€/' + escapeHtml(ing.unit) + ') · opzionale</span>' +
          '<input class="input" name="cost" type="number" step="0.001" min="0" placeholder="' + (Number(ing.cost_per_unit_cents)/100).toFixed(3) + '" />' +
        '</label>' +
        '<label class="field"><span class="label">Note · opzionale</span>' +
          '<input class="input" name="reason" type="text" placeholder="Es. consegna fornitore X" />' +
        '</label>' +
        '<button class="btn btn-primary" style="width:100%" type="submit">Carica magazzino</button>' +
      '</form>'
      : action === "waste"
      ? '<form data-form="magWaste">' +
        '<label class="field"><span class="label">Quantità sprecata (' + escapeHtml(ing.unit) + ')</span>' +
          '<input class="input" name="qty" type="number" step="0.01" min="0.01" required placeholder="es. 50" autofocus />' +
        '</label>' +
        '<label class="field"><span class="label">Motivo</span>' +
          '<select class="select" name="reason" required>' +
            '<option value="rotto">Rotto / caduto</option>' +
            '<option value="scaduto">Scaduto</option>' +
            '<option value="errore_preparazione">Errore preparazione</option>' +
            '<option value="cliente_reclamo">Reclamo cliente</option>' +
            '<option value="altro">Altro</option>' +
          '</select>' +
        '</label>' +
        '<button class="btn btn-danger" style="width:100%" type="submit">Registra spreco</button>' +
      '</form>'
      : '<form data-form="magAdjustment">' +
        '<label class="field"><span class="label">Giacenza reale conteggiata (' + escapeHtml(ing.unit) + ')</span>' +
          '<input class="input" name="qty" type="number" step="0.01" min="0" required placeholder="' + numFmt(ing.stock_qty, 0) + '" value="' + numFmt(ing.stock_qty, 0).replace(/\./g,"").replace(",",".") + '" autofocus />' +
        '</label>' +
        '<div class="muted mb-16" style="font-size:12px">Sistema attualmente: ' + numFmt(ing.stock_qty, 0) + ' ' + escapeHtml(ing.unit) + '. La differenza sarà registrata come rettifica.</div>' +
        '<label class="field"><span class="label">Motivo · opzionale</span>' +
          '<input class="input" name="reason" type="text" placeholder="Es. inventario settimanale 15/05" />' +
        '</label>' +
        '<button class="btn btn-primary" style="width:100%" type="submit">Aggiorna giacenza</button>' +
      '</form>';

  document.body.insertAdjacentHTML("beforeend",
    '<div class="modal-backdrop mag-detail" id="magDetailModal" onclick="if(event.target===this) magCloseDetail()">' +
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<div>' +
            '<h2>' + escapeHtml(ing.name) + '</h2>' +
            '<div class="sub muted" style="margin-top:4px;font-size:13px">' +
              '<span class="inv-status ' + status + '"><span class="dot"></span>' + magStatusLabel(status) + '</span> · ' +
              '<span id="magHeaderStock">' + numFmt(ing.stock_qty, 0) + ' ' + escapeHtml(ing.unit) + '</span> in giacenza' +
            '</div>' +
          '</div>' +
          '<button class="modal-close" data-action="magCloseDetail">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="info-grid">' +
            '<div class="info"><div class="label">Unità</div><div class="value">' + escapeHtml(ing.unit) + '</div></div>' +
            '<div class="info"><div class="label">Costo unitario</div><div class="value">' + euroFmt(ing.cost_per_unit_cents) + '</div></div>' +
            '<div class="info"><div class="label">Soglia min</div><div class="value">' + numFmt(ing.min_stock_qty, 0) + ' ' + escapeHtml(ing.unit) + '</div></div>' +
            '<div class="info"><div class="label">Soglia critica</div><div class="value">' + numFmt(ing.critical_stock_qty, 0) + ' ' + escapeHtml(ing.unit) + '</div></div>' +
            '<div class="info" style="grid-column:1/-1"><div class="label">Fornitore</div><div class="value">' + (supplier ? escapeHtml(supplier.name) : '—') + '</div></div>' +
          '</div>' +
          '<div class="action-tabs">' +
            '<button class="' + (action === "purchase" ? "active" : "") + '" data-action="magSetDetailAction" data-args=\'["purchase"]\'>+ Carica</button>' +
            '<button class="' + (action === "waste" ? "active" : "") + '" data-action="magSetDetailAction" data-args=\'["waste"]\'>− Spreco</button>' +
            '<button class="' + (action === "adjustment" ? "active" : "") + '" data-action="magSetDetailAction" data-args=\'["adjustment"]\'>= Rettifica</button>' +
          '</div>' +
          actionForm +
          '<div class="history">' +
            '<h4>Storico movimenti</h4>' +
            (history || '<div class="muted" style="font-size:13px;padding:8px 0">Nessun movimento registrato.</div>') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function magCloseDetail(){
  MAGAZZINO.detailId = null;
  const m = document.getElementById("magDetailModal");
  if (m) m.remove();
}

function magSetDetailAction(action){
  MAGAZZINO.detailAction = action;
  magCloseDetail();
  // riapriamo il modal (history già caricata)
  MAGAZZINO.detailId = MAGAZZINO.ingredients.find((i) => i.id) ? MAGAZZINO.detailId : null;
  // ripristina il detailId che abbiamo perso col reset di magCloseDetail
  // workaround: usiamo un local
}

// Override magSetDetailAction with corrected version that preserves detailId
window.magSetDetailAction = function(action){
  const id = MAGAZZINO.detailId;
  MAGAZZINO.detailAction = action;
  const m = document.getElementById("magDetailModal");
  if (m) m.remove();
  MAGAZZINO.detailId = id;
  magShowDetailModal();
};

function magRefreshDetailHeader(){
  const ing = MAGAZZINO.ingredients.find((i) => i.id === MAGAZZINO.detailId);
  if (!ing) return;
  const h = document.getElementById("magHeaderStock");
  if (h) h.textContent = numFmt(ing.stock_qty, 0) + " " + ing.unit;
}

// ========================================================
// FORM HANDLERS · carica / spreco / rettifica
// ========================================================
async function onMagPurchaseSubmit(form){
  const qty = parseFloat((form.qty.value || "0").replace(",", "."));
  const cost = parseFloat((form.cost.value || "0").replace(",", ".")) || 0;
  const reason = (form.reason.value || "").trim();
  if (!qty || qty <= 0){ toast("Quantità non valida", "error"); return; }

  const ing = MAGAZZINO.ingredients.find((i) => i.id === MAGAZZINO.detailId);
  if (!ing) return;

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = "Salvataggio…";

  // 1. Update giacenza + eventuale costo unitario
  const newStock = Number(ing.stock_qty) + qty;
  const updatePayload = { stock_qty: newStock };
  if (cost > 0) updatePayload.cost_per_unit_cents = Math.round(cost * 100);
  const { error: upErr } = await supa().from("ingredients").update(updatePayload).eq("id", ing.id);
  if (upErr){ err("[magazzino] update", upErr); toast("Errore: " + upErr.message, "error"); btn.disabled = false; btn.textContent = "Carica magazzino"; return; }

  // 2. Registra movimento
  await supa().from("inventory_movements").insert({
    org_id: BRIO.org.id,
    ingredient_id: ing.id,
    type: "purchase",
    qty: qty,
    unit_cost_cents: cost > 0 ? Math.round(cost * 100) : ing.cost_per_unit_cents,
    reason: reason || null,
    created_by: BRIO.user.id,
  });

  toast("Caricato " + numFmt(qty, 0) + " " + ing.unit + " di " + ing.name, "success");
  // Ricarica history per il modal
  await magOpenDetail(ing.id);
}

async function onMagWasteSubmit(form){
  const qty = parseFloat((form.qty.value || "0").replace(",", "."));
  const reason = form.reason.value;
  if (!qty || qty <= 0){ toast("Quantità non valida", "error"); return; }

  const ing = MAGAZZINO.ingredients.find((i) => i.id === MAGAZZINO.detailId);
  if (!ing) return;
  if (qty > Number(ing.stock_qty)){
    if (!confirm("Stai sprecando più di quanto sia in giacenza. Continuare?")) return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = "Salvataggio…";

  const newStock = Math.max(0, Number(ing.stock_qty) - qty);
  const { error: upErr } = await supa().from("ingredients").update({ stock_qty: newStock }).eq("id", ing.id);
  if (upErr){ err("[magazzino] update", upErr); toast("Errore: " + upErr.message, "error"); btn.disabled = false; btn.textContent = "Registra spreco"; return; }

  await supa().from("inventory_movements").insert({
    org_id: BRIO.org.id,
    ingredient_id: ing.id,
    type: "waste",
    qty: -qty,
    unit_cost_cents: ing.cost_per_unit_cents,
    reason: reason,
    created_by: BRIO.user.id,
  });

  toast("Spreco registrato: " + numFmt(qty, 0) + " " + ing.unit, "success");
  await magOpenDetail(ing.id);
}

async function onMagAdjustmentSubmit(form){
  const newQty = parseFloat((form.qty.value || "0").replace(",", "."));
  const reason = (form.reason.value || "Inventario fisico").trim();
  if (isNaN(newQty) || newQty < 0){ toast("Valore non valido", "error"); return; }

  const ing = MAGAZZINO.ingredients.find((i) => i.id === MAGAZZINO.detailId);
  if (!ing) return;
  const delta = newQty - Number(ing.stock_qty);

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = "Salvataggio…";

  const { error: upErr } = await supa().from("ingredients").update({ stock_qty: newQty }).eq("id", ing.id);
  if (upErr){ err("[magazzino] update", upErr); toast("Errore: " + upErr.message, "error"); btn.disabled = false; btn.textContent = "Aggiorna giacenza"; return; }

  if (delta !== 0){
    await supa().from("inventory_movements").insert({
      org_id: BRIO.org.id,
      ingredient_id: ing.id,
      type: "adjustment",
      qty: delta,
      unit_cost_cents: ing.cost_per_unit_cents,
      reason: reason,
      created_by: BRIO.user.id,
    });
  }

  toast("Giacenza aggiornata a " + numFmt(newQty, 0) + " " + ing.unit + " (Δ " + (delta >= 0 ? "+" : "") + numFmt(delta, 0) + ")", "success");
  await magOpenDetail(ing.id);
}

// ========================================================
// SHORTCUT KEYBOARD F1-F12
// ========================================================
function cassaAttachShortcuts(){
  // Rimuovi eventuale listener precedente (se navighi via)
  if (window._cassaShortcutHandler){
    document.removeEventListener("keydown", window._cassaShortcutHandler);
  }
  window._cassaShortcutHandler = function(e){
    if (location.hash !== "#/cassa") return;
    // Niente shortcut se siamo in un input/textarea
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const key = e.key.toUpperCase(); // "F1"..."F12"
    if (CASSA.shortcutMap[key]){
      e.preventDefault();
      cassaAddToCart(CASSA.shortcutMap[key].id);
    }
  };
  document.addEventListener("keydown", window._cassaShortcutHandler);
}
