// 브라우저 확인 스크립트를 한 번에 돌린다: 빌드 → 미리보기 서버(4175) → e2e/*.cjs 차례로 실행.
// 사용법: npm run test:e2e [-- 스크립트이름...]   예) npm run test:e2e -- drawing-tv toolbar
// 스크린샷은 e2e/out/ 에 저장된다. Playwright가 설치돼 있어야 한다 (클라우드 세션에는 기본 설치).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'out');
const base = process.env.E2E_BASE ?? 'http://localhost:4175';
const only = process.argv.slice(2);
const scripts = readdirSync(here)
  .filter((f) => f.endsWith('.cjs') && (!only.length || only.includes(f.replace('.cjs', ''))))
  .sort();

mkdirSync(out, { recursive: true });
if (spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' }).status) process.exit(1);

const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { cwd: root, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 50 && !up; i++) {
  up = await fetch(base).then((r) => r.ok, () => false);
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up) {
  server.kill();
  console.error('미리보기 서버가 뜨지 않았습니다:', base);
  process.exit(1);
}

let failed = 0;
for (const s of scripts) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync('node', [join(here, s), out], { cwd: root, stdio: 'inherit', env: { ...process.env, E2E_BASE: base } });
  if (r.status) failed++;
}
server.kill();
console.log(`\n${scripts.length}개 실행, ${failed}개 비정상 종료. 스크린샷: ${out}`);
process.exit(failed ? 1 : 0);
