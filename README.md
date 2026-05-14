# Brio · Software

Software gestionale interno per **Brio** — fast bar di Piacenza.
Cassa, kiosk self-order, KDS, magazzino real-time, ordini automatici fornitori, dashboard soci, CRM fidelity.

Sviluppato da **Stimo Studios** (Stefano Barani).

---

## Stack

- **Frontend**: HTML / CSS / JS vanilla — SPA con hash routing, event delegation
- **Hosting**: Vercel (static, no build step)
- **DB / Auth**: Supabase (`uyxqzggzimdvntqfcppw`)
- **Email**: Resend (`noreply@easyly.it`)
- **PWA**: manifest + service worker (network-first per HTML/JS, cache-first per asset)

## Struttura repo

```
brio-software/
├── src/app.js                  ⚠️ sorgente leggibile — MODIFICA QUI
├── app.js                      🤖 auto-generato dalla GitHub Action terser — NON toccare
├── index.html                  struttura HTML + tutto il CSS Brio (palette, layout, componenti)
├── supabase-init.js            inizializza il client Supabase globale prima di app.js
├── manifest.json               PWA
├── sw.js                       service worker
├── build.js                    script terser per minify
├── package.json                solo devDep: terser
├── vercel.json                 config Vercel (static, no build)
├── .github/workflows/build.yml Action minify on push a src/app.js
├── migration_001_initial.sql   schema iniziale Supabase (18 tabelle + RLS + trigger)
└── README.md
```

## Workflow di deploy

1. Si modifica solo **`src/app.js`** e **`index.html`** (mai `app.js` alla root).
2. Push su `main` via GitHub Web.
3. GitHub Action `Build & Minify app.js` esegue `node build.js` → genera `app.js` minificato alla root e lo committa.
4. Vercel ricarica statico → pubblico vede `app.js` minificato.

## Setup iniziale (una volta sola)

1. Su Supabase, applicare `migration_001_initial.sql` nell'SQL editor.
2. Creare il primo utente admin via Supabase Auth → Users → Add user (email + password).
3. Su SQL editor inserire la riga in `members` collegando user_id all'organization Brio con `role='admin'`.

## Convenzioni di sviluppo

- **Italiano** ovunque: variabili, commenti, UI.
- Importi in **centesimi** lato DB (`bigint`), conversione ai bordi (`euroFmt()`).
- Date: `dateFmt()` → `gg/mm/aaaa`.
- Console log con prefisso modulo: `[Brio]`, `[cassa]`, `[magazzino]`, ecc.
- Funzioni globali invocate da HTML: definire come `function nome(){}` (NON `const`) — `build.js` ha `mangle.toplevel: false`.
- Event delegation via `data-action="nomeFunzione"` + `data-args='["a", 1]'`. NO `onclick=`.

## Pagine implementate (status MVP)

| Route | Stato | Note |
|---|---|---|
| `#/login` | ✅ funzionante | email + password |
| `#/` (home) | ✅ funzionante | selettore moduli |
| `#/cassa` | 🚧 placeholder | prossimo step |
| `#/kds` | 🚧 placeholder | |
| `#/kiosk` | 🚧 placeholder | |
| `#/magazzino` | 🚧 placeholder | |
| `#/fornitori` | 🚧 placeholder | |
| `#/dashboard` | 🚧 placeholder | |
| `#/chiusura` | 🚧 placeholder | |
| `#/menu` | 🚧 placeholder | pubblica, per QR tavolo |
