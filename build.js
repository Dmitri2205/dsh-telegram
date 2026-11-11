import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('[1/3] Сборка сервера (tsc)...');
execSync('npx tsc', { stdio: 'inherit' });

console.log('[2/3] Сборка клиента (esbuild, CJS)...');
execSync('npx esbuild src/client/index.tsx --bundle --format=cjs --platform=browser --external:react --external:@deepseek-ai/* --outfile=lib/client.cjs', { stdio: 'inherit' });

console.log('[3/3] Обертка клиента для DSH...');
if (fs.existsSync('lib/client.cjs')) {
  const raw = fs.readFileSync('lib/client.cjs', 'utf8');
  const wrapped = `window.__ModuleLoader__.load({
  id: '@local/dsh-telegram',
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    (function(module, exports, require) {
${raw}
    })(module, exports, require);
    return module.exports;
  }
});`;
  fs.writeFileSync('lib/client.js', wrapped);
  fs.unlinkSync('lib/client.cjs');
  console.log('✅ Сборка клиента завершена!');
} else {
  console.error('❌ Ошибка: esbuild не создал lib/client.cjs');
}
