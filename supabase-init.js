// supabase-init.js — Inizializza il client Supabase globale prima del caricamento di app.js
// Viene caricato dopo la lib UMD di @supabase/supabase-js e prima di app.js.
// Una volta pronto, dispatcha l'evento "supabase-ready" che app.js attende.

(function () {
  var lib = window.supabase;
  if (!lib || typeof lib.createClient !== "function") {
    console.error("[Brio] Supabase UMD non caricato — controlla connessione a cdn.jsdelivr.net");
    return;
  }
  window.supabase = lib.createClient(
    "https://uyxqzggzimdvntqfcppw.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5eHF6Z2d6aW1kdm50cWZjcHB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3OTIxNDksImV4cCI6MjA5NDM2ODE0OX0.n8xb8kh8Zbh7Nevt9Dx2kbJzUAM38uKB3LfAzrzN4zE"
  );
  window.dispatchEvent(new Event("supabase-ready"));
  console.log("[Brio] Supabase client pronto");
})();
