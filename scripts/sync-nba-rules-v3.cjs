// 把 NBA 規則 V3 正本同步到各 Edge Function（Supabase 網站貼上部署，無法跨函式 import）。
// 用法：node scripts/sync-nba-rules-v3.cjs        → 同步
//       node scripts/sync-nba-rules-v3.cjs --check → 只檢查是否一致（不一致時 exit 1）
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const BEGIN = '// === NBA_RULES_V3 BEGIN ===', END = '// === NBA_RULES_V3 END ===';
const TARGETS = ['supabase/functions/basketball-analysis/index.ts', 'supabase/functions/nba-v2-stage-runner/index.ts', 'supabase/functions/admin-nba-v2-compare/index.ts'];
const canonical = fs.readFileSync(path.join(root, 'supabase/functions/_shared/nba-rules-v3.js'), 'utf8').trim();
function block(text, file) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < a) throw Error(file + ' 找不到 NBA_RULES_V3 標記');
  return [a, b + END.length];
}
const check = process.argv.includes('--check');
let bad = 0;
for (const rel of TARGETS) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(BEGIN)) { if (check) continue; console.log('略過（尚未嵌入）：' + rel); continue; }
  const [a, b] = block(text, rel);
  if (text.slice(a, b) === canonical) { console.log('一致：' + rel); continue; }
  if (check) { bad++; console.error('不一致：' + rel); continue; }
  fs.writeFileSync(file, text.slice(0, a) + canonical + text.slice(b));
  console.log('已同步：' + rel);
}
process.exitCode = bad ? 1 : 0;
