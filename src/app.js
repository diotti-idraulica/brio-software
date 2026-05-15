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

// renderCassaPage: vedi sezione CASSA in fondo al file
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

  // 1) INSERT order
  const orderPayload = {
    org_id: orgId,
    channel: "cassa",
    status: "paid",
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
    // l'ordine è già salvato; lasciamo che sia review manuale
    CASSA.saving = false; return;
  }

  // 3) INSERT transaction (registro cassa)
  await supa().from("transactions").insert({
    org_id: orgId,
    order_id: ord.id,
    type: "sale",
    amount_cents: t.total,
    method: CASSA.paymentMethod,
    created_by: BRIO.user.id,
  });

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
