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
// YYYY-MM-DD in fuso orario LOCALE (NON UTC). Da usare per i campi `date` di Postgres
// dove abbiamo salvato `current_date`. Evita off-by-one quando si è ore prima della
// mezzanotte UTC ma giorno successivo locale (o viceversa).
function localDateStr(d){
  const dt = d ? (d instanceof Date ? d : new Date(d)) : new Date();
  return dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
}

// ============================================================
// DIALOG (popup brandizzato Brio — sostituisce alert/confirm/prompt)
// ============================================================
let _brioDlgSeq = 0;

function brioConfirm(opts){
  return new Promise((resolve) => {
    opts = opts || {};
    const id = "brioDlg-" + (++_brioDlgSeq);
    const title  = opts.title || "Conferma";
    const msg    = opts.message || "";
    const ok     = opts.okLabel || "Conferma";
    const cancel = opts.cancelLabel || "Annulla";
    const danger = !!opts.danger;
    const icon   = opts.icon || (danger ? "⚠️" : "❓");
    const kind   = danger ? "danger" : (opts.kind || "");

    document.body.insertAdjacentHTML("beforeend",
      '<div class="brio-dlg-back" id="' + id + '">' +
        '<div class="brio-dlg ' + escapeHtml(kind) + '">' +
          '<div class="dlg-head">' +
            '<div class="dlg-icon">' + icon + '</div>' +
            '<div class="dlg-title">' + escapeHtml(title) + '</div>' +
          '</div>' +
          (msg ? '<div class="dlg-body">' + escapeHtml(msg) + '</div>' : '') +
          '<div class="dlg-actions">' +
            '<button class="dlg-cancel" data-res="0">' + escapeHtml(cancel) + '</button>' +
            '<button class="dlg-ok" data-res="1">' + escapeHtml(ok) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    const elBack = document.getElementById(id);
    function close(result){
      elBack.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e){
      if (e.key === "Escape"){ e.preventDefault(); close(false); }
      else if (e.key === "Enter"){ e.preventDefault(); close(true); }
    }
    document.addEventListener("keydown", onKey, true);
    elBack.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-res]");
      if (btn){ close(btn.getAttribute("data-res") === "1"); }
      else if (e.target === elBack){ close(false); }
    });
  });
}

function brioAlert(opts){
  return new Promise((resolve) => {
    opts = opts || {};
    const id = "brioDlg-" + (++_brioDlgSeq);
    const title  = opts.title || "Avviso";
    const msg    = opts.message || "";
    const ok     = opts.okLabel || "OK";
    const kind   = opts.kind || "info";
    const icon   = opts.icon || (kind === "danger" ? "⚠️" : kind === "warning" ? "⚠️" : "ℹ️");

    document.body.insertAdjacentHTML("beforeend",
      '<div class="brio-dlg-back" id="' + id + '">' +
        '<div class="brio-dlg ' + escapeHtml(kind) + '">' +
          '<div class="dlg-head">' +
            '<div class="dlg-icon">' + icon + '</div>' +
            '<div class="dlg-title">' + escapeHtml(title) + '</div>' +
          '</div>' +
          (msg ? '<div class="dlg-body">' + escapeHtml(msg) + '</div>' : '') +
          '<div class="dlg-actions">' +
            '<button class="dlg-ok" data-res="1" style="flex:1">' + escapeHtml(ok) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    const elBack = document.getElementById(id);
    function close(){
      elBack.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve();
    }
    function onKey(e){
      if (e.key === "Escape" || e.key === "Enter"){ e.preventDefault(); close(); }
    }
    document.addEventListener("keydown", onKey, true);
    elBack.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-res]");
      if (btn || e.target === elBack){ close(); }
    });
  });
}

function brioPrompt(opts){
  return new Promise((resolve) => {
    opts = opts || {};
    const id = "brioDlg-" + (++_brioDlgSeq);
    const title  = opts.title || "Inserisci valore";
    const msg    = opts.message || "";
    const ph     = opts.placeholder || "";
    const value  = opts.value || "";
    const ok     = opts.okLabel || "Conferma";
    const cancel = opts.cancelLabel || "Annulla";
    const icon   = opts.icon || "✏️";

    document.body.insertAdjacentHTML("beforeend",
      '<div class="brio-dlg-back" id="' + id + '">' +
        '<div class="brio-dlg">' +
          '<div class="dlg-head">' +
            '<div class="dlg-icon">' + icon + '</div>' +
            '<div class="dlg-title">' + escapeHtml(title) + '</div>' +
          '</div>' +
          (msg ? '<div class="dlg-body">' + escapeHtml(msg) + '</div>' : '') +
          '<div class="dlg-input">' +
            '<input type="text" placeholder="' + escapeHtml(ph) + '" value="' + escapeHtml(value) + '" />' +
          '</div>' +
          '<div class="dlg-actions">' +
            '<button class="dlg-cancel" data-res="0">' + escapeHtml(cancel) + '</button>' +
            '<button class="dlg-ok" data-res="1">' + escapeHtml(ok) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    const elBack = document.getElementById(id);
    const input = elBack.querySelector("input");
    setTimeout(() => { input.focus(); input.select(); }, 50);
    function close(result){
      elBack.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e){
      if (e.key === "Escape"){ e.preventDefault(); close(null); }
      else if (e.key === "Enter"){ e.preventDefault(); close(input.value); }
    }
    document.addEventListener("keydown", onKey, true);
    elBack.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-res]");
      if (btn){
        close(btn.getAttribute("data-res") === "1" ? input.value : null);
      } else if (e.target === elBack){
        close(null);
      }
    });
  });
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
  "#/menu-admin": { name: "menu-admin", managerUp: true, render: renderMenuAdminPage },
  "#/fornitori":  { name: "fornitori",  managerUp: true, render: renderFornitoriPage },
  "#/chiusura":   { name: "chiusura",   managerUp: true, render: renderChiusuraPage },
  "#/cassa-fiscale": { name: "cassa-fiscale", adminOnly: true, render: renderCassaFiscalePage },
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
    // NB: non svuotiamo main.innerHTML prima del render — ogni render function
    // sostituisce già il contenuto, evitando un flash visivo intermedio.
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
    { hash: "#/menu-admin", icon: "🍽️", label: "Menu",     show: () => canManage() },
    { hash: "#/magazzino", icon: "📦", label: "Magazzino",  show: () => canManage() },
    { hash: "#/fornitori", icon: "🚚", label: "Fornitori",  show: () => canManage() },
    { hash: "#/dashboard", icon: "📊", label: "Dashboard",  show: () => isAdmin() },
    { hash: "#/chiusura",  icon: "🔒", label: "Chiusura",   show: () => canManage() },
    { hash: "#/cassa-fiscale", icon: "🧾", label: "Cassa fiscale", show: () => isAdmin() },
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
    { hash: "#/menu-admin", icon: "🍽️", title: "Menu",      desc: "Gestione prodotti, ricette e prezzi",    show: () => canManage() },
    { hash: "#/magazzino", icon: "📦", title: "Magazzino",  desc: "Giacenze real-time + soglie",            show: () => canManage() },
    { hash: "#/fornitori", icon: "🚚", title: "Fornitori",  desc: "Ordini automatici e anagrafica",         show: () => canManage() },
    { hash: "#/dashboard", icon: "📊", title: "Dashboard",  desc: "KPI giorno, food cost, allarmi",         show: () => isAdmin() },
    { hash: "#/chiusura",  icon: "🔒", title: "Chiusura",   desc: "Chiusura cassa giornaliera",             show: () => canManage() },
    { hash: "#/cassa-fiscale", icon: "🧾", title: "Cassa fiscale", desc: "Configura RT + POS, log scontrini fiscali", show: () => isAdmin() },
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
  const todayStr = localDateStr(today);

  // Query: ordini paid di oggi + righe (per top prodotti)
  // NB: usiamo localDateStr (NO toISOString) per evitare off-by-one timezone
  const { data: orders, error } = await supa()
    .from("orders")
    .select("id, daily_number, total_cents, status, channel, created_at, order_items(qty, product_name)")
    .eq("org_id", BRIO.org.id)
    .eq("daily_date", todayStr)
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
// renderKdsPage: vedi sezione KDS in fondo al file
// renderDashboardPage: vedi sezione DASHBOARD in fondo al file
// renderMagazzinoPage: vedi sezione MAGAZZINO in fondo al file
function renderFornitoriPage(main){  placeholderPage(main, "Fornitori", "Anagrafica, ordini automatici via email, ricezione merce."); }
// renderChiusuraPage: vedi sezione CHIUSURA CASSA in fondo al file
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
    const addable = productMaxAddable(p, CASSA.cart);
    const maxQty = productMaxQty(p);
    const unavail = addable <= 0;
    let badge = "";
    if (maxQty <= 0) badge = '<div class="stock-badge stock-out">Esaurito</div>';
    else if (addable <= 0) badge = '<div class="stock-badge stock-out">Limite raggiunto</div>';
    else if (maxQty < 5) badge = '<div class="stock-badge stock-low">Ultimi ' + maxQty + '</div>';
    return '<div class="product-tile ' + (unavail ? "unavailable" : "") + '"' +
      ' data-action="' + (unavail ? "cassaUnavailable" : "cassaAddToCart") + '" data-args=\'["' + p.id + '"]\'>' +
      (p.shortcut_key ? '<div class="shortcut">' + escapeHtml(p.shortcut_key) + '</div>' : "") +
      badge +
      '<div class="name">' + escapeHtml(p.name) + '</div>' +
      '<div class="price">' + euroFmt(p.price_cents) + '</div>' +
    '</div>';
  }).join("");
}

// Calcola QUANTI pezzi di un prodotto sono ancora producibili dato lo stock
// corrente dei suoi ingredienti. Es: piadina con 60g prosciutto, in magazzino
// 300g prosciutto → max 5 piadine. Se prodotto senza ricetta: illimitato (9999).
function productMaxQty(p){
  if (!p) return 0;
  if (p.status === "hidden" || p.status === "out_of_stock") return 0;
  if (!p.recipes || p.recipes.length === 0) return 9999;
  let min = Infinity;
  for (let i = 0; i < p.recipes.length; i++){
    const r = p.recipes[i];
    if (!r.ingredient) continue;
    const recipeQty = Number(r.qty);
    if (!recipeQty) continue;
    const stock = Number(r.ingredient.stock_qty) || 0;
    const possible = Math.floor(stock / recipeQty);
    if (possible < min) min = possible;
  }
  return min === Infinity ? 9999 : Math.max(0, min);
}

// Conta quanti pezzi di un prodotto sono già nel carrello (somma di tutte le
// righe con lo stesso product_id, anche con customizations diverse).
function cartQtyOfProduct(cart, productId){
  if (!cart) return 0;
  let n = 0;
  for (let i = 0; i < cart.length; i++){
    if (cart[i].product_id === productId) n += Number(cart[i].qty) || 0;
  }
  return n;
}

// Quanti pezzi del prodotto si possono ancora AGGIUNGERE al carrello
// (max producibile - già nel carrello).
function productMaxAddable(p, cart){
  return Math.max(0, productMaxQty(p) - cartQtyOfProduct(cart, p.id));
}

// Un prodotto è disponibile se ne possiamo produrre almeno 1 pezzo.
function productAvailable(p){
  return productMaxQty(p) > 0;
}

function cassaUnavailable(){ toast("Prodotto esaurito o limite magazzino raggiunto", "error"); }

function cassaAddToCart(productId){
  const p = CASSA.products.find((x) => x.id === productId);
  if (!p) return;
  if (productMaxAddable(p, CASSA.cart) <= 0){
    cassaUnavailable();
    return;
  }
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
  cassaRenderProducts(); // aggiorna badge "Ultimi N" / "Limite raggiunto"
}

function cassaIncQty(idx){
  const row = CASSA.cart[idx];
  if (!row) return;
  const p = CASSA.products.find((x) => x.id === row.product_id);
  if (p && productMaxAddable(p, CASSA.cart) <= 0){
    cassaUnavailable();
    return;
  }
  row.qty += 1;
  cassaRenderCart();
  cassaRenderProducts();
}
function cassaDecQty(idx){
  CASSA.cart[idx].qty -= 1;
  if (CASSA.cart[idx].qty <= 0) CASSA.cart.splice(idx, 1);
  cassaRenderCart();
  cassaRenderProducts();
}
function cassaRemoveRow(idx){ CASSA.cart.splice(idx, 1); cassaRenderCart(); cassaRenderProducts(); }
async function cassaClearCart(){
  if (CASSA.cart.length === 0) return;
  const ok = await brioConfirm({
    title: "Svuotare il carrello?",
    message: "L'ordine in corso verrà cancellato.",
    okLabel: "Svuota",
    danger: true,
    icon: "🗑️",
  });
  if (!ok) return;
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

  // 3) UPDATE order a 'paid' → fa scattare il trigger che scarica magazzino + registra movimenti.
  //    Se il trigger DB rileva magazzino insufficiente, raise exception → cleanup ordine pending.
  const { error: payErr } = await supa()
    .from("orders").update({ status: "paid" }).eq("id", ord.id);
  if (payErr){
    err("[cassa] update paid", payErr);
    const msg = (payErr.message || "").toLowerCase();
    if (msg.includes("magazzino insufficiente")){
      // cleanup: cancella ordine + items pending per non lasciare spazzatura
      await supa().from("order_items").delete().eq("order_id", ord.id);
      await supa().from("orders").delete().eq("id", ord.id);
      toast("Magazzino insufficiente: " + payErr.message, "error");
      CASSA.saving = false;
      await cassaLoadData();
      cassaRenderProducts();
      return;
    }
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

  // 5) CASSA FISCALE — emette scontrino su RT + comando POS (in test simula).
  //    In modalità live (TODO) può fallire: in quel caso mostriamo l'errore
  //    ma l'ordine resta paid (la fiscalità si può riprocessare dal log).
  let fiscalResult = null;
  try {
    fiscalResult = await fiscalEmettiScontrino({
      order_id: ord.id,
      amount_cents: t.total,
      payment_method: CASSA.paymentMethod,
      lines: CASSA.cart.map((r) => ({
        name: r.product_name,
        qty: r.qty,
        unit_price_cents: r.unit_price_cents,
        vat_rate: r.vat_rate,
      })),
    });
    if (!fiscalResult.ok && !fiscalResult.skipped){
      toast("Scontrino fiscale: " + (fiscalResult.error || "errore"), "error");
    }
  } catch(e){
    err("[cassa] fiscal", e);
    toast("Errore scontrino fiscale: " + (e.message || e), "error");
  }

  // 6) UI: chiudi modal pagamento, mostra modal successo
  cassaCloseCheckout();
  showReceiptModal(ord, change, fiscalResult);

  // 5) Svuota carrello + ricarica giacenze (i trigger DB hanno scalato)
  CASSA.cart = [];
  await cassaLoadData();
  cassaRenderProducts();
  cassaRenderCart();
  CASSA.saving = false;
}

function showReceiptModal(order, change, fiscal){
  // Sezione scontrino fiscale: mostra numero se emesso, badge TEST se simulato, errore se fallito
  let fiscalBlock = "";
  if (fiscal && fiscal.ok){
    fiscalBlock = '<div class="receipt-fiscal ok">' +
      '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Scontrino fiscale</div>' +
      '<div style="font-size:15px;font-weight:600;margin-top:2px">' + escapeHtml(fiscal.receipt_number) +
        (fiscal.simulated ? ' <span class="cfi-log-test">TEST</span>' : '') + '</div>' +
      (fiscal.rt_serial ? '<div class="muted" style="font-size:11px;margin-top:2px">Matricola RT ' + escapeHtml(fiscal.rt_serial) + '</div>' : "") +
    '</div>';
  } else if (fiscal && !fiscal.ok && !fiscal.skipped){
    fiscalBlock = '<div class="receipt-fiscal err">' +
      '<div style="font-size:13px;font-weight:600;color:var(--danger)">⚠️ Scontrino fiscale non emesso</div>' +
      '<div class="muted" style="font-size:12px;margin-top:2px">' + escapeHtml(fiscal.error || "Errore sconosciuto") + '</div>' +
    '</div>';
  }
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
            fiscalBlock +
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
  daypartOverride: null,      // "mattina" | "pranzo" | "aperitivo" se l'utente ha scelto "ordine rapido"
};

// ============================================================
// FASCE ORARIE · "vetrina viva del momento" (vedi BRIO_BRAND_GUIDELINES)
// ============================================================
// 07:00-10:30 mattina · 10:30-17:30 pranzo · 17:30-chiusura aperitivo
const KIOSK_DAYPARTS = {
  mattina:   { from: "07:00", to: "10:30", emoji: "☀️", labelIt: "MATTINA",    labelEn: "MORNING",   slug: "caffetteria" },
  pranzo:    { from: "10:30", to: "17:30", emoji: "🍽️", labelIt: "POMERIGGIO", labelEn: "AFTERNOON", slug: "pranzo" },
  aperitivo: { from: "17:30", to: "24:00", emoji: "🌙", labelIt: "SERA",       labelEn: "EVENING",   slug: "aperitivo" },
};

// Hero copy per fascia. Il \n viene reso come a-capo (CSS white-space: pre-line)
// → titolo spezzato su 2 righe come nel mockup target.
const KIOSK_HERO = {
  mattina:   { titleIt: "Buongiorno!",                  subIt: "Inizia la giornata con brio.",
               titleEn: "Good morning!",                subEn: "Start your day with brio." },
  pranzo:    { titleIt: "Pranzo veloce.\nFatto bene.",  subIt: "Piadine, tramezzini, bibite.",
               titleEn: "Quick lunch.\nDone right.",    subEn: "Piadine, sandwiches, drinks." },
  aperitivo: { titleIt: "È il momento\ndell'aperitivo.", subIt: "Rilassati, sei da Brio.",
               titleEn: "Aperitivo time.\nRelax at Brio.", subEn: "Wines, beers, platters." },
};

// Pulsanti "Ordine rapido" della home (3 + quello della fascia corrente è evidenziato)
const KIOSK_QUICK_BUTTONS = [
  { key: "mattina",   icon: "☕", labelIt: "Colazione veloce", labelEn: "Quick breakfast" },
  { key: "pranzo",    icon: "🥪", labelIt: "Pranzo veloce",    labelEn: "Quick lunch" },
  { key: "aperitivo", icon: "🍺", labelIt: "Aperitivo veloce", labelEn: "Quick aperitivo" },
];

// Hero image grande (sopra al CTA) e featured cards (sotto al CTA) per fascia.
// Foto reali HD in /brand/prodotti/ (sincronizzate da prodotti/ via tools/sync_prodotti.py).
const KIOSK_HERO_IMAGE = {
  mattina:   "/brand/prodotti/cappuccino-brioche-cioccolato.jpg",
  pranzo:    "/brand/prodotti/piadina-coppa-piacentina-rucola-e-squacquerone.jpg",
  aperitivo: "/brand/prodotti/tagliere-coppa-piacentina-salame-piacentino-pancetta-piacentina.jpg",
};

// Card "featured" sotto al CTA: 3-4 per fascia, ciascuna con foto + label + categoria slug
const KIOSK_FEATURED = {
  mattina: [
    { labelIt: "Caffè fumante",   labelEn: "Hot coffee",       img: "/brand/prodotti/caffe.jpg",             cat: "caffetteria" },
    { labelIt: "Brioche fresche", labelEn: "Fresh croissants", img: "/brand/prodotti/brioche-crema.jpg",     cat: "caffetteria" },
    { labelIt: "Cappuccino",      labelEn: "Cappuccino",       img: "/brand/prodotti/caffe-con-schiuma.jpg", cat: "caffetteria" },
  ],
  pranzo: [
    { labelIt: "Piadine",    labelEn: "Piadine",     img: "/brand/prodotti/piadina-crudo-rucola-e-squacquerone.jpg",                            cat: "pranzo" },
    { labelIt: "Tramezzini", labelEn: "Sandwiches",  img: "/brand/prodotti/tramezzino-cotto-mozzarella-pomodoro-maionese.jpg",                  cat: "pranzo" },
    { labelIt: "Insalatone", labelEn: "Salad bowls", img: "/brand/prodotti/insalatona-instalata-verde-radicchio-mozzarella-tonno-pomodoro.jpg", cat: "pranzo" },
    { labelIt: "Bibite",     labelEn: "Drinks",      img: "/brand/prodotti/acqua-naturale.jpg",                                                 cat: "bevande" },
  ],
  aperitivo: [
    { labelIt: "Birre",     labelEn: "Beers",     img: "/brand/prodotti/birra-menabrea.jpg",                                                cat: "aperitivo" },
    { labelIt: "Vini",      labelEn: "Wines",     img: "/brand/prodotti/calice-prosecco.jpg",                                               cat: "aperitivo" },
    { labelIt: "Taglieri",  labelEn: "Platters",  img: "/brand/prodotti/tagliere-mini.jpg",                                                 cat: "aperitivo" },
    { labelIt: "Aperitivi", labelEn: "Aperitifs", img: "/brand/prodotti/tagliere-coppa-piacentina-salame-piacentino-pancetta-piacentina.jpg", cat: "aperitivo" },
  ],
};

// Alias hardcoded per il match foto-prodotto. Ha la priorità sul match per prefisso
// (troppo aggressivo: es. "Piadina classica" → "piadina-" → prendeva la prima foto
// alfabetica = piadina-coppa, sbagliata!). Chiavi = slug del nome prodotto.
const PRODOTTI_ALIAS = {
  // Caffetteria
  "caffe":             "caffe",
  "espresso":          "caffe",
  "cappuccino":        "caffe-con-schiuma",
  "latte-macchiato":   "caffe-con-schiuma",
  "marocchino":        "caffe-marocchino",
  "caffe-marocchino":  "caffe-marocchino",
  "ginseng":           "caffe-ginseng",
  "caffe-ginseng":     "caffe-ginseng",
  "orzo":              "caffe-d-orzo",
  "caffe-orzo":        "caffe-d-orzo",
  "caffe-d-orzo":      "caffe-d-orzo",
  // Brioche
  "brioche":             "brioche-vuota",
  "brioche-vuota":       "brioche-vuota",
  "brioche-cioccolato":  "brioche-cioccolato",
  "brioche-crema":       "brioche-crema",
  "brioche-marmellata":  "brioche-marmellata-di-albicocche",
  "brioche-miele":       "brioche-miele-e-noci-pecan",
  // Piadine
  "piadina":           "piadina-crudo-rucola-e-squacquerone",
  "piadina-classica":  "piadina-crudo-rucola-e-squacquerone",
  "piadina-crudo":     "piadina-crudo-rucola-e-squacquerone",
  "piadina-speciale":  "piadina-coppa-piacentina-rucola-e-squacquerone",
  "piadina-coppa":     "piadina-coppa-piacentina-rucola-e-squacquerone",
  // Tramezzini
  "tramezzino":          "tramezzino-cotto-mozzarella-pomodoro-maionese",
  "tramezzino-classico": "tramezzino-cotto-mozzarella-pomodoro-maionese",
  "tramezzino-cotto":    "tramezzino-cotto-mozzarella-pomodoro-maionese",
  "tramezzino-farcito":  "tramezzino-cotto-mozzarella-pomodoro-maionese",
  // Insalatone
  "insalatona":          "insalatona-instalata-verde-radicchio-mozzarella-tonno-pomodoro",
  "insalata":            "insalatona-instalata-verde-radicchio-mozzarella-tonno-pomodoro",
  // Taglieri
  "tagliere":                "tagliere-coppa-piacentina-salame-piacentino-pancetta-piacentina",
  "tagliere-salumi":         "tagliere-coppa-piacentina-salame-piacentino-pancetta-piacentina",
  "tagliere-formaggi":       "tagliere-coppa-piacentina-salame-piacentino-pancetta-piacentina",
  "tagliere-mini":           "tagliere-mini",
  "tagliere-mini-condiviso": "tagliere-mini",
  // Aperitivo
  "birra-moretti":      "birra-moretti-33cl",
  "birra-moretti-33cl": "birra-moretti-33cl",
  "moretti":            "birra-moretti-33cl",
  "prosecco":           "calice-prosecco",
  "calice-prosecco":    "calice-prosecco",
  // Bevande
  "acqua":                  "acqua-naturale",
  "acqua-naturale":         "acqua-naturale",
  "acqua-naturale-50cl":    "acqua-naturale",
  "acqua-frizzante":        "acqua-frizzante",
  "acqua-frizzante-50cl":   "acqua-frizzante",
  // Sfiziosità
  "mozzarella-sticks":             "mozzarella-sticks",
  "jalapenos-cheddar":             "jalapeno-cheddar",
  "jalapeno-cheddar":              "jalapeno-cheddar",
  "onion-rings":                   "onion-rings",
  "patatine-fritte":               "patatine-fritte",
  "patatine":                      "patatine-fritte",
  "patatine-cheddar-bacon":        "patatine-fritte-cheddar-bacon",
  "patatine-cheddar-e-bacon":      "patatine-fritte-cheddar-bacon",
  "patatine-fritte-cheddar-bacon": "patatine-fritte-cheddar-bacon",
};

// Manifest delle foto prodotti disponibili (caricato al boot). Mappa slug → url.
// Usato per match automatico foto-prodotto quando product.image_url è null.
let PRODOTTI_IMG_MAP = null;

async function loadProdottiManifest(){
  if (PRODOTTI_IMG_MAP !== null) return;
  try {
    const r = await fetch("/brand/prodotti/manifest.json");
    if (!r.ok){ PRODOTTI_IMG_MAP = {}; return; }
    const arr = await r.json();
    PRODOTTI_IMG_MAP = {};
    arr.forEach((e) => { if (e.slug && e.url) PRODOTTI_IMG_MAP[e.slug] = e.url; });
    log("[brand] manifest prodotti:", Object.keys(PRODOTTI_IMG_MAP).length, "foto disponibili");
  } catch(e){
    err("[brand] manifest load fallito", e);
    PRODOTTI_IMG_MAP = {};
  }
}

// Slugify analogo a tools/sync_prodotti.py (lowercase, accenti rimossi, non-alphanum → dash)
function slugifyJs(s){
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Ritorna URL foto prodotto. Ordine di priorità:
//   1. product.image_url (settato a mano in Menu admin → vince sempre)
//   2. match esatto slug(name) === slug(foto)
//   3. alias hardcoded PRODOTTI_ALIAS (es. "piadina-classica" → foto crudo)
//   4. match estensivo "slug + dash" (es. "caffe-d" → "caffe-d-orzo")
//   5. nessuna foto → emoji fallback
// Il match per "prima parola" è stato RIMOSSO perché troppo aggressivo (es. tutte
// le piadine prendevano la prima foto piadina-* in ordine alfabetico).
function productImageUrl(p){
  if (!p) return null;
  if (p.image_url) return p.image_url;
  if (!PRODOTTI_IMG_MAP) return null;
  const slug = slugifyJs(p.name);
  if (!slug) return null;
  // 2. Match esatto
  if (PRODOTTI_IMG_MAP[slug]) return PRODOTTI_IMG_MAP[slug];
  // 3. Alias hardcoded
  const aliased = PRODOTTI_ALIAS[slug];
  if (aliased && PRODOTTI_IMG_MAP[aliased]) return PRODOTTI_IMG_MAP[aliased];
  // 4. Match estensivo: slug del prodotto è prefisso ESATTO di una foto
  const keys = Object.keys(PRODOTTI_IMG_MAP);
  const m = keys.find((k) => k.startsWith(slug + "-"));
  if (m) return PRODOTTI_IMG_MAP[m];
  // 5. Fallback "stem": rimuovo l'ultima parola del slug e riprovo (max 1 parola).
  //    Risolve casi tipo "Acqua naturale 50cl" → "acqua-naturale-50cl" → "acqua-naturale" match
  //    o "Tramezzino farcito" → fallback ad alias "tramezzino".
  const parts = slug.split("-");
  if (parts.length > 1){
    const stem = parts.slice(0, -1).join("-");
    if (PRODOTTI_IMG_MAP[stem]) return PRODOTTI_IMG_MAP[stem];
    if (PRODOTTI_ALIAS[stem] && PRODOTTI_IMG_MAP[PRODOTTI_ALIAS[stem]]) {
      return PRODOTTI_IMG_MAP[PRODOTTI_ALIAS[stem]];
    }
    const mStem = keys.find((k) => k.startsWith(stem + "-"));
    if (mStem) return PRODOTTI_IMG_MAP[mStem];
  }
  return null;
}

// Restituisce la fascia corrente in base all'ora locale ("mattina"|"pranzo"|"aperitivo")
function kioskDaypart(){
  // Override via URL ?dp=mattina|pranzo|aperitivo (per testing/preview)
  try {
    const url = new URLSearchParams(location.search);
    const override = url.get("dp");
    if (override && KIOSK_DAYPARTS[override]) return override;
  } catch(e){ /* ignore */ }
  // Default: in base all'ora locale
  const d = new Date();
  const minutes = d.getHours() * 60 + d.getMinutes();
  const mattinaEnd = 10 * 60 + 30; // 10:30
  const pranzoEnd  = 17 * 60 + 30; // 17:30
  const mattinaStart = 7 * 60;     // 07:00
  if (minutes >= mattinaStart && minutes < mattinaEnd) return "mattina";
  if (minutes >= mattinaEnd && minutes < pranzoEnd) return "pranzo";
  // Dopo le 17:30 e fino alla mezzanotte: aperitivo. Anche notte fonda lo trattiamo come aperitivo (locale chiuso).
  return "aperitivo";
}
const KIOSK_SS_KEY = "brio.kiosk.cart";
const KIOSK_LANG_KEY = "brio.kiosk.lang";

// ============================================================
// i18n — dizionario IT/EN per le label statiche del Kiosk
// ============================================================
const K_I18N = {
  it: {
    "splash.welcome": "Sii Brio.",
    "splash.welcome_accent": "Ordina qui.",
    "splash.tagline": "Dal caffè al calice",
    "splash.cta": "Tocca per iniziare",
    "splash.footnote": "Brio · Piacenza",
    "menu.new_order": "Nuovo ordine",
    "menu.cart_title": "Il tuo ordine",
    "menu.cart_items": "articoli",
    "menu.cart_empty_msg": "Tocca un prodotto per iniziare",
    "menu.cart_cancel_all": "Annulla ordine",
    "menu.cart_confirm": "Procedi al pagamento",
    "menu.cart_subtotal": "Imponibile",
    "menu.cart_vat": "IVA",
    "menu.cart_total": "Totale",
    "menu.cart_suggest": "Spesso ordinato anche",
    "menu.cart_each": "cad.",
    "menu.unavailable": "Esaurito",
    "personalize.sub_prefix": "Personalizza il tuo prodotto",
    "personalize.options": "Opzioni",
    "personalize.none": "Nessuna opzione disponibile.",
    "personalize.cancel": "Annulla",
    "personalize.add": "Aggiungi",
    "pay.title": "Dove vorresti pagare?",
    "pay.sub": "Scegli come pagare il tuo ordine",
    "pay.here": "Paga qui",
    "pay.here_desc": "Con carta al totem",
    "pay.cassa": "Paga alla cassa",
    "pay.cassa_desc": "Mostra il numero all'operatrice",
    "pay.back": "← Indietro",
    "pay.processing": "Pagamento in corso…",
    "success.thanks": "Grazie!",
    "success.your_num": "Il tuo numero d'ordine è",
    "success.show_at_register": "Mostra questo numero alla cassa per pagare e ritirare.",
    "success.paid_msg": "Pagamento confermato. Ritira al banco quando pronto.",
    "success.countdown_prefix": "Tornerò all'inizio tra",
    "success.countdown_suffix": "secondi",
  },
  en: {
    "splash.welcome": "Be Brio.",
    "splash.welcome_accent": "Order here.",
    "splash.tagline": "From coffee to wine",
    "splash.cta": "Tap to start",
    "splash.footnote": "Brio · Piacenza, Italy",
    "menu.new_order": "New order",
    "menu.cart_title": "Your order",
    "menu.cart_items": "items",
    "menu.cart_empty_msg": "Tap a product to start",
    "menu.cart_cancel_all": "Cancel order",
    "menu.cart_confirm": "Proceed to payment",
    "menu.cart_subtotal": "Subtotal",
    "menu.cart_vat": "VAT",
    "menu.cart_total": "Total",
    "menu.cart_suggest": "Often ordered with",
    "menu.cart_each": "ea.",
    "menu.unavailable": "Out of stock",
    "personalize.sub_prefix": "Customize your product",
    "personalize.options": "Options",
    "personalize.none": "No customization available.",
    "personalize.cancel": "Cancel",
    "personalize.add": "Add",
    "pay.title": "How would you like to pay?",
    "pay.sub": "Choose your payment method",
    "pay.here": "Pay here",
    "pay.here_desc": "Card at kiosk",
    "pay.cassa": "Pay at register",
    "pay.cassa_desc": "Show the number to the cashier",
    "pay.back": "← Back",
    "pay.processing": "Processing payment…",
    "success.thanks": "Thank you!",
    "success.your_num": "Your order number is",
    "success.show_at_register": "Show this number at the register to pay and pick up.",
    "success.paid_msg": "Payment confirmed. Pick up at the counter when ready.",
    "success.countdown_prefix": "Returning to start in",
    "success.countdown_suffix": "seconds",
  }
};

function kioskLang(){
  return localStorage.getItem(KIOSK_LANG_KEY) || "it";
}
function kioskT(key){
  const lang = kioskLang();
  return (K_I18N[lang] && K_I18N[lang][key]) || K_I18N.it[key] || key;
}
function kioskSetLang(lang){
  if (lang !== "it" && lang !== "en") return;
  localStorage.setItem(KIOSK_LANG_KEY, lang);
  kioskRender();
}

// Dropdown lingua (stile mockup "Italiano ⌄")
function kioskToggleLangMenu(e){
  if (e) e.stopPropagation();
  const m = document.getElementById("kioskLangMenu");
  if (!m) return;
  m.classList.toggle("hidden");
  // Click fuori dal menu lo chiude
  if (!m.classList.contains("hidden")){
    setTimeout(() => {
      document.addEventListener("click", kioskCloseLangMenuOnce, { once: true });
    }, 0);
  }
}
function kioskCloseLangMenuOnce(){
  const m = document.getElementById("kioskLangMenu");
  if (m) m.classList.add("hidden");
}
function kioskCloseLangMenu(){
  const m = document.getElementById("kioskLangMenu");
  if (m) m.classList.add("hidden");
}

async function renderKioskPage(main){
  document.getElementById("appRoot").innerHTML = '<div class="kiosk-root" id="kioskRoot"></div>';

  // Carica manifest foto + dati menu in parallelo
  await Promise.all([kioskLoadData(), loadProdottiManifest()]);
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
    const cur = kioskLang();
    const dp = kioskDaypart();
    const dpCfg = KIOSK_DAYPARTS[dp];
    const hero = KIOSK_HERO[dp];
    const heroImg = KIOSK_HERO_IMAGE[dp];
    const lang = cur;

    // Chip orario in cima al totem (sopra il logo)
    const chip = '<div class="kiosk-dp-chip"><span class="emoji">' + dpCfg.emoji + '</span><div><div class="dp-label">' + (lang === "en" ? dpCfg.labelEn : dpCfg.labelIt) + '</div><div class="dp-time">' + dpCfg.from + ' · ' + dpCfg.to + '</div></div></div>';

    // Featured cards in basso (3-4 prodotti con foto reale per fascia)
    const featured = KIOSK_FEATURED[dp] || [];
    const featuredHtml = featured.map((f) => (
      '<button class="kiosk-feat-card"' +
        ' onclick="event.stopPropagation(); kioskQuickStartCat(\'' + escapeHtml(f.cat) + '\')">' +
        '<div class="ff-photo" style="background-image:url(\'' + f.img + '\')"></div>' +
        '<div class="ff-label">' + escapeHtml(lang === "en" ? f.labelEn : f.labelIt) + '</div>' +
      '</button>'
    )).join("");

    // Lang dropdown unico (stile mockup "Italiano ⌄") — toggle apre lista
    const otherLang = cur === "it" ? "en" : "it";
    const langLabel = cur === "it" ? "🇮🇹 Italiano" : "🇬🇧 English";
    const langSwitch =
      '<div class="kt-lang">' +
        '<button class="lang-pill" onclick="event.stopPropagation(); kioskToggleLangMenu(event)">' +
          escapeHtml(langLabel) + ' <span class="caret">⌄</span>' +
        '</button>' +
        '<div class="lang-menu hidden" id="kioskLangMenu">' +
          '<button onclick="event.stopPropagation(); kioskSetLang(\'it\'); kioskCloseLangMenu()">🇮🇹 Italiano</button>' +
          '<button onclick="event.stopPropagation(); kioskSetLang(\'en\'); kioskCloseLangMenu()">🇬🇧 English</button>' +
        '</div>' +
      '</div>';

    body =
      '<div class="kiosk-splash kiosk-dp-' + dp + '" data-action="kioskStart">' +
        // Foto FULLSCREEN dietro l'interfaccia + 2 overlay top/bottom per leggibilità
        '<div class="hero-image-bg" style="background-image:url(\'' + heroImg + '\')"></div>' +
        '<div class="hero-overlay-top"></div>' +
        '<div class="hero-overlay-bottom"></div>' +
        exitTrigger +
        chip +
        // Totem content sopra agli overlay (z-index)
        '<div class="kiosk-totem">' +
          // Riga header: logo+tagline (sinistra) · lang dropdown (destra)
          '<div class="kt-topbar">' +
            '<div class="kt-head">' +
              '<div class="brio-logo"><span class="b">b</span><span class="rio">rio</span></div>' +
              '<div class="tagline-small">' + escapeHtml(kioskT("splash.tagline")) + '.</div>' +
            '</div>' +
            langSwitch +
          '</div>' +
          // Hero text (sopra a tutto, leggibile grazie all'overlay-top)
          '<h1 class="kiosk-hero-title">' + escapeHtml(lang === "en" ? hero.titleEn : hero.titleIt) + '</h1>' +
          // Spacer per "lasciar respirare" la foto in mezzo (la foto si vede dietro)
          '<div class="kt-hero-spacer" aria-hidden="true"></div>' +
          // CTA primario gradient
          '<button class="cta">' + escapeHtml(kioskT("splash.cta")) + ' →</button>' +
          // Featured cards
          '<div class="kt-featured">' + featuredHtml + '</div>' +
          // Footer separato
          '<div class="kt-footer">' +
            '<span>Ordina qui · Ritira al banco</span>' +
            '<span class="kt-acc">♿ Accessibilità</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  } else if (KIOSK.step === "menu" || KIOSK.step === "personalize"){
    // In personalize il menu rimane visibile come sfondo; la sheet viene aggiunta sopra
    body = kioskRenderMenu();
  } else if (KIOSK.step === "payment_choice"){
    body = kioskRenderPaymentChoice();
  } else if (KIOSK.step === "success"){
    body = kioskRenderSuccess();
  }

  root.innerHTML = body;

  // Personalize è un modal sopra al menu (non sostituisce il body)
  if (KIOSK.step === "personalize" && KIOSK.pendingProduct){
    document.body.insertAdjacentHTML("beforeend", kioskRenderPersonalize());
  } else {
    // Rimuovi TUTTI gli eventuali kpzModal duplicati (safety)
    document.querySelectorAll("#kpzModal").forEach((m) => m.remove());
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
    const maxQty = productMaxQty(p);
    const addable = productMaxAddable(p, KIOSK.cart);
    const avail = addable > 0;
    // Foto: image_url DB → match slug nome in /brand/prodotti/ → emoji fallback
    const imgUrl = productImageUrl(p);
    const photo = imgUrl
      ? '<div class="photo-area" style="background-image:url(\'' + escapeHtml(imgUrl) + '\');background-size:cover;background-position:center"></div>'
      : '<div class="photo-area">' + kioskProductEmoji(p) + '</div>';
    let stockBadge = "";
    if (maxQty <= 0) stockBadge = '<div class="kiosk-stock-badge out">Esaurito</div>';
    else if (addable <= 0) stockBadge = '<div class="kiosk-stock-badge out">Limite</div>';
    else if (maxQty < 5) stockBadge = '<div class="kiosk-stock-badge low">Ultimi ' + maxQty + '</div>';
    return '<div class="kiosk-product ' + (avail ? "" : "unavailable") + '"' +
      ' data-action="' + (avail ? "kioskOnProductTap" : "noop") + '" data-args=\'["' + p.id + '"]\'>' +
      photo + stockBadge +
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
      // Solo icona "b" gradient, niente wordmark "rio" ripetuto
      '<div class="logo-small" style="font-size:36px"><span class="b">b</span></div>' +
      '<button class="home-btn" data-action="kioskReset">⟲ ' + escapeHtml(kioskT("menu.new_order")) + '</button>' +
    '</div>' +
    '<div class="kiosk-body">' +
      '<aside class="kiosk-cats-side">' + cats + '</aside>' +
      '<div class="kiosk-content">' +
        kioskRenderHero() +
        '<div class="kiosk-products">' + products + '</div>' +
      '</div>' +
      kioskRenderCart() +
    '</div>'
  );
}

// =========== HERO time-based offerta ==========
function kioskRenderHero(){
  const offer = kioskCurrentOffer();
  if (!offer) return "";
  const action = offer.combo && offer.combo.length > 0 ? "kioskAddCombo" : "";
  // Doppia parentesi: il delegator chiama fn.apply(null, args) — dobbiamo passare
  // l'intero array come UN unico parametro, quindi wrappiamo: [[...skus...]]
  const args = offer.combo ? JSON.stringify([offer.combo]) : "[]";
  return (
    '<div class="kiosk-hero" ' + (action ? 'data-action="' + action + '" data-args=\'' + args.replace(/'/g, "&#39;") + '\' style="cursor:pointer"' : '') + '>' +
      '<div>' +
        '<div class="badge">' + escapeHtml(offer.badge) + '</div>' +
        '<h2>' + escapeHtml(offer.title) + '</h2>' +
        '<p>' + escapeHtml(offer.msg) + '</p>' +
      '</div>' +
      '<div class="icon">' + offer.icon + '</div>' +
    '</div>'
  );
}

/**
 * Offerta corrente time-based.
 * Restituisce { badge, title, msg, icon, combo: [sku, ...] }
 * combo = lista SKU da aggiungere al carrello con tap
 */
function kioskCurrentOffer(){
  const hr = new Date().getHours();
  if (hr >= 7 && hr < 11){
    return {
      badge: "Offerta colazione",
      title: "Caffè + brioche",
      msg: "Tocca per aggiungere al carrello",
      icon: "☕🥐",
      combo: ["CAF-001","CAF-010"],
    };
  }
  if (hr >= 11 && hr < 15){
    return {
      badge: "Menù pranzo",
      title: "Piadina classica + bevanda",
      msg: "Tocca per aggiungere · pranzo veloce 11:30-14:30",
      icon: "🥙🥤",
      combo: ["PRA-001","BEV-001"],
    };
  }
  if (hr >= 17 && hr < 20){
    return {
      badge: "Aperitivo del giorno",
      title: "Calice + tagliere mini",
      msg: "Tocca per aggiungere · happy hour 17:30-19:30",
      icon: "🍷🧀",
      combo: ["APE-010","PRA-011"],
    };
  }
  return {
    badge: "Sempre con te",
    title: "Esplora il menu Brio",
    msg: "Scegli e personalizza",
    icon: "✨",
    combo: null,
  };
}

// Aggiunge i prodotti combo al carrello (chiamato dal tap sull'hero)
function kioskAddCombo(skus){
  if (!Array.isArray(skus) || skus.length === 0) return;
  skus.forEach((sku) => {
    const p = KIOSK.products.find((x) => x.sku === sku);
    if (p) kioskAddToCart(p, []);
  });
  toast("Offerta aggiunta al carrello", "success");
}

// =========== PERSONALIZZAZIONE (bottom sheet) ==========
// Customization options:
// - default toggle (checkbox): selezioni indipendenti
// - { group: "name" }: mutuamente esclusive (radio), una sola selezionata per group
// - { default: true }: option pre-selezionata all'apertura del modal
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

  // Raggruppo le opzioni: quelle con stesso group vanno in una sezione radio
  // Quelle senza group restano standalone (toggle)
  const groups = {};
  const standalone = [];
  customs.forEach((c) => {
    if (c.group){
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    } else {
      standalone.push(c);
    }
  });

  function renderOpt(c, isRadio){
    const sel = !!KIOSK.pendingSelections[c.label];
    const delta = Number(c.price_delta_cents || 0);
    const labelEsc = c.label.replace(/'/g, "\\u0027").replace(/"/g, "&quot;");
    return '<div class="kpz-opt ' + (sel ? "selected" : "") + (isRadio ? " kpz-radio" : "") + '"' +
      ' data-action="kioskToggleCustomization" data-args=\'["' + labelEsc + '"]\'>' +
      '<div>' + escapeHtml(c.label) + '</div>' +
      '<div class="flex items-center">' +
        (delta !== 0 ? '<span class="delta">' + (delta > 0 ? "+" : "−") + euroFmt(Math.abs(delta)) + '</span>' : '') +
        '<span class="check">' + (sel ? (isRadio ? '●' : '✓') : '') + '</span>' +
      '</div>' +
    '</div>';
  }

  // Render: prima i group (es. "Size"), poi le opzioni standalone
  let sectionsHtml = "";
  Object.keys(groups).forEach((groupName) => {
    const groupLabel = groupName.charAt(0).toUpperCase() + groupName.slice(1);
    sectionsHtml +=
      '<div class="kpz-section">' +
        '<div class="lbl">' + escapeHtml(groupLabel) + '</div>' +
        groups[groupName].map((c) => renderOpt(c, true)).join("") +
      '</div>';
  });
  if (standalone.length > 0){
    sectionsHtml +=
      '<div class="kpz-section">' +
        '<div class="lbl">' + escapeHtml(kioskT("personalize.options")) + '</div>' +
        standalone.map((c) => renderOpt(c, false)).join("") +
      '</div>';
  }

  return (
    '<div class="kpz-back" id="kpzModal" onclick="if(event.target===this) kioskCancelPersonalize()">' +
      '<div class="kpz-sheet">' +
        '<div class="kpz-head">' +
          '<div>' +
            '<h2>' + escapeHtml(p.name) + '</h2>' +
            '<div class="sub">' + escapeHtml(p.description || kioskT("personalize.sub_prefix")) + '</div>' +
          '</div>' +
          '<button class="modal-close" data-action="kioskCancelPersonalize">×</button>' +
        '</div>' +
        '<div class="kpz-body">' +
          (customs.length === 0
            ? '<div class="muted text-center" style="padding:30px;font-size:14px">' + escapeHtml(kioskT("personalize.none")) + '</div>'
            : sectionsHtml
          ) +
        '</div>' +
        '<div class="kpz-foot">' +
          '<button class="cancel" data-action="kioskCancelPersonalize">' + escapeHtml(kioskT("personalize.cancel")) + '</button>' +
          '<button class="add" data-action="kioskConfirmPersonalize">' + escapeHtml(kioskT("personalize.add")) + ' · ' + euroFmt(finalPrice) + '</button>' +
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
        '<div class="cart-h"><h3>' + escapeHtml(kioskT("menu.cart_title")) + '</h3></div>' +
        '<div class="cart-l"><div class="cart-empty"><div class="icon">🛒</div>' + escapeHtml(kioskT("menu.cart_empty_msg")) + '</div></div>' +
        '<div class="cart-f"><button class="cta-pay" disabled>' + escapeHtml(kioskT("menu.cart_confirm")) + '</button></div>' +
      '</div>'
    );
  }
  const items = KIOSK.cart.map((r, idx) => {
    const chips = (r.customizations || []).map((c) => '<span class="chip">' + escapeHtml(c.label) + (c.price_delta_cents > 0 ? " +" + euroFmt(c.price_delta_cents) : "") + '</span>').join("");
    return '<div class="citem">' +
      '<div>' +
        '<div class="n">' + escapeHtml(r.product_name) + '</div>' +
        '<div class="u">' + euroFmt(r.unit_price_cents) + ' ' + escapeHtml(kioskT("menu.cart_each")) + '</div>' +
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
            '<h3>' + escapeHtml(kioskT("menu.cart_title")) + '</h3>' +
            '<div class="count">' + KIOSK.cart.reduce((a, r) => a + r.qty, 0) + ' ' + escapeHtml(kioskT("menu.cart_items")) + '</div>' +
          '</div>' +
          '<button class="cancel-all" data-action="kioskClearCart">' + escapeHtml(kioskT("menu.cart_cancel_all")) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cart-l">' + items + kioskRenderCrossSell() + '</div>' +
      '<div class="cart-f">' +
        '<div class="total-line"><span>' + escapeHtml(kioskT("menu.cart_subtotal")) + '</span><span>' + euroFmt(totals.total - totals.vat) + '</span></div>' +
        '<div class="total-line"><span>' + escapeHtml(kioskT("menu.cart_vat")) + '</span><span>' + euroFmt(totals.vat) + '</span></div>' +
        '<div class="total-line grand"><span>' + escapeHtml(kioskT("menu.cart_total")) + '</span><span>' + euroFmt(totals.total) + '</span></div>' +
        '<button class="cta-pay" data-action="kioskGotoPay">' + escapeHtml(kioskT("menu.cart_confirm")) + '</button>' +
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
      '<h4>' + escapeHtml(kioskT("menu.cart_suggest")) + '</h4>' +
      '<div class="xsell-grid">' +
        suggestions.slice(0, 6).map((p) => {
          const xImg = productImageUrl(p);
          const xMedia = xImg
            ? '<div class="ico" style="background-image:url(\'' + escapeHtml(xImg) + '\');background-size:cover;background-position:center"></div>'
            : '<div class="ico">' + kioskProductEmoji(p) + '</div>';
          return (
          '<div class="xsell-item" data-action="kioskOnProductTap" data-args=\'["' + p.id + '"]\'>' +
            xMedia +
            '<div class="nm">' + escapeHtml(p.name) + '</div>' +
            '<div class="pr">+ ' + euroFmt(p.price_cents) + '</div>' +
          '</div>'
          );
        }).join("") +
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
  const paid = ord && ord.status === "paid";
  return (
    '<div class="kiosk-exit" data-action="kioskCornerTap"></div>' +
    '<div class="kiosk-success">' +
      '<div class="ok">✅</div>' +
      '<h1>' + escapeHtml(kioskT("success.thanks")) + '</h1>' +
      '<div class="muted" style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;margin-top:8px">' + escapeHtml(kioskT("success.your_num")) + '</div>' +
      '<div class="num">#' + (ord ? ord.daily_number : "?") + '</div>' +
      '<div class="msg">' + escapeHtml(paid ? kioskT("success.paid_msg") : kioskT("success.show_at_register")) + '</div>' +
      '<div class="countdown" id="kioskCountdown">' + escapeHtml(kioskT("success.countdown_prefix")) + ' <span id="kioskTimer">15</span> ' + escapeHtml(kioskT("success.countdown_suffix")) + '</div>' +
    '</div>'
  );
}

function kioskProductAvailable(p){
  return productMaxAddable(p, KIOSK.cart) > 0;
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
function kioskStart(){
  // All'apertura del menu, seleziona di default la categoria della fascia corrente
  kioskPickDaypartCategory(KIOSK.daypartOverride || kioskDaypart());
  kioskGoto("menu");
}

// "Ordine rapido" dai 3 pulsanti della splash: entra al menu con la categoria
// della fascia richiesta (non dipende dall'orario corrente).
function kioskQuickStart(daypartKey){
  KIOSK.daypartOverride = daypartKey;
  kioskPickDaypartCategory(daypartKey);
  kioskGoto("menu");
}

// Card "featured" della splash: tap sulla foto di un prodotto/categoria
// → entra al menu sulla categoria con quello slug.
function kioskQuickStartCat(catSlug){
  if (!KIOSK.categories || KIOSK.categories.length === 0){ kioskGoto("menu"); return; }
  const cat = KIOSK.categories.find((c) => c.slug === catSlug);
  if (cat) KIOSK.activeCatId = cat.id;
  kioskGoto("menu");
}

// Sceglie activeCatId dalla categoria che corrisponde alla fascia, se esiste.
// Usa lo slug del KIOSK_DAYPARTS. Fallback: prima categoria visibile.
function kioskPickDaypartCategory(daypartKey){
  if (!KIOSK.categories || KIOSK.categories.length === 0) return;
  const wantedSlug = (KIOSK_DAYPARTS[daypartKey] || {}).slug;
  let cat = null;
  if (wantedSlug) cat = KIOSK.categories.find((c) => c.slug === wantedSlug);
  if (!cat) cat = KIOSK.categories[0];
  if (cat) KIOSK.activeCatId = cat.id;
}

async function kioskReset(){
  if (KIOSK.cart.length > 0){
    const ok = await brioConfirm({
      title: "Ricominciare?",
      message: "L'ordine corrente verrà annullato.",
      okLabel: "Ricomincia",
      cancelLabel: "Continua a ordinare",
      danger: true,
      icon: "↻",
    });
    if (!ok) return;
  }
  KIOSK.cart = [];
  KIOSK.lastOrder = null;
  KIOSK.recentSuggestion = null;
  KIOSK.daypartOverride = null;
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
  // Pre-seleziona le opzioni con default: true (utile per i group radio:
  // es. "Media 40cl" della birra è la size pre-selezionata all'apertura)
  KIOSK.pendingSelections = {};
  (p.customizations || []).forEach((c) => {
    if (c.default) KIOSK.pendingSelections[c.label] = true;
  });
  KIOSK.step = "personalize";
  kioskRender();
}

function kioskToggleCustomization(label){
  const p = KIOSK.pendingProduct;
  if (!p) return;
  const customs = Array.isArray(p.customizations) ? p.customizations : [];
  const target = customs.find((c) => c.label === label);

  if (target && target.group){
    // Radio: deseleziona tutte le altre dello stesso group, seleziona questa
    customs.forEach((c) => {
      if (c.group === target.group) KIOSK.pendingSelections[c.label] = false;
    });
    KIOSK.pendingSelections[label] = true;
  } else {
    // Toggle standard (checkbox)
    KIOSK.pendingSelections[label] = !KIOSK.pendingSelections[label];
  }

  // Aggiornamento incrementale del modal: niente flicker
  const modal = document.getElementById("kpzModal");
  if (!modal){ kioskRender(); return; }

  // Aggiorna stato visivo di ogni opzione
  modal.querySelectorAll(".kpz-opt").forEach((el) => {
    const args = el.getAttribute("data-args");
    let lbl = null;
    try { lbl = JSON.parse(args)[0]; } catch(e){}
    if (!lbl) return;
    const sel = !!KIOSK.pendingSelections[lbl];
    const isRadio = el.classList.contains("kpz-radio");
    el.classList.toggle("selected", sel);
    const check = el.querySelector(".check");
    if (check) check.textContent = sel ? (isRadio ? "●" : "✓") : "";
  });

  // Aggiorna il prezzo nel bottone "Aggiungi · € X"
  let extra = 0;
  customs.forEach((c) => {
    if (KIOSK.pendingSelections[c.label]) extra += Number(c.price_delta_cents || 0);
  });
  const finalPrice = Number(p.price_cents) + extra;
  const addBtn = modal.querySelector(".kpz-foot .add");
  if (addBtn) addBtn.textContent = kioskT("personalize.add") + " · " + euroFmt(finalPrice);
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
  // Cleanup PRIMA di chiamare kioskAddToCart, altrimenti il render interno
  // ricreerebbe il modal (state ancora "personalize") creando un duplicato.
  KIOSK.pendingProduct = null;
  KIOSK.pendingSelections = {};
  KIOSK.step = "menu";
  kioskAddToCart(p, selected);
}

// Aggiunge al carrello.
// Items con customizations diverse sono righe separate (non incrementa qty).
function kioskAddToCart(p, customizations){
  customizations = customizations || [];
  // Stock check: se non possiamo aggiungerne più, blocca
  if (productMaxAddable(p, KIOSK.cart) <= 0){
    toast("Prodotto esaurito", "error");
    return;
  }
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

function kioskIncQty(idx){
  const row = KIOSK.cart[idx];
  if (!row) return;
  const p = (KIOSK.products || []).find((x) => x.id === row.product_id);
  if (p && productMaxAddable(p, KIOSK.cart) <= 0){
    toast("Prodotto esaurito", "error");
    return;
  }
  row.qty += 1;
  kioskPersistCart();
  kioskRender();
}
function kioskDecQty(idx){
  KIOSK.cart[idx].qty -= 1;
  if (KIOSK.cart[idx].qty <= 0) KIOSK.cart.splice(idx, 1);
  kioskPersistCart(); kioskRender();
}
function kioskRemoveRow(idx){
  KIOSK.cart.splice(idx, 1);
  kioskPersistCart(); kioskRender();
}
async function kioskClearCart(){
  if (KIOSK.cart.length === 0) return;
  const ok = await brioConfirm({
    title: "Annullare l'ordine?",
    message: "Tutti gli articoli nel carrello verranno rimossi.",
    okLabel: "Annulla ordine",
    cancelLabel: "No, continua",
    danger: true,
    icon: "🗑️",
  });
  if (!ok) return;
  KIOSK.cart = [];
  sessionStorage.removeItem(KIOSK_SS_KEY);
  kioskRender();
}

// Vai allo step di scelta pagamento (chiamato dal bottone "Procedi al pagamento")
function kioskGotoPay(){
  if (KIOSK.cart.length === 0) return;
  KIOSK.step = "payment_choice";
  kioskRender();
}

// Torna al menu dallo step pagamento
function kioskBackToMenu(){
  KIOSK.step = "menu";
  kioskRender();
}

/**
 * Step "Dove vorresti pagare?" con 2 grandi card:
 *  - Paga qui: pagamento al totem (per ora simulato come carta)
 *  - Paga alla cassa: cliente paga alla cassa mostrando il numero
 */
function kioskRenderPaymentChoice(){
  return (
    '<div class="kiosk-exit" data-action="kioskCornerTap"></div>' +
    '<div class="kiosk-pay">' +
      '<button class="kiosk-pay-back-btn" data-action="kioskBackToMenu">' + escapeHtml(kioskT("pay.back")) + '</button>' +
      '<h1>' + escapeHtml(kioskT("pay.title")) + '</h1>' +
      '<div class="pay-sub">' + escapeHtml(kioskT("pay.sub")) + '</div>' +
      '<div class="kiosk-pay-cards">' +
        '<div class="kiosk-pay-card primary" data-action="kioskPayHere">' +
          '<div class="icon">💳</div>' +
          '<div class="name">' + escapeHtml(kioskT("pay.here")) + '</div>' +
          '<div class="desc">' + escapeHtml(kioskT("pay.here_desc")) + '</div>' +
        '</div>' +
        '<div class="kiosk-pay-card" data-action="kioskPayCassa">' +
          '<div class="icon">🧾</div>' +
          '<div class="name">' + escapeHtml(kioskT("pay.cassa")) + '</div>' +
          '<div class="desc">' + escapeHtml(kioskT("pay.cassa_desc")) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

/**
 * Crea l'ordine su Supabase con il payment_method scelto.
 *  - paid=true → status="paid", payment_method="card" (simulato per ora, futuro: integrazione POS)
 *  - paid=false → status="pending", payment_method="pending" (paga in cassa)
 */
async function kioskCreateOrder(paid){
  if (KIOSK.cart.length === 0) return;
  const t = kioskCartTotals();

  const payload = {
    org_id: BRIO.org.id,
    channel: "kiosk",
    status: paid ? "pending" : "pending", // step iniziale sempre pending; se paid, faremo update dopo gli items
    subtotal_cents: t.total,
    total_cents: t.total,
    vat_cents: t.vat,
    payment_method: paid ? "card" : "pending",
    paid_card_cents: paid ? t.total : 0,
  };

  const { data: ord, error: ordErr } = await supa().from("orders").insert(payload).select().single();
  if (ordErr){ err("[kiosk] insert", ordErr); toast("Errore: " + ordErr.message, "error"); return null; }

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
  const { error: itErr } = await supa().from("order_items").insert(items);
  if (itErr){ err("[kiosk] items", itErr); toast("Errore voci ordine", "error"); return null; }

  // Se "Paga qui", marca pagato → trigger DB scarica magazzino + registra transaction.
  // Se il trigger blocca per magazzino insufficiente, cleanup ordine pending + toast.
  if (paid){
    const { error: upErr } = await supa().from("orders").update({ status: "paid" }).eq("id", ord.id);
    if (upErr){
      err("[kiosk] update paid", upErr);
      const msg = (upErr.message || "").toLowerCase();
      if (msg.includes("magazzino insufficiente")){
        await supa().from("order_items").delete().eq("order_id", ord.id);
        await supa().from("orders").delete().eq("id", ord.id);
        toast("Prodotto esaurito: " + upErr.message, "error");
        return null;
      }
    }
    // Registra transaction (registro cassa)
    await supa().from("transactions").insert({
      org_id: BRIO.org.id,
      order_id: ord.id,
      type: "sale",
      amount_cents: t.total,
      method: "card",
    });
    ord.status = "paid";
  }

  return ord;
}

async function kioskPayHere(){
  if (KIOSK.saving) return;
  KIOSK.saving = true;
  toast(kioskT("pay.processing"));
  const ord = await kioskCreateOrder(true);
  KIOSK.saving = false;
  if (!ord) return;
  KIOSK.lastOrder = ord;
  sessionStorage.removeItem(KIOSK_SS_KEY);
  kioskGoto("success");
  kioskStartSuccessCountdown();
}

async function kioskPayCassa(){
  if (KIOSK.saving) return;
  KIOSK.saving = true;
  const ord = await kioskCreateOrder(false);
  KIOSK.saving = false;
  if (!ord) return;
  KIOSK.lastOrder = ord;
  sessionStorage.removeItem(KIOSK_SS_KEY);
  kioskGoto("success");
  kioskStartSuccessCountdown();
}

function kioskStartSuccessCountdown(){
  let cd = 15;
  const tick = setInterval(() => {
    cd--;
    const elTimer = document.getElementById("kioskTimer");
    if (elTimer) elTimer.textContent = cd;
    if (cd <= 0 || KIOSK.step !== "success"){
      clearInterval(tick);
      if (KIOSK.step === "success") kioskReset();
    }
  }, 1000);
}

// =========== Idle / Visibility / Esci ==========
// L'idle resetta dopo 90s di inattività SE c'è qualcosa nel carrello.
// Se il documento è hidden (cliente passa ad altro / app in background), il timer è messo in pausa.
function kioskBumpIdle(){
  clearTimeout(KIOSK.idleTimer);
  if (document.hidden) return;                          // pausa quando tab non attiva
  if (KIOSK.step !== "menu" && KIOSK.step !== "personalize") return;
  // Idle più aggressivo se carrello vuoto (cliente non sta ordinando) → 30s
  // Idle più tollerante se carrello pieno (cliente sta scegliendo) → 90s
  const idleMs = KIOSK.cart.length === 0 ? 30000 : 90000;
  KIOSK.idleTimer = setTimeout(() => {
    log("[kiosk] auto-reset per inattività (" + (idleMs/1000) + "s)");
    KIOSK.cart = [];
    KIOSK.daypartOverride = null;
    sessionStorage.removeItem(KIOSK_SS_KEY);
    kioskGoto("splash");
  }, idleMs);
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

async function kioskCornerTap(){
  KIOSK.exitTaps.push(Date.now());
  KIOSK.exitTaps = KIOSK.exitTaps.filter((t) => Date.now() - t < 1500);
  if (KIOSK.exitTaps.length >= 4){
    KIOSK.exitTaps = [];
    const ok = await brioConfirm({
      title: "Uscire dalla modalità Kiosk?",
      message: "Tornerai alla dashboard amministratore.",
      okLabel: "Esci",
      cancelLabel: "Rimani",
      icon: "🔓",
    });
    if (ok){
      ["click","touchstart","keydown"].forEach((ev) => document.removeEventListener(ev, kioskBumpIdle, true));
      navigate("#/");
    }
  }
}

function noop(){}

/* ============================================================
 * MODULO KDS · schermo retrobanco
 * ============================================================
 * Mostra in tempo reale gli ordini attivi raggruppati per stato:
 *   - Da incassare (kiosk pending): solo visualizzazione, cassa li converte
 *   - In coda (paid): tap "Inizia" → preparing
 *   - In preparazione (preparing): tap "Pronto" → ready (notifica visiva al cliente)
 *   - Pronti (ready): tap "Consegnato" → delivered (sparisce dal KDS)
 * Realtime via Supabase channel su orders.
 * Timer per ogni card con soglie giallo/rosso (>2m/>4m in coda).
 * ============================================================ */
const KDS = {
  orders: [],         // tutti gli ordini attivi della giornata
  knownIds: null,     // Set di ID già visti (null = primo load)
  newArrivals: new Set(), // ID con pulse "nuovo ordine" attivo (3s)
  rtChan: null,
  tickHandle: null,   // setInterval per aggiornare i timer
  autoPrepInFlight: new Set(), // ID in fase di auto-preparing (evita doppia chiamata)
};

async function renderKdsPage(main){
  main.innerHTML =
    '<div class="page-header"><h1>KDS · Cucina</h1><div class="sub muted" id="kdsSub">Caricamento…</div></div>' +
    '<div class="kds-bar" id="kdsBar"></div>' +
    '<div id="kdsBody"></div>';

  await kdsLoadOrders();
  kdsRender();
  kdsSubscribeRealtime();

  // Re-render timer ogni 10s (per aggiornare "X min" e soglie colore)
  if (KDS.tickHandle) clearInterval(KDS.tickHandle);
  KDS.tickHandle = setInterval(() => {
    if (location.hash !== "#/kds"){ clearInterval(KDS.tickHandle); return; }
    kdsRender();
  }, 10000);
}

async function kdsLoadOrders(){
  const orgId = BRIO.org.id;
  // Carica ordini di OGGI in stato attivo (non delivered/cancelled)
  const { data, error } = await supa()
    .from("orders")
    .select("id, daily_number, status, channel, total_cents, payment_method, notes, created_at, prep_started_at, ready_at, order_items(id, qty, product_name, customizations, notes, kds_status)")
    .eq("org_id", orgId)
    .eq("daily_date", localDateStr())
    .in("status", ["pending","paid","preparing","ready"])
    .order("created_at", { ascending: true });
  if (error){ err("[kds]", error); toast("Errore caricamento KDS", "error"); return; }

  const orders = data || [];
  const isFirstLoad = KDS.knownIds === null;
  const currentIds = new Set(orders.map((o) => o.id));

  // Identifica nuovi ordini (presenti ora, non presenti prima)
  // Salta gli "ordini da incassare alla cassa" (pending kiosk) perché non sono cucina
  const newOrders = isFirstLoad ? [] : orders.filter((o) => !KDS.knownIds.has(o.id) && o.status !== "pending");

  KDS.knownIds = currentIds;
  KDS.orders = orders;

  // Alert audio + visual quando arrivano nuovi ordini
  if (newOrders.length > 0){
    newOrders.forEach((o) => KDS.newArrivals.add(o.id));
    kdsAlertNewOrders(newOrders.length);
    // Dopo 3.5s rimuovi le animazioni
    setTimeout(() => {
      newOrders.forEach((o) => KDS.newArrivals.delete(o.id));
      if (location.hash === "#/kds") kdsRender();
    }, 3500);
  }

  // Auto-preparing: ordini in stato 'paid' passano automaticamente a 'preparing'.
  // L'operatrice non deve cliccare "Inizia". Resta solo "Pronto" → "Consegnato".
  const toAutoPrep = orders.filter((o) => o.status === "paid" && !KDS.autoPrepInFlight.has(o.id));
  toAutoPrep.forEach((o) => {
    KDS.autoPrepInFlight.add(o.id);
    supa().from("orders")
      .update({ status: "preparing", prep_started_at: new Date().toISOString() })
      .eq("id", o.id)
      .then(({ error }) => {
        KDS.autoPrepInFlight.delete(o.id);
        if (error) err("[kds] auto-preparing", error);
        // Il realtime ri-triggera kdsLoadOrders + render
      });
  });

  const sub = document.getElementById("kdsSub");
  if (sub) sub.textContent = KDS.orders.length + " ordini attivi · " + dateFmt(new Date());
}

// Beep più squillante (3 toni crescenti) + toast quando arriva un ordine al KDS
function kdsAlertNewOrders(count){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = [880, 1175, 1568]; // A5, D6, G6 (arpeggio in salita)
    freqs.forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.13;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.start(t0);
      o.stop(t0 + 0.25);
    });
  } catch(e){ /* AudioContext può fallire se la pagina non ha mai ricevuto interaction */ }
  toast("🔔 " + (count > 1 ? count + " nuovi ordini" : "Nuovo ordine in cucina"), "success");
}

function kdsRender(){
  const bar = document.getElementById("kdsBar");
  const body = document.getElementById("kdsBody");
  if (!bar || !body) return;

  // Raggruppa: pending (kiosk awaiting pay) | paid/queued | preparing | ready
  const pending = KDS.orders.filter((o) => o.status === "pending" && o.channel === "kiosk");
  const queued  = KDS.orders.filter((o) => o.status === "paid");
  const prep    = KDS.orders.filter((o) => o.status === "preparing");
  const ready   = KDS.orders.filter((o) => o.status === "ready");

  bar.innerHTML =
    (pending.length ? '<div class="kds-stat warn"><span class="num">' + pending.length + '</span> da incassare</div>' : '') +
    '<div class="kds-stat info"><span class="num">' + queued.length + '</span> in coda</div>' +
    '<div class="kds-stat info"><span class="num">' + prep.length + '</span> in preparazione</div>' +
    '<div class="kds-stat success"><span class="num">' + ready.length + '</span> pronti</div>';

  body.innerHTML =
    (pending.length > 0
      ? '<div class="kds-section">' +
          '<h3>🧾 Da incassare alla cassa <span class="badge">' + pending.length + '</span></h3>' +
          '<div class="kds-grid">' + pending.map((o) => kdsCard(o, "pending-pay")).join("") + '</div>' +
        '</div>'
      : '') +
    (queued.length > 0
      ? '<div class="kds-section">' +
          '<h3>⏳ In arrivo <span class="badge">' + queued.length + '</span></h3>' +
          '<div class="kds-grid">' + queued.map((o) => kdsCard(o, "queued")).join("") + '</div>' +
        '</div>'
      : '') +
    '<div class="kds-section">' +
      '<h3>🔥 In preparazione <span class="badge">' + prep.length + '</span></h3>' +
      (prep.length > 0
        ? '<div class="kds-grid">' + prep.map((o) => kdsCard(o, "preparing")).join("") + '</div>'
        : '<div class="kds-empty">Niente in preparazione.</div>'
      ) +
    '</div>' +
    (ready.length > 0
      ? '<div class="kds-section">' +
          '<h3>✅ Pronti per il cliente <span class="badge">' + ready.length + '</span></h3>' +
          '<div class="kds-grid">' + ready.map((o) => kdsCard(o, "ready")).join("") + '</div>' +
        '</div>'
      : '');
}

function kdsCard(order, kind){
  // Calcola elapsed
  const startRef = (kind === "preparing" && order.prep_started_at) ? order.prep_started_at
                 : (kind === "ready" && order.ready_at) ? order.ready_at
                 : order.created_at;
  const elapsedSec = Math.floor((Date.now() - new Date(startRef).getTime()) / 1000);
  const elapsed = elapsedSec < 60 ? elapsedSec + "s"
                : elapsedSec < 3600 ? Math.floor(elapsedSec/60) + "m " + (elapsedSec%60) + "s"
                : Math.floor(elapsedSec/3600) + "h " + Math.floor((elapsedSec%3600)/60) + "m";

  // Soglia colore solo per "queued"
  let warnClass = "";
  if (kind === "queued"){
    if (elapsedSec > 240) warnClass = " danger";
    else if (elapsedSec > 120) warnClass = " warn";
  }

  const channelLabel = ({cassa:"🛒 Cassa", kiosk:"📱 Kiosk", menu_qr:"📲 QR", ahead:"⏱ Anticipo"})[order.channel] || order.channel;
  const items = (order.order_items || []).map((it) => {
    const customs = Array.isArray(it.customizations) && it.customizations.length > 0
      ? '<span class="custom">— ' + it.customizations.map((c) => escapeHtml(c.label)).join(" · ") + '</span>'
      : '';
    const noteRow = it.notes ? '<span class="custom">— ' + escapeHtml(it.notes) + '</span>' : '';
    return '<li><span class="qty-badge">' + it.qty + '×</span>' + escapeHtml(it.product_name) + customs + noteRow + '</li>';
  }).join("");

  const note = order.notes ? '<div class="note">📝 ' + escapeHtml(order.notes) + '</div>' : '';

  let action = '';
  if (kind === "queued"){
    action = '<button class="act" data-action="kdsStartPrep" data-args=\'["' + order.id + '"]\'>▶ Inizia</button>';
  } else if (kind === "preparing"){
    action = '<button class="act" data-action="kdsMarkReady" data-args=\'["' + order.id + '"]\'>✓ Pronto</button>';
  } else if (kind === "ready"){
    action = '<button class="act" data-action="kdsMarkDelivered" data-args=\'["' + order.id + '"]\'>📦 Consegnato</button>';
  } else if (kind === "pending-pay"){
    action = '<div class="info-msg">Pagamento in cassa</div>';
  }

  const newCls = KDS.newArrivals.has(order.id) ? " new-arrival" : "";

  return (
    '<div class="kds-card ' + kind + warnClass + newCls + '">' +
      '<div class="top">' +
        '<div class="num">#' + order.daily_number + '</div>' +
        '<div class="ch">' + channelLabel + '</div>' +
      '</div>' +
      '<ul class="items">' + items + '</ul>' +
      note +
      '<div class="foot">' +
        '<div class="timer">⏱ ' + elapsed + '</div>' +
        (kind === "pending-pay" ? '<div class="timer">€ ' + (Number(order.total_cents)/100).toFixed(2).replace(".",",") + '</div>' : action) +
      '</div>' +
    '</div>'
  );
}

async function kdsStartPrep(orderId){
  const { error } = await supa().from("orders").update({ status: "preparing", prep_started_at: new Date().toISOString() }).eq("id", orderId);
  if (error){ toast("Errore: " + error.message, "error"); return; }
  await kdsLoadOrders();
  kdsRender();
}
async function kdsMarkReady(orderId){
  const { error } = await supa().from("orders").update({ status: "ready", ready_at: new Date().toISOString() }).eq("id", orderId);
  if (error){ toast("Errore: " + error.message, "error"); return; }
  await kdsLoadOrders();
  kdsRender();
  // Audio beep (browser semplice via Web Audio)
  kdsBeep();
}
async function kdsMarkDelivered(orderId){
  const { error } = await supa().from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
  if (error){ toast("Errore: " + error.message, "error"); return; }
  await kdsLoadOrders();
  kdsRender();
}

function kdsBeep(){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch(e){ /* ignore */ }
}

function kdsSubscribeRealtime(){
  if (KDS.rtChan) supa().removeChannel(KDS.rtChan);
  KDS.rtChan = supa().channel("kds-" + BRIO.org.id)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: "org_id=eq." + BRIO.org.id },
      async () => { await kdsLoadOrders(); kdsRender(); })
    .on("postgres_changes",
      { event: "*", schema: "public", table: "order_items" },
      async () => { await kdsLoadOrders(); kdsRender(); })
    .subscribe();
}

/* ============================================================
 * MODULO MENU ADMIN · CRUD prodotti, categorie, ricette
 * ============================================================
 * Permette di:
 *  - Creare/modificare/eliminare prodotti del menu
 *  - Gestire categorie
 *  - Definire la ricetta (ingredienti + quantità) per ogni prodotto
 *  - Definire customizations (toggle/extra con prezzo)
 *  - Vedere food cost % calcolato dalla ricetta
 * ============================================================ */
const MA = {
  tab: "prodotti",      // prodotti | categorie
  categories: [],
  products: [],
  ingredients: [],
  search: "",
  catFilter: "",
  detailProduct: null,
  draftCustoms: [],
  draftRecipe: [],
  draftCatDetail: null,
};

async function renderMenuAdminPage(main){
  main.innerHTML =
    '<div class="page-header"><h1>Menu</h1><div class="sub muted" id="maSub">Caricamento…</div></div>' +
    '<div class="ma-tabs">' +
      '<button class="ma-tab" data-action="maSwitch" data-args=\'["prodotti"]\'>Prodotti</button>' +
      '<button class="ma-tab" data-action="maSwitch" data-args=\'["categorie"]\'>Categorie</button>' +
    '</div>' +
    '<div id="maBody"></div>';

  await maLoadAll();
  maRender();
}

async function maLoadAll(){
  const orgId = BRIO.org.id;
  const [catRes, prodRes, ingRes] = await Promise.all([
    supa().from("categories").select("*").eq("org_id", orgId).order("sort_order"),
    supa().from("products").select("*, recipes(id, qty, ingredient:ingredients(id, name, unit, cost_per_unit_cents))").eq("org_id", orgId).order("sort_order"),
    supa().from("ingredients").select("id, name, unit, cost_per_unit_cents").eq("org_id", orgId).eq("active", true).order("name"),
  ]);
  if (catRes.error){ err("[menu-admin]", catRes.error); toast("Errore caricamento", "error"); return; }
  MA.categories = catRes.data || [];
  MA.products = prodRes.data || [];
  MA.ingredients = ingRes.data || [];
  const sub = document.getElementById("maSub");
  if (sub) sub.textContent = MA.products.length + " prodotti · " + MA.categories.length + " categorie · " + MA.ingredients.length + " ingredienti";
}

function maSwitch(tab){
  MA.tab = tab;
  maRender();
}

function maRender(){
  // Aggiorna stato attivo dei tab
  $$(".ma-tab").forEach((b) => {
    const args = b.getAttribute("data-args");
    const isActive = args && args.indexOf('"' + MA.tab + '"') >= 0;
    b.classList.toggle("active", !!isActive);
  });

  const body = document.getElementById("maBody");
  if (!body) return;
  body.innerHTML = MA.tab === "prodotti" ? maRenderProducts() : maRenderCategories();
}

// ===== PRODOTTI =====
function maRenderProducts(){
  const q = MA.search.toLowerCase();
  const filtered = MA.products.filter((p) => {
    if (MA.catFilter && p.category_id !== MA.catFilter) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const catOptions = '<option value="">Tutte le categorie</option>' +
    MA.categories.map((c) => '<option value="' + c.id + '"' + (MA.catFilter === c.id ? " selected" : "") + '>' + escapeHtml(c.name) + '</option>').join("");

  const rows = filtered.map((p) => {
    const cat = MA.categories.find((c) => c.id === p.category_id);
    const fc = productFoodCost(p);
    const fcCls = fc.percent <= 30 ? "ok" : fc.percent <= 35 ? "warn" : "danger";
    return '<tr data-action="maOpenProduct" data-args=\'["' + p.id + '"]\'>' +
      '<td class="ico">' + maProductIcon(p) + '</td>' +
      '<td><div class="name">' + escapeHtml(p.name) + '</div><div class="sub">' + escapeHtml(p.sku || "") + (p.shortcut_key ? ' · ⌨ ' + escapeHtml(p.shortcut_key) : '') + '</div></td>' +
      '<td>' + escapeHtml(cat ? cat.name : "—") + '</td>' +
      '<td class="price">' + euroFmt(p.price_cents) + '<div class="vat">IVA ' + numFmt(p.vat_rate, 0) + '%</div></td>' +
      '<td class="fc ' + fcCls + '">' + (fc.percent !== null ? numFmt(fc.percent, 1) + '%' : '—') + '<div class="sub">' + (fc.cost !== null ? euroFmt(fc.cost) : '') + '</div></td>' +
      '<td><span class="status-chip ' + p.status + '">' + maStatusLabel(p.status) + '</span></td>' +
    '</tr>';
  }).join("");

  return (
    '<div class="ma-toolbar">' +
      '<input class="input" placeholder="Cerca prodotto…" value="' + escapeHtml(MA.search) + '" oninput="maOnSearch(this.value)" />' +
      '<select class="select" onchange="maOnCatFilter(this.value)">' + catOptions + '</select>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-action="maNewProduct">+ Nuovo prodotto</button>' +
    '</div>' +
    '<div class="ma-table">' +
      (filtered.length === 0
        ? '<div class="muted text-center" style="padding:32px">Nessun prodotto trovato.</div>'
        : '<table>' +
            '<thead><tr><th></th><th>Prodotto</th><th>Categoria</th><th>Prezzo</th><th>Food cost</th><th>Stato</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>'
      ) +
    '</div>'
  );
}

function maOnSearch(v){ MA.search = v || ""; maRender(); }
function maOnCatFilter(v){ MA.catFilter = v || ""; maRender(); }

function maStatusLabel(s){
  return s === "available" ? "Attivo" : s === "out_of_stock" ? "Esaurito" : s === "limited" ? "Limitato" : s === "hidden" ? "Nascosto" : s;
}

function maProductIcon(p){
  // Reusa logica del kiosk per coerenza
  if (typeof kioskProductEmoji === "function") return kioskProductEmoji(p);
  return "🍽";
}

// Calcola food cost di un prodotto dalla ricetta
function productFoodCost(p){
  if (!p.recipes || p.recipes.length === 0) return { cost: null, percent: null };
  let cost = 0;
  for (const r of p.recipes){
    if (!r.ingredient) continue;
    cost += Number(r.qty) * Number(r.ingredient.cost_per_unit_cents);
  }
  const price = Number(p.price_cents) || 0;
  const percent = price > 0 ? (cost / price) * 100 : 0;
  return { cost: Math.round(cost), percent };
}

// ===== MODAL DETTAGLIO PRODOTTO =====
function maNewProduct(){
  MA.detailProduct = {
    _new: true,
    name: "",
    description: "",
    category_id: MA.categories.length > 0 ? MA.categories[0].id : "",
    price_cents: 0,
    vat_rate: 10,
    image_url: "",
    sku: "",
    status: "available",
    shortcut_key: "",
    tags: [],
    customizations: [],
  };
  MA.draftCustoms = [];
  MA.draftRecipe = [];
  maShowDetailModal();
}

function maOpenProduct(productId){
  const p = MA.products.find((x) => x.id === productId);
  if (!p) return;
  MA.detailProduct = Object.assign({}, p);
  MA.draftCustoms = Array.isArray(p.customizations) ? JSON.parse(JSON.stringify(p.customizations)) : [];
  MA.draftRecipe = Array.isArray(p.recipes)
    ? p.recipes.filter((r) => r.ingredient).map((r) => ({
        id: r.id,
        ingredient_id: r.ingredient.id,
        ingredient_name: r.ingredient.name,
        unit: r.ingredient.unit,
        cost_per_unit_cents: r.ingredient.cost_per_unit_cents,
        qty: Number(r.qty),
      }))
    : [];
  maShowDetailModal();
}

function maShowDetailModal(){
  const p = MA.detailProduct;
  if (!p) return;
  const isNew = !!p._new;

  const catOpts = MA.categories.map((c) => '<option value="' + c.id + '"' + (c.id === p.category_id ? " selected" : "") + '>' + escapeHtml(c.name) + '</option>').join("");

  const customRows = MA.draftCustoms.map((c, i) => (
    '<div class="cust-row">' +
      '<input type="text" placeholder="Etichetta" value="' + escapeHtml(c.label || "") + '" oninput="maCustEdit(' + i + ',\'label\',this.value)" />' +
      '<select onchange="maCustEdit(' + i + ',\'type\',this.value)">' +
        '<option value="toggle"' + (c.type === "toggle" ? " selected" : "") + '>Toggle</option>' +
        '<option value="extra"' + (c.type === "extra" ? " selected" : "") + '>Extra</option>' +
      '</select>' +
      '<input type="number" step="0.01" min="0" placeholder="0,00" value="' + (c.price_delta_cents ? (Number(c.price_delta_cents)/100).toFixed(2) : "") + '" oninput="maCustEdit(' + i + ',\'price_delta_cents\',this.value)" />' +
      '<button class="x" data-action="maCustRemove" data-args="[' + i + ']" title="Rimuovi">×</button>' +
    '</div>'
  )).join("");

  const recipeRows = MA.draftRecipe.map((r, i) => (
    '<div class="rec-row">' +
      '<select onchange="maRecipeEdit(' + i + ',\'ingredient_id\',this.value)">' +
        MA.ingredients.map((ing) => '<option value="' + ing.id + '"' + (ing.id === r.ingredient_id ? " selected" : "") + '>' + escapeHtml(ing.name) + '</option>').join("") +
      '</select>' +
      '<input type="number" step="0.01" min="0" placeholder="Qty" value="' + r.qty + '" oninput="maRecipeEdit(' + i + ',\'qty\',this.value)" />' +
      '<div class="unit">' + escapeHtml(r.unit || "") + '</div>' +
      '<button class="x" data-action="maRecipeRemove" data-args="[' + i + ']" title="Rimuovi">×</button>' +
    '</div>'
  )).join("");

  // Calcola food cost dalla ricetta draft
  let draftCost = 0;
  MA.draftRecipe.forEach((r) => {
    const ing = MA.ingredients.find((x) => x.id === r.ingredient_id);
    if (ing) draftCost += Number(r.qty) * Number(ing.cost_per_unit_cents);
  });
  const draftPrice = Number(p.price_cents) || 0;
  const draftFcPercent = draftPrice > 0 ? (draftCost / draftPrice) * 100 : 0;
  const fcCls = draftFcPercent <= 30 ? "ok" : draftFcPercent <= 35 ? "warn" : "danger";

  document.body.insertAdjacentHTML("beforeend",
    '<div class="modal-backdrop ma-detail" id="maDetailModal" onclick="if(event.target===this) maCloseDetail()">' +
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<h2>' + (isNew ? "Nuovo prodotto" : escapeHtml(p.name)) + '</h2>' +
          '<button class="modal-close" data-action="maCloseDetail">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="grid2">' +
            '<label class="field"><span class="label">Nome *</span>' +
              '<input id="maName" class="input" value="' + escapeHtml(p.name) + '" />' +
            '</label>' +
            '<label class="field"><span class="label">SKU</span>' +
              '<input id="maSku" class="input" value="' + escapeHtml(p.sku || "") + '" placeholder="CAF-001" />' +
            '</label>' +
          '</div>' +
          '<label class="field"><span class="label">Descrizione</span>' +
            '<input id="maDesc" class="input" value="' + escapeHtml(p.description || "") + '" />' +
          '</label>' +
          '<div class="grid3">' +
            '<label class="field"><span class="label">Categoria *</span>' +
              '<select id="maCat" class="select">' + catOpts + '</select>' +
            '</label>' +
            '<label class="field"><span class="label">Prezzo (€) *</span>' +
              '<input id="maPrice" class="input" type="number" step="0.01" min="0" value="' + (Number(p.price_cents)/100).toFixed(2) + '" />' +
            '</label>' +
            '<label class="field"><span class="label">IVA (%)</span>' +
              '<select id="maVat" class="select">' +
                '<option value="10"' + (Number(p.vat_rate) === 10 ? " selected" : "") + '>10%</option>' +
                '<option value="22"' + (Number(p.vat_rate) === 22 ? " selected" : "") + '>22%</option>' +
                '<option value="4"' + (Number(p.vat_rate) === 4 ? " selected" : "") + '>4%</option>' +
                '<option value="0"' + (Number(p.vat_rate) === 0 ? " selected" : "") + '>0% (esente)</option>' +
              '</select>' +
            '</label>' +
          '</div>' +
          '<div class="grid3">' +
            '<label class="field"><span class="label">Stato</span>' +
              '<select id="maStatus" class="select">' +
                '<option value="available"' + (p.status === "available" ? " selected" : "") + '>Attivo</option>' +
                '<option value="out_of_stock"' + (p.status === "out_of_stock" ? " selected" : "") + '>Esaurito</option>' +
                '<option value="limited"' + (p.status === "limited" ? " selected" : "") + '>Limitato</option>' +
                '<option value="hidden"' + (p.status === "hidden" ? " selected" : "") + '>Nascosto</option>' +
              '</select>' +
            '</label>' +
            '<label class="field"><span class="label">Scorciatoia</span>' +
              '<input id="maShort" class="input" value="' + escapeHtml(p.shortcut_key || "") + '" placeholder="es. F1" />' +
            '</label>' +
            '<label class="field"><span class="label">Foto URL</span>' +
              '<input id="maImg" class="input" value="' + escapeHtml(p.image_url || "") + '" placeholder="https://…" />' +
            '</label>' +
          '</div>' +

          // CUSTOMIZATIONS
          '<div class="section">' +
            '<div class="h4">Personalizzazioni</div>' +
            (MA.draftCustoms.length > 0 ? '<div class="muted" style="font-size:11px;margin-bottom:6px">Etichetta · Tipo · Maggiorazione (€)</div>' : '') +
            '<div class="cust-list">' + customRows + '</div>' +
            '<button class="add-row-btn" data-action="maCustAdd">+ Aggiungi opzione</button>' +
          '</div>' +

          // RICETTA
          '<div class="section">' +
            '<div class="h4">Ricetta (ingredienti → magazzino)</div>' +
            (MA.draftRecipe.length > 0 ? '<div class="muted" style="font-size:11px;margin-bottom:6px">Ingrediente · Quantità · Unità</div>' : '') +
            '<div class="rec-list">' + recipeRows + '</div>' +
            (MA.ingredients.length > 0
              ? '<button class="add-row-btn" data-action="maRecipeAdd">+ Aggiungi ingrediente</button>'
              : '<div class="muted" style="font-size:12px">Nessun ingrediente in anagrafica.</div>'
            ) +
            '<div class="cost-summary">' +
              '<div class="row"><span>Costo materie prime</span><span>' + euroFmt(Math.round(draftCost)) + '</span></div>' +
              '<div class="row"><span>Prezzo di vendita</span><span>' + euroFmt(draftPrice) + '</span></div>' +
              '<div class="row total fc ' + fcCls + '"><span>Food cost %</span><span>' + (draftPrice > 0 ? numFmt(draftFcPercent, 1) + '%' : '—') + '</span></div>' +
            '</div>' +
          '</div>' +

        '</div>' +
        '<div class="modal-foot">' +
          (isNew ? '' : '<button class="btn btn-danger" data-action="maDeleteProduct">Elimina</button>') +
          '<button class="btn" data-action="maCloseDetail">Annulla</button>' +
          '<button class="btn btn-primary" data-action="maSaveProduct">' + (isNew ? "Crea prodotto" : "Salva modifiche") + '</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function maCloseDetail(){
  MA.detailProduct = null;
  MA.draftCustoms = [];
  MA.draftRecipe = [];
  const m = document.getElementById("maDetailModal");
  if (m) m.remove();
}

function maCustAdd(){
  MA.draftCustoms.push({ label: "", type: "toggle", price_delta_cents: 0 });
  maRefreshDetailModal();
}
function maCustRemove(idx){ MA.draftCustoms.splice(idx, 1); maRefreshDetailModal(); }
function maCustEdit(idx, field, value){
  if (!MA.draftCustoms[idx]) return;
  if (field === "price_delta_cents"){
    MA.draftCustoms[idx].price_delta_cents = Math.round((parseFloat((value || "0").replace(",", ".")) || 0) * 100);
  } else {
    MA.draftCustoms[idx][field] = value;
  }
  // niente refresh, è inline (l'input ha già il valore)
}

function maRecipeAdd(){
  if (MA.ingredients.length === 0) return;
  MA.draftRecipe.push({
    ingredient_id: MA.ingredients[0].id,
    ingredient_name: MA.ingredients[0].name,
    unit: MA.ingredients[0].unit,
    cost_per_unit_cents: MA.ingredients[0].cost_per_unit_cents,
    qty: 0,
  });
  maRefreshDetailModal();
}
function maRecipeRemove(idx){ MA.draftRecipe.splice(idx, 1); maRefreshDetailModal(); }
function maRecipeEdit(idx, field, value){
  if (!MA.draftRecipe[idx]) return;
  if (field === "ingredient_id"){
    const ing = MA.ingredients.find((x) => x.id === value);
    if (ing){
      MA.draftRecipe[idx].ingredient_id = ing.id;
      MA.draftRecipe[idx].ingredient_name = ing.name;
      MA.draftRecipe[idx].unit = ing.unit;
      MA.draftRecipe[idx].cost_per_unit_cents = ing.cost_per_unit_cents;
      maRefreshDetailModal();
    }
  } else if (field === "qty"){
    MA.draftRecipe[idx].qty = parseFloat((value || "0").replace(",", ".")) || 0;
    maRefreshDetailModal();
  }
}

function maRefreshDetailModal(){
  // Cattura i valori del form prima del re-render così l'utente non li perde
  const p = MA.detailProduct;
  if (!p) return;
  const f = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  const nm = f("maName"); if (nm !== null) p.name = nm;
  const sku = f("maSku"); if (sku !== null) p.sku = sku;
  const desc = f("maDesc"); if (desc !== null) p.description = desc;
  const cat = f("maCat"); if (cat !== null) p.category_id = cat;
  const price = f("maPrice"); if (price !== null) p.price_cents = Math.round((parseFloat((price || "0").replace(",", ".")) || 0) * 100);
  const vat = f("maVat"); if (vat !== null) p.vat_rate = Number(vat);
  const status = f("maStatus"); if (status !== null) p.status = status;
  const short = f("maShort"); if (short !== null) p.shortcut_key = short;
  const img = f("maImg"); if (img !== null) p.image_url = img;

  const m = document.getElementById("maDetailModal");
  if (m) m.remove();
  maShowDetailModal();
}

async function maSaveProduct(){
  const p = MA.detailProduct;
  if (!p) return;
  maRefreshDetailModal();   // assicura valori aggiornati nello state
  // re-grab da MA.detailProduct dopo refresh
  const cur = MA.detailProduct;

  if (!cur.name){ toast("Nome obbligatorio", "error"); return; }
  if (!cur.category_id){ toast("Categoria obbligatoria", "error"); return; }

  const payload = {
    name: cur.name,
    description: cur.description || null,
    category_id: cur.category_id,
    price_cents: cur.price_cents || 0,
    vat_rate: cur.vat_rate || 10,
    image_url: cur.image_url || null,
    sku: cur.sku || null,
    status: cur.status || "available",
    shortcut_key: cur.shortcut_key || null,
    customizations: MA.draftCustoms.filter((c) => c.label),
  };

  let prodId = cur.id;
  if (cur._new){
    payload.org_id = BRIO.org.id;
    const { data, error } = await supa().from("products").insert(payload).select().single();
    if (error){ err("[ma] insert", error); toast("Errore: " + error.message, "error"); return; }
    prodId = data.id;
  } else {
    const { error } = await supa().from("products").update(payload).eq("id", cur.id);
    if (error){ err("[ma] update", error); toast("Errore: " + error.message, "error"); return; }
  }

  // Aggiorna ricetta: cancella le righe esistenti del prodotto, reinserisci
  await supa().from("recipes").delete().eq("product_id", prodId);
  const recipes = MA.draftRecipe.filter((r) => r.ingredient_id && r.qty > 0).map((r) => ({
    org_id: BRIO.org.id,
    product_id: prodId,
    ingredient_id: r.ingredient_id,
    qty: r.qty,
  }));
  if (recipes.length > 0){
    const { error } = await supa().from("recipes").insert(recipes);
    if (error){ err("[ma] recipes", error); toast("Errore ricetta: " + error.message, "error"); return; }
  }

  toast(cur._new ? "Prodotto creato" : "Prodotto aggiornato", "success");
  maCloseDetail();
  await maLoadAll();
  maRender();
}

async function maDeleteProduct(){
  const p = MA.detailProduct;
  if (!p || p._new) return;
  const ok = await brioConfirm({
    title: "Eliminare il prodotto?",
    message: "Verrà rimosso anche dal menu e dalle ricette. Gli ordini storici restano intatti.",
    okLabel: "Elimina",
    danger: true,
    icon: "🗑️",
  });
  if (!ok) return;
  await supa().from("recipes").delete().eq("product_id", p.id);
  const { error } = await supa().from("products").delete().eq("id", p.id);
  if (error){ toast("Errore: " + error.message, "error"); return; }
  toast("Prodotto eliminato", "success");
  maCloseDetail();
  await maLoadAll();
  maRender();
}

// ===== CATEGORIE =====
function maRenderCategories(){
  const rows = MA.categories.map((c) => {
    const count = MA.products.filter((p) => p.category_id === c.id).length;
    return '<tr data-action="maOpenCategory" data-args=\'["' + c.id + '"]\'>' +
      '<td class="ico">' + escapeHtml(c.icon || "🍽") + '</td>' +
      '<td><div class="name">' + escapeHtml(c.name) + '</div><div class="sub">/' + escapeHtml(c.slug) + '</div></td>' +
      '<td class="sub">' + count + ' prodotti</td>' +
      '<td class="sub">' + numFmt(c.sort_order, 0) + '</td>' +
      '<td><span class="status-chip ' + (c.visible ? "available" : "hidden") + '">' + (c.visible ? "Visibile" : "Nascosta") + '</span></td>' +
    '</tr>';
  }).join("");

  return (
    '<div class="ma-toolbar">' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-action="maNewCategory">+ Nuova categoria</button>' +
    '</div>' +
    '<div class="ma-table">' +
      (MA.categories.length === 0
        ? '<div class="muted text-center" style="padding:32px">Nessuna categoria.</div>'
        : '<table>' +
            '<thead><tr><th></th><th>Categoria</th><th>Prodotti</th><th>Ordine</th><th>Stato</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>'
      ) +
    '</div>'
  );
}

function maNewCategory(){
  MA.draftCatDetail = { _new: true, name: "", slug: "", icon: "🍽", color: "#10B981", sort_order: 100, visible: true };
  maShowCategoryModal();
}
function maOpenCategory(catId){
  const c = MA.categories.find((x) => x.id === catId);
  if (!c) return;
  MA.draftCatDetail = Object.assign({}, c);
  maShowCategoryModal();
}
function maShowCategoryModal(){
  const c = MA.draftCatDetail;
  if (!c) return;
  const isNew = !!c._new;
  document.body.insertAdjacentHTML("beforeend",
    '<div class="modal-backdrop" id="maCatModal" onclick="if(event.target===this) maCloseCategory()">' +
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<h2>' + (isNew ? "Nuova categoria" : escapeHtml(c.name)) + '</h2>' +
          '<button class="modal-close" data-action="maCloseCategory">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="grid2">' +
            '<label class="field"><span class="label">Nome *</span><input id="maCatName" class="input" value="' + escapeHtml(c.name) + '" /></label>' +
            '<label class="field"><span class="label">Slug *</span><input id="maCatSlug" class="input" value="' + escapeHtml(c.slug) + '" placeholder="caffetteria" /></label>' +
          '</div>' +
          '<div class="grid3">' +
            '<label class="field"><span class="label">Icona emoji</span><input id="maCatIcon" class="input" value="' + escapeHtml(c.icon || "") + '" placeholder="☕" /></label>' +
            '<label class="field"><span class="label">Colore</span><input id="maCatColor" class="input" value="' + escapeHtml(c.color || "#10B981") + '" placeholder="#10B981" /></label>' +
            '<label class="field"><span class="label">Ordine</span><input id="maCatOrder" class="input" type="number" value="' + (c.sort_order || 0) + '" /></label>' +
          '</div>' +
          '<label class="field"><span class="label">Visibile</span>' +
            '<select id="maCatVis" class="select">' +
              '<option value="1"' + (c.visible ? " selected" : "") + '>Sì, visibile</option>' +
              '<option value="0"' + (!c.visible ? " selected" : "") + '>No, nascosta</option>' +
            '</select>' +
          '</label>' +
        '</div>' +
        '<div class="modal-foot">' +
          (isNew ? '' : '<button class="btn btn-danger" data-action="maDeleteCategory">Elimina</button>') +
          '<button class="btn" data-action="maCloseCategory">Annulla</button>' +
          '<button class="btn btn-primary" data-action="maSaveCategory">' + (isNew ? "Crea" : "Salva") + '</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}
function maCloseCategory(){
  MA.draftCatDetail = null;
  const m = document.getElementById("maCatModal");
  if (m) m.remove();
}

async function maSaveCategory(){
  const c = MA.draftCatDetail;
  if (!c) return;
  const f = (id) => document.getElementById(id);
  const name = f("maCatName").value.trim();
  const slug = (f("maCatSlug").value.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g,"-")).replace(/^-|-$/g,"");
  if (!name || !slug){ toast("Nome e slug obbligatori", "error"); return; }
  const payload = {
    name, slug,
    icon: f("maCatIcon").value || null,
    color: f("maCatColor").value || null,
    sort_order: parseInt(f("maCatOrder").value, 10) || 0,
    visible: f("maCatVis").value === "1",
  };
  if (c._new){
    payload.org_id = BRIO.org.id;
    const { error } = await supa().from("categories").insert(payload);
    if (error){ toast("Errore: " + error.message, "error"); return; }
  } else {
    const { error } = await supa().from("categories").update(payload).eq("id", c.id);
    if (error){ toast("Errore: " + error.message, "error"); return; }
  }
  toast(c._new ? "Categoria creata" : "Categoria aggiornata", "success");
  maCloseCategory();
  await maLoadAll();
  maRender();
}

async function maDeleteCategory(){
  const c = MA.draftCatDetail;
  if (!c || c._new) return;
  const count = MA.products.filter((p) => p.category_id === c.id).length;
  if (count > 0){
    await brioAlert({
      title: "Categoria in uso",
      message: "Questa categoria contiene " + count + " prodotti. Spostali in un'altra categoria prima di eliminarla.",
      kind: "warning",
    });
    return;
  }
  const ok = await brioConfirm({
    title: "Eliminare la categoria?",
    okLabel: "Elimina",
    danger: true,
  });
  if (!ok) return;
  const { error } = await supa().from("categories").delete().eq("id", c.id);
  if (error){ toast("Errore: " + error.message, "error"); return; }
  toast("Categoria eliminata", "success");
  maCloseCategory();
  await maLoadAll();
  maRender();
}

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
    const ok = await brioConfirm({
      title: "Quantità superiore alla giacenza",
      message: "Stai registrando uno spreco di " + numFmt(qty,0) + " " + ing.unit + " ma in magazzino ne risultano solo " + numFmt(ing.stock_qty,0) + ". La giacenza scenderà a 0.",
      okLabel: "Continua",
      danger: true,
      icon: "⚠️",
    });
    if (!ok) return;
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

// ============================================================
// DASHBOARD GIORNALIERA · KPI vendite, food cost, allarmi
// ============================================================
const DASH = {
  loading: false,
  today: null,         // riga daily_revenue di oggi
  yesterday: null,     // riga daily_revenue di ieri
  weekAvg: 0,          // media giornaliera ultimi 7 giorni
  cogsToday: 0,        // costo materie prime oggi (centesimi)
  cogsMonth: 0,        // food cost % mese corrente
  revenueMonth: 0,
  topProducts: [],
  hourly: [],          // [{hour,orders_count,revenue_cents}, ...]
  last30: [],          // [{day,revenue_cents,orders_count}, ...]
  lowStock: [],        // ingredienti sotto soglia minima
  refreshTimer: null,
};

async function renderDashboardPage(main){
  main.innerHTML =
    '<div class="page-header">' +
      '<div><h1>Dashboard</h1><div class="sub" id="dashSub">' + dateFmt(new Date()) + '</div></div>' +
      '<div class="page-actions"><button class="btn" data-action="dashRefresh">⟲ Aggiorna</button></div>' +
    '</div>' +
    '<div id="dashBody"><div class="muted" style="padding:24px">Carico dati…</div></div>';
  await dashLoad();
  dashRender();
  // Auto-refresh ogni 60s mentre la pagina è aperta
  if (DASH.refreshTimer) clearInterval(DASH.refreshTimer);
  DASH.refreshTimer = setInterval(() => {
    if (location.hash === "#/dashboard") dashLoad().then(dashRender);
    else { clearInterval(DASH.refreshTimer); DASH.refreshTimer = null; }
  }, 60000);
}

async function dashRefresh(){
  await dashLoad();
  dashRender();
  toast("Dashboard aggiornata", "success");
}

async function dashLoad(){
  if (!BRIO.org) return;
  DASH.loading = true;
  const orgId = BRIO.org.id;
  const today = new Date();
  const todayStr = localDateStr(today);
  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayStr = localDateStr(yesterday);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const weekAgoStr = localDateStr(weekAgo);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = localDateStr(monthStart);

  try {
    const [
      revTodayRes,
      revYestRes,
      revWeekRes,
      cogsTodayRes,
      cogsMonthRes,
      revMonthRes,
      topRes,
      hourRes,
      last30Res,
      lowStockRes,
    ] = await Promise.all([
      supa().from("daily_revenue").select("*").eq("org_id", orgId).eq("daily_date", todayStr).maybeSingle(),
      supa().from("daily_revenue").select("*").eq("org_id", orgId).eq("daily_date", yesterdayStr).maybeSingle(),
      supa().from("daily_revenue").select("revenue_cents,orders_count").eq("org_id", orgId).gte("daily_date", weekAgoStr).lt("daily_date", todayStr),
      supa().from("daily_cogs").select("cogs_cents").eq("org_id", orgId).eq("cogs_date", todayStr).maybeSingle(),
      supa().from("daily_cogs").select("cogs_cents").eq("org_id", orgId).gte("cogs_date", monthStartStr),
      supa().from("daily_revenue").select("revenue_cents").eq("org_id", orgId).gte("daily_date", monthStartStr),
      supa().rpc("top_products_window", { p_org_id: orgId, p_days: 7, p_limit: 10 }),
      supa().rpc("hourly_revenue_today", { p_org_id: orgId }),
      supa().rpc("revenue_last_30days", { p_org_id: orgId }),
      supa().from("ingredients").select("id,name,unit,stock_qty,min_stock_qty,critical_stock_qty").eq("org_id", orgId).eq("active", true).order("name"),
    ]);

    DASH.today = revTodayRes.data || { revenue_cents: 0, orders_count: 0, avg_ticket_cents: 0 };
    DASH.yesterday = revYestRes.data || null;

    const weekRows = revWeekRes.data || [];
    const weekTot = weekRows.reduce((a, r) => a + Number(r.revenue_cents || 0), 0);
    DASH.weekAvg = weekRows.length > 0 ? Math.round(weekTot / weekRows.length) : 0;

    DASH.cogsToday = Number(cogsTodayRes.data ? cogsTodayRes.data.cogs_cents : 0);
    DASH.cogsMonth = (cogsMonthRes.data || []).reduce((a, r) => a + Number(r.cogs_cents || 0), 0);
    DASH.revenueMonth = (revMonthRes.data || []).reduce((a, r) => a + Number(r.revenue_cents || 0), 0);

    DASH.topProducts = topRes.data || [];
    DASH.hourly = hourRes.data || [];
    DASH.last30 = last30Res.data || [];

    const allIng = lowStockRes.data || [];
    DASH.lowStock = allIng.filter((i) => Number(i.stock_qty) <= Number(i.min_stock_qty));
  } catch (e){
    err("[dashboard] load", e);
    toast("Errore caricamento dashboard: " + (e.message || e), "error");
  }
  DASH.loading = false;
}

function dashRender(){
  const body = document.getElementById("dashBody");
  if (!body) return;
  const t = DASH.today || {};
  const y = DASH.yesterday;
  const revToday = Number(t.revenue_cents || 0);
  const orders = Number(t.orders_count || 0);
  const avgTicket = Number(t.avg_ticket_cents || 0);

  // Margine stimato = revenue - cogs (approssimazione semplice)
  const marginToday = revToday - DASH.cogsToday;
  // Food cost % oggi
  const foodCostPctToday = revToday > 0 ? (DASH.cogsToday / revToday) * 100 : 0;
  // Food cost % mese
  const foodCostPctMonth = DASH.revenueMonth > 0 ? (DASH.cogsMonth / DASH.revenueMonth) * 100 : 0;

  // Confronti
  const diffYesterday = y ? revToday - Number(y.revenue_cents || 0) : null;
  const diffWeekAvg = revToday - DASH.weekAvg;

  body.innerHTML =
    dashKpiBlock(revToday, orders, avgTicket, marginToday, foodCostPctToday, diffYesterday, diffWeekAvg, foodCostPctMonth) +
    dashAlarmsBlock() +
    '<div class="dash-grid">' +
      dashChart30Block() +
      dashHourlyBlock() +
    '</div>' +
    dashTopProductsBlock();
}

function dashKpiBlock(revToday, orders, avgTicket, marginToday, foodCostPctToday, diffYesterday, diffWeekAvg, foodCostPctMonth){
  return (
    '<div class="kpi-grid">' +
      kpiCard("Fatturato oggi", euroFmt(revToday), diffWeekAvg != null ? trendLabel(diffWeekAvg, "vs media settimana") : "") +
      kpiCard("Clienti oggi", numFmt(orders, 0), diffYesterday != null ? "ieri " + numFmt(Number((DASH.yesterday||{}).orders_count||0), 0) : "") +
      kpiCard("Ticket medio", euroFmt(avgTicket), orders > 0 ? "su " + orders + " ordini" : "") +
      kpiCard("Margine stimato", euroFmt(marginToday), foodCostPctToday > 0 ? "food cost " + numFmt(foodCostPctToday, 1) + "%" : "", foodCostPctToday > 31 ? "warn" : "") +
      kpiCard("Food cost mese", numFmt(foodCostPctMonth, 1) + "%", "target ≤ 29%", foodCostPctMonth > 31 ? "warn" : (foodCostPctMonth > 29 ? "soft" : "good")) +
      kpiCard("Magazzino critico", DASH.lowStock.length, DASH.lowStock.length > 0 ? "ingredienti sotto soglia" : "tutto OK", DASH.lowStock.length > 0 ? "warn" : "good") +
    '</div>'
  );
}

function kpiCard(label, value, sub, tone){
  return (
    '<div class="kpi-card' + (tone ? " kpi-" + tone : "") + '">' +
      '<div class="kpi-label">' + escapeHtml(label) + '</div>' +
      '<div class="kpi-value">' + escapeHtml(String(value)) + '</div>' +
      (sub ? '<div class="kpi-sub">' + escapeHtml(sub) + '</div>' : "") +
    '</div>'
  );
}

function trendLabel(delta, suffix){
  if (delta === 0 || delta == null) return "= " + (suffix || "");
  const sign = delta > 0 ? "↑" : "↓";
  return sign + " " + euroFmt(Math.abs(delta)) + " " + (suffix || "");
}

function dashAlarmsBlock(){
  if (DASH.lowStock.length === 0) return "";
  const rows = DASH.lowStock.slice(0, 8).map((i) => {
    const isCrit = Number(i.stock_qty) <= Number(i.critical_stock_qty);
    return '<div class="alarm-row ' + (isCrit ? "alarm-crit" : "alarm-warn") + '">' +
      '<span class="dot"></span>' +
      '<span class="al-name">' + escapeHtml(i.name) + '</span>' +
      '<span class="al-stock">' + numFmt(i.stock_qty, 0) + ' ' + escapeHtml(i.unit) + '</span>' +
      '<span class="al-thr">soglia ' + numFmt(i.min_stock_qty, 0) + '</span>' +
    '</div>';
  }).join("");
  return (
    '<div class="dash-section">' +
      '<div class="dash-section-head">' +
        '<h3>⚠️ Magazzino · ingredienti da riordinare</h3>' +
        (DASH.lowStock.length > 8 ? '<span class="muted">+ ' + (DASH.lowStock.length - 8) + ' altri</span>' : "") +
        '<button class="btn btn-ghost" data-action="navigate" data-args=\'["#/magazzino"]\'>Vai al magazzino →</button>' +
      '</div>' +
      '<div class="alarms-list">' + rows + '</div>' +
    '</div>'
  );
}

function dashChart30Block(){
  const data = DASH.last30 || [];
  if (data.length === 0) return '<div class="dash-section"><h3>Fatturato ultimi 30 giorni</h3><div class="muted">Nessun dato.</div></div>';

  const w = 720, h = 200, pad = 24;
  const max = Math.max.apply(null, data.map((d) => Number(d.revenue_cents || 0)).concat([1]));
  const stepX = (w - pad * 2) / Math.max(1, (data.length - 1));
  const points = data.map((d, idx) => {
    const x = pad + idx * stepX;
    const y = h - pad - ((Number(d.revenue_cents || 0) / max) * (h - pad * 2));
    return { x, y, d };
  });
  const path = points.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
  const area = path + " L" + points[points.length - 1].x.toFixed(1) + "," + (h - pad) + " L" + points[0].x.toFixed(1) + "," + (h - pad) + " Z";
  const todayRev = points.length > 0 ? Number(points[points.length - 1].d.revenue_cents || 0) : 0;
  const max7 = Math.max.apply(null, data.slice(-7).map((d) => Number(d.revenue_cents || 0)).concat([1]));

  return (
    '<div class="dash-section dash-chart">' +
      '<div class="dash-section-head"><h3>Fatturato ultimi 30 giorni</h3><span class="muted">max ' + euroFmt(max) + '</span></div>' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" preserveAspectRatio="none" class="chart-svg">' +
        '<defs><linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#10B981" stop-opacity=".35"/>' +
          '<stop offset="100%" stop-color="#10B981" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#dashGrad)"/>' +
        '<path d="' + path + '" stroke="#10B981" stroke-width="2.5" fill="none" stroke-linejoin="round"/>' +
        points.map((p) => '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.5" fill="#10B981"></circle>').join("") +
      '</svg>' +
      '<div class="chart-foot">' +
        '<span>oggi <strong>' + euroFmt(todayRev) + '</strong></span>' +
        '<span class="muted">picco 7gg ' + euroFmt(max7) + '</span>' +
      '</div>' +
    '</div>'
  );
}

function dashHourlyBlock(){
  const data = DASH.hourly || [];
  // Mostriamo solo orari del bar (7-21)
  const slice = data.filter((d) => d.hour >= 7 && d.hour <= 21);
  if (slice.length === 0) return '<div class="dash-section"><h3>Vendite per ora · oggi</h3><div class="muted">Nessun ordine ancora oggi.</div></div>';
  const max = Math.max.apply(null, slice.map((d) => Number(d.revenue_cents || 0)).concat([1]));
  const bars = slice.map((d) => {
    const pct = (Number(d.revenue_cents || 0) / max) * 100;
    return '<div class="bar-col">' +
      '<div class="bar" style="height:' + pct.toFixed(1) + '%"></div>' +
      '<div class="bar-hour">' + d.hour + '</div>' +
    '</div>';
  }).join("");
  return (
    '<div class="dash-section dash-hourly">' +
      '<div class="dash-section-head"><h3>Vendite per ora · oggi</h3></div>' +
      '<div class="bars-row">' + bars + '</div>' +
    '</div>'
  );
}

function dashTopProductsBlock(){
  const list = DASH.topProducts || [];
  if (list.length === 0) return '<div class="dash-section"><h3>Top 10 prodotti · ultimi 7 giorni</h3><div class="muted">Nessun ordine.</div></div>';
  const max = Math.max.apply(null, list.map((p) => Number(p.qty_sold || 0)).concat([1]));
  const rows = list.map((p, idx) => {
    const pct = (Number(p.qty_sold || 0) / max) * 100;
    return '<div class="top-row">' +
      '<span class="rank">' + (idx + 1) + '</span>' +
      '<span class="name">' + escapeHtml(p.product_name) + '</span>' +
      '<span class="bar-wrap"><span class="bar" style="width:' + pct.toFixed(1) + '%"></span></span>' +
      '<span class="qty">' + numFmt(p.qty_sold, 0) + '×</span>' +
      '<span class="rev">' + euroFmt(p.revenue_cents) + '</span>' +
    '</div>';
  }).join("");
  return (
    '<div class="dash-section">' +
      '<div class="dash-section-head"><h3>Top 10 prodotti · ultimi 7 giorni</h3></div>' +
      '<div class="top-list">' + rows + '</div>' +
    '</div>'
  );
}

// Helper data locale ISO (Europe/Rome). Non usiamo toISOString che è UTC.
function localDateStr(date){
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// ============================================================
// CHIUSURA CASSA · riconciliazione + export corrispettivi
// ============================================================
const CHIUSURA = {
  date: null,          // YYYY-MM-DD
  loading: false,
  expected: null,      // riga daily_cash_expected (per riconciliazione metodi)
  totals: null,        // riga daily_revenue (per totali del giorno: ordini, fatturato)
  existing: null,      // riga daily_close se già chiusa
  cogsToday: 0,
  topToday: [],
  counted: { cash: "", card: "", voucher: "" },
  notes: "",
  saving: false,
};

async function renderChiusuraPage(main){
  CHIUSURA.date = CHIUSURA.date || localDateStr(new Date());
  main.innerHTML =
    '<div class="page-header">' +
      '<div><h1>Chiusura cassa</h1><div class="sub" id="chiusuraSub">' + dateFmt(new Date(CHIUSURA.date)) + '</div></div>' +
      '<div class="page-actions">' +
        '<input type="date" class="input" style="width:auto;display:inline-block" id="chiusuraDate" value="' + CHIUSURA.date + '" data-action="chiusuraDateChanged" />' +
        '<button class="btn" data-action="chiusuraExportCsv">📥 Esporta corrispettivi</button>' +
      '</div>' +
    '</div>' +
    '<div id="chiusuraBody"><div class="muted" style="padding:24px">Carico…</div></div>';
  await chiusuraLoad();
  chiusuraRender();
  // Wire input date dopo render iniziale
  const dateInput = document.getElementById("chiusuraDate");
  if (dateInput) dateInput.addEventListener("change", (e) => {
    CHIUSURA.date = e.target.value;
    chiusuraLoad().then(chiusuraRender);
    const sub = document.getElementById("chiusuraSub");
    if (sub) sub.textContent = dateFmt(new Date(CHIUSURA.date));
  });
}

async function chiusuraLoad(){
  if (!BRIO.org) return;
  CHIUSURA.loading = true;
  const orgId = BRIO.org.id;
  const date = CHIUSURA.date;

  try {
    const [expRes, totRes, closeRes, cogsRes, topRes] = await Promise.all([
      supa().from("daily_cash_expected").select("*").eq("org_id", orgId).eq("daily_date", date).maybeSingle(),
      supa().from("daily_revenue").select("*").eq("org_id", orgId).eq("daily_date", date).maybeSingle(),
      supa().from("daily_close").select("*").eq("org_id", orgId).eq("close_date", date).maybeSingle(),
      supa().from("daily_cogs").select("cogs_cents").eq("org_id", orgId).eq("cogs_date", date).maybeSingle(),
      supa().from("order_items").select("product_name, qty, total_cents, orders!inner(org_id, daily_date, status)")
        .eq("orders.org_id", orgId).eq("orders.daily_date", date)
        .in("orders.status", ["paid","preparing","ready","delivered"]),
    ]);

    CHIUSURA.expected = expRes.data || { cash_cents: 0, card_cents: 0, voucher_cents: 0, total_cents: 0, orders_count: 0, change_given_cents: 0 };
    CHIUSURA.totals = totRes.data || { revenue_cents: 0, orders_count: 0, avg_ticket_cents: 0 };
    CHIUSURA.existing = closeRes.data || null;
    CHIUSURA.cogsToday = Number(cogsRes.data ? cogsRes.data.cogs_cents : 0);

    // Aggrega prodotti venduti per il giorno
    const agg = {};
    (topRes.data || []).forEach((it) => {
      if (!agg[it.product_name]) agg[it.product_name] = { qty: 0, rev: 0 };
      agg[it.product_name].qty += Number(it.qty || 0);
      agg[it.product_name].rev += Number(it.total_cents || 0);
    });
    CHIUSURA.topToday = Object.keys(agg).map((n) => ({ name: n, qty: agg[n].qty, rev: agg[n].rev }))
      .sort((a, b) => b.qty - a.qty);

    // Se chiusura già fatta, precompila i campi contati
    if (CHIUSURA.existing){
      CHIUSURA.counted = {
        cash:    centsToInputStr(CHIUSURA.existing.counted_cash_cents),
        card:    centsToInputStr(CHIUSURA.existing.counted_card_cents),
        voucher: centsToInputStr(CHIUSURA.existing.counted_voucher_cents),
      };
      CHIUSURA.notes = CHIUSURA.existing.notes || "";
    }
  } catch (e){
    err("[chiusura] load", e);
    toast("Errore caricamento chiusura: " + (e.message || e), "error");
  }
  CHIUSURA.loading = false;
}

function centsToInputStr(c){
  const v = Number(c || 0) / 100;
  return v > 0 ? v.toFixed(2).replace(".", ",") : "";
}
function parseEuroInput(s){
  if (!s) return 0;
  const cleaned = String(s).replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : Math.round(v * 100);
}

function chiusuraRender(){
  const body = document.getElementById("chiusuraBody");
  if (!body) return;
  const exp = CHIUSURA.expected;
  const totals = CHIUSURA.totals || { revenue_cents: 0, orders_count: 0 };
  const closed = !!CHIUSURA.existing;
  const isToday = CHIUSURA.date === localDateStr(new Date());

  const countedCash = parseEuroInput(CHIUSURA.counted.cash);
  const countedCard = parseEuroInput(CHIUSURA.counted.card);
  const countedVoucher = parseEuroInput(CHIUSURA.counted.voucher);
  const diffCash = countedCash - Number(exp.cash_cents || 0);
  const diffCard = countedCard - Number(exp.card_cents || 0);
  const diffVoucher = countedVoucher - Number(exp.voucher_cents || 0);
  const countedTotal = countedCash + countedCard + countedVoucher;
  // Riconciliazione: confronto sul subtotale dei metodi tracciati (cash/card/voucher), che è
  // contenuto in daily_cash_expected. Esclude ordini con payment_method='pending' (kiosk paga in cassa).
  const reconciledTotal = Number(exp.total_cents || 0);
  // Totale del giorno: TUTTI gli ordini conclusi (anche pending payment), per il riepilogo informativo.
  const dayTotal = Number(totals.revenue_cents || 0);
  const dayOrders = Number(totals.orders_count || 0);
  const margin = dayTotal - CHIUSURA.cogsToday;
  const foodCostPct = dayTotal > 0 ? (CHIUSURA.cogsToday / dayTotal) * 100 : 0;

  body.innerHTML =
    (closed ? '<div class="chiusura-locked">🔒 Chiusura già salvata il ' + (CHIUSURA.existing.closed_at ? dateFmt(CHIUSURA.existing.closed_at) + " " + timeFmt(CHIUSURA.existing.closed_at) : dateFmt(CHIUSURA.existing.close_date)) + '. Puoi rivedere ma non modificare.</div>' : "") +
    '<div class="chiusura-grid">' +
      // Colonna sinistra: atteso + form contati
      '<div>' +
        '<div class="dash-section">' +
          '<h3>Riepilogo del giorno</h3>' +
          '<div class="ch-stats">' +
            chStat("Ordini", numFmt(dayOrders, 0)) +
            chStat("Fatturato", euroFmt(dayTotal)) +
            chStat("Costo materie", euroFmt(CHIUSURA.cogsToday)) +
            chStat("Margine", euroFmt(margin), foodCostPct > 31 ? "warn" : "") +
            chStat("Food cost", numFmt(foodCostPct, 1) + "%", foodCostPct > 31 ? "warn" : "") +
            chStat("Resto dato", euroFmt(Number(exp.change_given_cents || 0))) +
          '</div>' +
        '</div>' +

        '<div class="dash-section">' +
          '<h3>Riconciliazione cassa</h3>' +
          '<div class="ch-table">' +
            '<div class="ch-row ch-head"><div>Metodo</div><div>Atteso</div><div>Contato</div><div>Differenza</div></div>' +
            chRecRow("Contanti", exp.cash_cents, CHIUSURA.counted.cash, "cash", diffCash, closed) +
            chRecRow("Carta",    exp.card_cents, CHIUSURA.counted.card, "card", diffCard, closed) +
            chRecRow("Buoni",    exp.voucher_cents, CHIUSURA.counted.voucher, "voucher", diffVoucher, closed) +
            '<div class="ch-row ch-total">' +
              '<div>Totale</div>' +
              '<div>' + euroFmt(expectedTotal) + '</div>' +
              '<div>' + euroFmt(countedTotal) + '</div>' +
              '<div class="' + (countedTotal === expectedTotal ? "diff-ok" : (countedTotal - expectedTotal >= 0 ? "diff-pos" : "diff-neg")) + '">' + diffLabel(countedTotal - expectedTotal) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="dash-section">' +
          '<h3>Note</h3>' +
          '<textarea class="textarea" id="chiusuraNotes" placeholder="Eventuali note: cassa fondo, sconti, anomalie…"' + (closed ? " disabled" : "") + '>' + escapeHtml(CHIUSURA.notes) + '</textarea>' +
        '</div>' +

        (!closed && isToday ? (
          '<div class="ch-actions">' +
            '<button class="btn btn-primary btn-lg" data-action="chiusuraSave">🔒 Chiudi giornata</button>' +
            '<span class="muted">L\'azione registra i totali contati. Successivamente la chiusura può essere solo consultata.</span>' +
          '</div>'
        ) : "") +

        (!isToday && !closed ? '<div class="muted" style="margin-top:16px">Questo giorno non è ancora stato chiuso. Puoi chiudere solo la giornata corrente.</div>' : "") +
      '</div>' +

      // Colonna destra: top prodotti del giorno
      '<div>' +
        '<div class="dash-section">' +
          '<h3>Top prodotti del giorno</h3>' +
          (CHIUSURA.topToday.length === 0
            ? '<div class="muted">Nessun ordine in questa giornata.</div>'
            : '<div class="top-list">' + CHIUSURA.topToday.slice(0, 12).map((p, idx) => (
                '<div class="top-row">' +
                  '<span class="rank">' + (idx + 1) + '</span>' +
                  '<span class="name">' + escapeHtml(p.name) + '</span>' +
                  '<span class="qty">' + numFmt(p.qty, 0) + '×</span>' +
                  '<span class="rev">' + euroFmt(p.rev) + '</span>' +
                '</div>'
              )).join("") + '</div>'
          ) +
        '</div>' +
      '</div>' +
    '</div>';

  // Wire input contati + note
  ["cash", "card", "voucher"].forEach((k) => {
    const el = document.getElementById("ch_" + k);
    if (el && !closed) el.addEventListener("input", (e) => {
      CHIUSURA.counted[k] = e.target.value;
      chiusuraRender(); // re-render per aggiornare differenze
      // Mantieni focus sull'input modificato
      const refocus = document.getElementById("ch_" + k);
      if (refocus){ refocus.focus(); refocus.setSelectionRange(refocus.value.length, refocus.value.length); }
    });
  });
  const notes = document.getElementById("chiusuraNotes");
  if (notes && !closed) notes.addEventListener("input", (e) => { CHIUSURA.notes = e.target.value; });
}

function chStat(label, value, tone){
  return '<div class="ch-stat ' + (tone || "") + '">' +
    '<div class="lab">' + escapeHtml(label) + '</div>' +
    '<div class="val">' + escapeHtml(value) + '</div>' +
  '</div>';
}

function chRecRow(label, expectedCents, countedStr, key, diff, disabled){
  return '<div class="ch-row">' +
    '<div>' + escapeHtml(label) + '</div>' +
    '<div>' + euroFmt(expectedCents) + '</div>' +
    '<div><input class="input ch-input" id="ch_' + key + '" type="text" inputmode="decimal" placeholder="0,00 €" value="' + escapeHtml(countedStr || "") + '"' + (disabled ? " disabled" : "") + ' /></div>' +
    '<div class="' + (diff === 0 ? "diff-ok" : (diff >= 0 ? "diff-pos" : "diff-neg")) + '">' + diffLabel(diff) + '</div>' +
  '</div>';
}

function diffLabel(d){
  if (d === 0) return "= 0,00 €";
  return (d > 0 ? "+ " : "− ") + euroFmt(Math.abs(d));
}

function chiusuraDateChanged(){ /* gestito via listener change */ }

async function chiusuraSave(){
  if (CHIUSURA.saving || CHIUSURA.existing) return;
  const isToday = CHIUSURA.date === localDateStr(new Date());
  if (!isToday){ toast("Puoi chiudere solo la giornata corrente", "error"); return; }

  const ok = await brioConfirm({
    title: "Confermi la chiusura?",
    message: "Dopo la chiusura la giornata sarà consultabile ma non più modificabile.",
    okLabel: "Chiudi giornata",
    cancelLabel: "Annulla",
    icon: "🔒",
  });
  if (!ok) return;

  CHIUSURA.saving = true;
  const orgId = BRIO.org.id;
  const exp = CHIUSURA.expected || {};
  const tot = CHIUSURA.totals || {};
  const cCash = parseEuroInput(CHIUSURA.counted.cash);
  const cCard = parseEuroInput(CHIUSURA.counted.card);
  const cVouch = parseEuroInput(CHIUSURA.counted.voucher);
  const ordersCount = Number(tot.orders_count || 0);
  const totalExpected = Number(tot.revenue_cents || 0);
  const avgTicket = ordersCount > 0 ? Math.round(totalExpected / ordersCount) : 0;

  const payload = {
    org_id: orgId,
    close_date: CHIUSURA.date,
    expected_cash_cents: Number(exp.cash_cents || 0),
    expected_card_cents: Number(exp.card_cents || 0),
    expected_voucher_cents: Number(exp.voucher_cents || 0),
    expected_total_cents: totalExpected,
    counted_cash_cents: cCash,
    counted_card_cents: cCard,
    counted_voucher_cents: cVouch,
    diff_cash_cents: cCash - Number(exp.cash_cents || 0),
    diff_card_cents: cCard - Number(exp.card_cents || 0),
    orders_count: ordersCount,
    avg_ticket_cents: avgTicket,
    cogs_cents: CHIUSURA.cogsToday,
    notes: CHIUSURA.notes || null,
    closed_by: BRIO.user.id,
  };
  const { data, error } = await supa().from("daily_close").insert(payload).select().single();
  CHIUSURA.saving = false;
  if (error){
    err("[chiusura] save", error);
    toast("Errore chiusura: " + error.message, "error");
    return;
  }
  CHIUSURA.existing = data;
  toast("Giornata chiusa", "success");
  chiusuraRender();
}

// Export CSV corrispettivi giornalieri (formato semplificato per commercialista)
async function chiusuraExportCsv(){
  if (!BRIO.org) return;
  const date = CHIUSURA.date;
  const orgId = BRIO.org.id;
  toast("Genero CSV…");

  const { data: rows, error } = await supa()
    .from("orders")
    .select("daily_number, daily_date, channel, total_cents, vat_cents, payment_method, paid_cash_cents, paid_card_cents, paid_voucher_cents, change_given_cents, created_at, status")
    .eq("org_id", orgId)
    .eq("daily_date", date)
    .in("status", ["paid","preparing","ready","delivered"])
    .order("daily_number");

  if (error){ toast("Errore export: " + error.message, "error"); return; }

  const header = ["Numero","Data","Ora","Canale","Stato","Metodo","Contanti","Carta","Buoni","Resto","Imponibile","IVA","Totale"];
  const csv = [header.join(";")].concat((rows || []).map((r) => {
    const dt = new Date(r.created_at);
    const imponibile = Math.max(0, Number(r.total_cents || 0) - Number(r.vat_cents || 0));
    return [
      r.daily_number,
      r.daily_date,
      timeFmt(dt),
      r.channel,
      r.status,
      r.payment_method || "",
      euroPlainCsv(r.paid_cash_cents),
      euroPlainCsv(r.paid_card_cents),
      euroPlainCsv(r.paid_voucher_cents),
      euroPlainCsv(r.change_given_cents),
      euroPlainCsv(imponibile),
      euroPlainCsv(r.vat_cents),
      euroPlainCsv(r.total_cents),
    ].join(";");
  })).join("\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "brio_corrispettivi_" + date + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("CSV scaricato (" + (rows ? rows.length : 0) + " righe)", "success");
}

function euroPlainCsv(c){
  return (Number(c || 0) / 100).toFixed(2).replace(".", ",");
}

// ============================================================
// CASSA FISCALE · integrazione RT + POS
// ============================================================
// L'app NON emette scontrini fiscali (vietato dalla normativa italiana):
// dialoga con hardware esterno certificato Agenzia Entrate.
//
// In modalità test (default): simula tutto e logga in fiscal_receipts_log.
// In modalità live: chiama RT/POS via HTTP/TCP. Da implementare quando
// l'hardware sarà noto (vedi CASSA_FISCALE_HANDOFF.md per protocolli).
// ============================================================

const CFI = {
  loaded: false,
  config: null,
  saving: false,
  recentLog: [],
  testLogText: "",
};

const RT_MODELS = [
  { value: "epson_fp90",      label: "Epson FP-90 III" },
  { value: "rch_printf",      label: "RCH Print!F" },
  { value: "custom_q3",       label: "Custom Q3X" },
  { value: "olivetti_prt100", label: "Olivetti PRT 100 FT-PR" },
  { value: "altro",           label: "Altro" },
];
const POS_BRANDS = [
  { value: "ingenico",  label: "Ingenico" },
  { value: "pax",       label: "PAX" },
  { value: "verifone",  label: "Verifone" },
  { value: "nexi",      label: "Nexi" },
  { value: "sumup",     label: "SumUp" },
  { value: "altro",     label: "Altro" },
];

async function renderCassaFiscalePage(main){
  main.innerHTML =
    '<div class="page-header">' +
      '<div><h1>Cassa fiscale</h1><div class="sub muted">Configurazione RT (Registratore Telematico) + POS bancario</div></div>' +
      '<div class="page-actions"><button class="btn" data-action="cfiRefresh">⟲ Ricarica</button></div>' +
    '</div>' +
    '<div id="cfiBody"><div class="muted" style="padding:24px">Carico configurazione…</div></div>';
  await cfiLoad();
  cfiRender();
}

async function cfiLoad(){
  if (!BRIO.org) return;
  const orgId = BRIO.org.id;
  const [confRes, logRes] = await Promise.all([
    supa().from("rt_config").select("*").eq("org_id", orgId).maybeSingle(),
    supa().from("fiscal_receipts_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (confRes.error){ err("[cfi] load config", confRes.error); toast("Errore caricamento configurazione: " + confRes.error.message, "error"); }
  CFI.config = confRes.data || cfiDefaultConfig(orgId);
  CFI.recentLog = logRes.data || [];
  CFI.loaded = true;
}

function cfiDefaultConfig(orgId){
  return {
    org_id: orgId,
    rt_active: false, rt_protocol: "http", rt_timeout_sec: 10,
    pos_active: false, pos_protocol: "p17", pos_timeout_sec: 60,
    test_mode: true, notes: "",
  };
}

async function cfiRefresh(){
  CFI.loaded = false;
  await cfiLoad();
  cfiRender();
  toast("Configurazione ricaricata", "success");
}

function cfiStatusBadge(c){
  if (c.test_mode) return '<span class="cfi-badge test">🧪 Modalità test</span>';
  if (c.rt_active && c.pos_active) return '<span class="cfi-badge live">✅ Live · RT + POS attivi</span>';
  if (c.rt_active || c.pos_active) return '<span class="cfi-badge partial">⚙️ Configurazione parziale</span>';
  return '<span class="cfi-badge off">⏸ Disattivata</span>';
}

function cfiRender(){
  const body = document.getElementById("cfiBody");
  if (!body) return;
  const c = CFI.config || cfiDefaultConfig(BRIO.org ? BRIO.org.id : null);

  body.innerHTML =
    '<div class="cfi-banner">' + cfiStatusBadge(c) +
      '<div class="cfi-banner-text">' +
        (c.test_mode
          ? 'In modalità test ogni scontrino è simulato e tracciato in <code>fiscal_receipts_log</code>. Disattiva la modalità test solo quando hardware è installato e collaudato.'
          : 'Modalità LIVE: il software chiama hardware reale. Verifica che RT e POS siano accesi e raggiungibili.'
        ) +
      '</div>' +
    '</div>' +

    '<form class="cfi-form" data-form="cfiSave">' +

      // Modalità test toggle
      '<div class="dash-section">' +
        '<label class="cfi-toggle">' +
          '<input type="checkbox" name="test_mode"' + (c.test_mode ? " checked" : "") + ' />' +
          '<span class="toggle-text"><strong>Modalità test</strong> — simula chiamate hardware senza emettere scontrini reali</span>' +
        '</label>' +
      '</div>' +

      // RT card
      '<div class="dash-section">' +
        '<div class="dash-section-head">' +
          '<h3>📟 Registratore Telematico (RT)</h3>' +
          '<label class="cfi-toggle"><input type="checkbox" name="rt_active"' + (c.rt_active ? " checked" : "") + ' /><span class="toggle-text">Attivo</span></label>' +
        '</div>' +
        '<div class="cfi-grid">' +
          cfiField("IP", "rt_ip", c.rt_ip, "192.168.1.50") +
          cfiField("Porta", "rt_port", c.rt_port, "8080", "number") +
          cfiSelect("Modello", "rt_model", c.rt_model, RT_MODELS) +
          cfiSelect("Protocollo", "rt_protocol", c.rt_protocol, [
            { value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }, { value: "tcp", label: "TCP" }
          ]) +
          cfiField("Path endpoint", "rt_endpoint_path", c.rt_endpoint_path, "/cgi-bin/fpmate.cgi") +
          cfiField("Timeout (s)", "rt_timeout_sec", c.rt_timeout_sec, "10", "number") +
          cfiField("User (opz)", "rt_user", c.rt_user, "") +
          cfiField("Password (opz)", "rt_password", c.rt_password, "", "password") +
        '</div>' +
        '<div class="cfi-actions">' +
          '<button type="button" class="btn" data-action="cfiTestRT">⚙️ Test RT</button>' +
        '</div>' +
      '</div>' +

      // POS card
      '<div class="dash-section">' +
        '<div class="dash-section-head">' +
          '<h3>💳 POS bancario</h3>' +
          '<label class="cfi-toggle"><input type="checkbox" name="pos_active"' + (c.pos_active ? " checked" : "") + ' /><span class="toggle-text">Attivo</span></label>' +
        '</div>' +
        '<div class="cfi-grid">' +
          cfiField("IP", "pos_ip", c.pos_ip, "192.168.1.60") +
          cfiField("Porta", "pos_port", c.pos_port, "8081", "number") +
          cfiSelect("Marca", "pos_brand", c.pos_brand, POS_BRANDS) +
          cfiSelect("Protocollo", "pos_protocol", c.pos_protocol, [
            { value: "p17", label: "Protocollo 17 (XML17)" }, { value: "rest", label: "REST JSON" }, { value: "altro", label: "Altro" }
          ]) +
          cfiField("Terminal ID", "pos_terminal_id", c.pos_terminal_id, "12345678") +
          cfiField("Timeout (s)", "pos_timeout_sec", c.pos_timeout_sec, "60", "number") +
        '</div>' +
        '<div class="cfi-actions">' +
          '<button type="button" class="btn" data-action="cfiTestPOS">⚙️ Test POS</button>' +
        '</div>' +
      '</div>' +

      '<div class="dash-section">' +
        '<h3>Note</h3>' +
        '<textarea class="textarea" name="notes" placeholder="Note libere su matricola, taratura, contatti assistenza, scadenze verifiche, …">' + escapeHtml(c.notes || "") + '</textarea>' +
      '</div>' +

      '<div class="cfi-save-bar">' +
        '<button type="submit" class="btn btn-primary btn-lg"' + (CFI.saving ? " disabled" : "") + '>' + (CFI.saving ? "Salvo…" : "💾 Salva configurazione") + '</button>' +
      '</div>' +
    '</form>' +

    // Output test
    (CFI.testLogText
      ? '<div class="dash-section"><div class="dash-section-head"><h3>📋 Output ultimo test</h3><button class="btn btn-ghost" data-action="cfiClearTestLog">✕</button></div><pre class="cfi-test-log">' + escapeHtml(CFI.testLogText) + '</pre></div>'
      : "") +

    // Log scontrini recenti
    cfiRenderRecentLog();
}

function cfiField(label, name, value, placeholder, type){
  return '<label class="field cfi-field">' +
    '<span class="label">' + escapeHtml(label) + '</span>' +
    '<input class="input" name="' + name + '" type="' + (type || "text") + '"' +
      ' value="' + escapeHtml(value == null ? "" : String(value)) + '"' +
      ' placeholder="' + escapeHtml(placeholder || "") + '" />' +
  '</label>';
}

function cfiSelect(label, name, value, opts){
  const options = opts.map((o) => (
    '<option value="' + escapeHtml(o.value) + '"' + (value === o.value ? " selected" : "") + '>' + escapeHtml(o.label) + '</option>'
  )).join("");
  return '<label class="field cfi-field">' +
    '<span class="label">' + escapeHtml(label) + '</span>' +
    '<select class="select" name="' + name + '"><option value="">—</option>' + options + '</select>' +
  '</label>';
}

function cfiRenderRecentLog(){
  if (CFI.recentLog.length === 0){
    return '<div class="dash-section"><h3>📜 Ultimi scontrini fiscali</h3><div class="muted">Nessuno scontrino emesso finora.</div></div>';
  }
  const rows = CFI.recentLog.map((l) => {
    const tone = l.status === "completed" ? "ok" : (l.status.includes("error") ? "err" : "warn");
    return '<div class="cfi-log-row cfi-log-' + tone + '">' +
      '<div class="cfi-log-icon">' + (tone === "ok" ? "✅" : (tone === "err" ? "❌" : "⏳")) + '</div>' +
      '<div class="cfi-log-main">' +
        '<div><strong>' + escapeHtml(l.receipt_number || "—") + '</strong>' + (l.test_mode ? ' <span class="cfi-log-test">TEST</span>' : '') + '</div>' +
        '<div class="muted" style="font-size:12px">' + dateFmt(l.created_at) + " " + timeFmt(l.created_at) + ' · ' + escapeHtml(l.payment_method || "—") + ' · ' + escapeHtml(l.status) + (l.error_msg ? " · " + escapeHtml(l.error_msg) : "") + '</div>' +
      '</div>' +
      '<div class="cfi-log-amount">' + euroFmt(l.amount_cents) + '</div>' +
    '</div>';
  }).join("");
  return '<div class="dash-section">' +
    '<div class="dash-section-head"><h3>📜 Ultimi scontrini fiscali (' + CFI.recentLog.length + ')</h3></div>' +
    '<div class="cfi-log-list">' + rows + '</div>' +
  '</div>';
}

async function onCfiSaveSubmit(form){
  if (CFI.saving) return;
  CFI.saving = true;
  cfiRender();
  const fd = new FormData(form);
  const payload = {
    org_id: BRIO.org.id,
    rt_active: fd.get("rt_active") === "on",
    rt_ip: emptyToNull(fd.get("rt_ip")),
    rt_port: parseIntOrNull(fd.get("rt_port")),
    rt_model: emptyToNull(fd.get("rt_model")),
    rt_protocol: emptyToNull(fd.get("rt_protocol")) || "http",
    rt_user: emptyToNull(fd.get("rt_user")),
    rt_password: emptyToNull(fd.get("rt_password")),
    rt_endpoint_path: emptyToNull(fd.get("rt_endpoint_path")),
    rt_timeout_sec: parseIntOrNull(fd.get("rt_timeout_sec")) || 10,
    pos_active: fd.get("pos_active") === "on",
    pos_ip: emptyToNull(fd.get("pos_ip")),
    pos_port: parseIntOrNull(fd.get("pos_port")),
    pos_brand: emptyToNull(fd.get("pos_brand")),
    pos_protocol: emptyToNull(fd.get("pos_protocol")) || "p17",
    pos_terminal_id: emptyToNull(fd.get("pos_terminal_id")),
    pos_timeout_sec: parseIntOrNull(fd.get("pos_timeout_sec")) || 60,
    test_mode: fd.get("test_mode") === "on",
    notes: emptyToNull(fd.get("notes")),
  };
  const { data, error } = await supa()
    .from("rt_config")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();
  CFI.saving = false;
  if (error){
    err("[cfi] save", error);
    toast("Errore salvataggio: " + error.message, "error");
    cfiRender();
    return;
  }
  CFI.config = data;
  toast("Configurazione salvata", "success");
  cfiRender();
}

function emptyToNull(v){
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function parseIntOrNull(v){
  if (v == null || v === "") return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

async function cfiTestRT(){
  const c = CFI.config || {};
  if (c.test_mode){
    CFI.testLogText = "🧪 SIMULAZIONE RT (modalità test)\n" +
      "Modello: " + (c.rt_model || "—") + "\n" +
      "Endpoint: " + (c.rt_protocol || "http") + "://" + (c.rt_ip || "?") + ":" + (c.rt_port || "?") + (c.rt_endpoint_path || "") + "\n\n" +
      "→ Apro connessione…\n" +
      "→ Invio comando di echo/ping…\n" +
      "← Risposta simulata: OK (latency 45ms)\n" +
      "← Matricola RT simulata: 99TEST" + Math.floor(Math.random()*1000000) + "\n\n" +
      "✅ Test simulato completato. In modalità test nessuna chiamata reale è stata fatta.";
    toast("Test RT simulato", "success");
  } else {
    CFI.testLogText = "❌ Modalità LIVE non ancora implementata.\n\n" +
      "Per il modello \"" + (c.rt_model || "?") + "\" il protocollo (" + (c.rt_protocol || "http") + ") richiede l'integrazione delle chiamate reali HTTP/TCP all'indirizzo " +
      (c.rt_ip || "?") + ":" + (c.rt_port || "?") + ".\n\n" +
      "Vedi CASSA_FISCALE_HANDOFF.md per riferimento ai protocolli.";
    toast("Modalità live: integrazione hardware da implementare", "error");
  }
  cfiRender();
}

async function cfiTestPOS(){
  const c = CFI.config || {};
  if (c.test_mode){
    CFI.testLogText = "🧪 SIMULAZIONE POS (modalità test)\n" +
      "Marca: " + (c.pos_brand || "—") + "\n" +
      "Endpoint: http://" + (c.pos_ip || "?") + ":" + (c.pos_port || "?") + "\n" +
      "Terminal ID: " + (c.pos_terminal_id || "—") + "\n" +
      "Protocollo: " + (c.pos_protocol || "p17") + "\n\n" +
      "→ Apro connessione…\n" +
      "→ Invio richiesta echo…\n" +
      "← Risposta simulata: Esito codice=00 (OK), latency 78ms\n\n" +
      "✅ Test simulato completato.";
    toast("Test POS simulato", "success");
  } else {
    CFI.testLogText = "❌ Modalità LIVE non ancora implementata.\n\n" +
      "Il POS (" + (c.pos_brand || "?") + ", protocollo " + (c.pos_protocol || "p17") + ") richiede l'integrazione reale all'indirizzo " +
      (c.pos_ip || "?") + ":" + (c.pos_port || "?") + ".";
    toast("Modalità live: integrazione hardware da implementare", "error");
  }
  cfiRender();
}

function cfiClearTestLog(){ CFI.testLogText = ""; cfiRender(); }

// ============================================================
// API: fiscalEmettiScontrino — chiamata dal checkout cassa
// ============================================================
// Args:
//   order_id (uuid), amount_cents (bigint), payment_method (string)
//   lines (array di { name, qty, unit_price_cents, vat_rate })
// Ritorna: { ok: boolean, receipt_number?, error?, simulated?, status }
async function fiscalEmettiScontrino(args){
  if (!BRIO.org) return { ok: false, error: "Org non caricata" };
  const orgId = BRIO.org.id;

  // Carica config (cache se già loaded)
  if (!CFI.loaded){
    const { data } = await supa().from("rt_config").select("*").eq("org_id", orgId).maybeSingle();
    CFI.config = data || cfiDefaultConfig(orgId);
    CFI.loaded = true;
  }
  const c = CFI.config;

  // Se né RT né POS sono attivi → niente scontrino fiscale (modalità "solo gestionale")
  if (!c.rt_active && !c.pos_active && !c.test_mode){
    return { ok: false, error: "Cassa fiscale disattivata", skipped: true };
  }

  // Inserisci log "in_progress"
  const logPayload = {
    org_id: orgId,
    order_id: args.order_id || null,
    amount_cents: args.amount_cents || 0,
    payment_method: args.payment_method || null,
    test_mode: !!c.test_mode,
    status: "in_progress",
    emitted_by: BRIO.user ? BRIO.user.id : null,
  };
  const { data: logRow } = await supa().from("fiscal_receipts_log").insert(logPayload).select().single();
  const logId = logRow ? logRow.id : null;

  // ============ MODALITÀ TEST ============
  if (c.test_mode){
    // Simula latency hardware (600ms)
    await new Promise((r) => setTimeout(r, 600));
    const receiptNumber = "TEST-" + new Date().toISOString().slice(0,10).replace(/-/g, "") + "-" + Math.floor(Math.random()*100000).toString().padStart(5, "0");
    const rtSerial = "99TEST" + Math.floor(Math.random()*1000000);
    const upd = {
      status: "completed",
      receipt_number: receiptNumber,
      rt_serial: rtSerial,
      pos_response: { simulated: true, esito: "00", method: args.payment_method },
      rt_response:  { simulated: true, scontrino: receiptNumber, matricola: rtSerial, lines: args.lines || [] },
    };
    if (logId) await supa().from("fiscal_receipts_log").update(upd).eq("id", logId);
    return { ok: true, simulated: true, receipt_number: receiptNumber, rt_serial: rtSerial, status: "completed" };
  }

  // ============ MODALITÀ LIVE — TODO ============
  // Pseudocode:
  //  1) Se payment_method === 'card' && c.pos_active: chiama POS (Protocollo 17 / REST)
  //     → in errore: update log stato='pos_error' + return
  //  2) Se c.rt_active: costruisci comando scontrino e chiama RT
  //     → endpoint dipende da rt_model (epson_fp90 → /cgi-bin/fpmate.cgi XML SOAP, ecc)
  //     → parse risposta: receipt_number, rt_serial
  //  3) Update log stato='completed' con receipt_number + rt_serial
  //
  // Implementazione bloccata dalla scelta hardware. Vedi CASSA_FISCALE_HANDOFF.md
  // sez. "Specifiche tecniche dei protocolli da implementare".

  const errMsg = "Modalità live non ancora implementata. Configurare modalità test oppure completare l'integrazione hardware.";
  if (logId) await supa().from("fiscal_receipts_log").update({ status: "rt_error", error_msg: errMsg }).eq("id", logId);
  return { ok: false, error: errMsg, status: "rt_error" };
}

