const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mts|cts)$/.test(e.name)) files.push(p);
  }
}
walk(path.join(root, 'src'));
let errors = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const d of sf.parseDiagnostics) {
    errors += 1;
    const loc = sf.getLineAndCharacterOfPosition(d.start || 0);
    console.error(`${path.relative(root, f)}:${loc.line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
}
console.log(`Parsed ${files.length} TypeScript/TSX files with ${errors} parse diagnostics.`);
process.exitCode = errors ? 1 : 0;
