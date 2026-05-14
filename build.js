// build.js — Minifica e offusca app.js per la produzione
//
// Prende src/app.js (il sorgente leggibile) e crea app.js minificato alla root.
// Vercel deploya app.js minificato.
//
// IMPORTANTE: il mangle è DISATTIVATO sul top-level perché le funzioni globali
// (es. renderCassaPage, openCheckoutModal) sono richiamate dinamicamente
// dal nostro event delegator tramite window[name](). Se le rinominassimo,
// il delegator non le troverebbe più.

const fs = require("fs");
const path = require("path");
const { minify } = require("terser");

(async () => {
  const inputFile = path.join(__dirname, "src", "app.js");
  if (!fs.existsSync(inputFile)) {
    console.error("❌ File sorgente non trovato:", inputFile);
    process.exit(1);
  }

  console.log("📦 Lettura src/app.js...");
  const code = fs.readFileSync(inputFile, "utf8");
  const originalSize = Buffer.byteLength(code, "utf8");

  console.log("⚙️  Minify + obfuscation con terser...");

  const result = await minify(code, {
    compress: {
      drop_console: false,
      drop_debugger: true,
      passes: 3,
      sequences: true,
      dead_code: true,
      conditionals: true,
      booleans: true,
      unused: true,
      if_return: true,
      join_vars: true,
      collapse_vars: true,
      reduce_vars: true,
    },
    mangle: {
      toplevel: false,
      keep_fnames: false,
      properties: false,
    },
    format: {
      comments: false,
      beautify: false,
      ascii_only: false,
    },
    sourceMap: false,
  });

  if (result.error) {
    console.error("❌ Errore minify:", result.error);
    process.exit(1);
  }

  const minifiedSize = Buffer.byteLength(result.code, "utf8");
  const savedKb = ((originalSize - minifiedSize) / 1024).toFixed(1);
  const ratio = ((minifiedSize / originalSize) * 100).toFixed(1);

  const outFile = path.join(__dirname, "app.js");
  fs.writeFileSync(outFile, result.code, "utf8");

  console.log("");
  console.log("✅ Build completato!");
  console.log(`   Original:  ${(originalSize / 1024).toFixed(1)} KB`);
  console.log(`   Minified:  ${(minifiedSize / 1024).toFixed(1)} KB`);
  console.log(`   Ratio:     ${ratio}% (risparmiati ${savedKb} KB)`);
  console.log(`   Output:    ${outFile}`);
})().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
