// 앱 전체를 웹 페이지 한 장(dist-artifact/rea-chart.html)으로 묶는다.
// 차트 라이브러리는 CDN에서 받고, 시세는 데모 피드를 쓴다
// (공유 페이지에서는 외부 API 접속이 막혀 있기 때문).
import { build } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const LIB_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).dependencies['lightweight-charts'];

const out = await build({
  logLevel: 'warn',
  build: {
    write: false,
    rollupOptions: {
      input: 'src/main.js',
      external: ['lightweight-charts'],
      output: { format: 'iife', globals: { 'lightweight-charts': 'LightweightCharts' } },
    },
  },
});

const files = (Array.isArray(out) ? out[0] : out).output;
const js = files.find((f) => f.type === 'chunk').code;
const css = readFileSync('src/style.css', 'utf8');

const html = readFileSync('index.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace(/<button id="screenshot-btn"[^>]*>.*?<\/button>/, ''); // 공유 페이지는 다운로드를 막는다

const page = `<title>Rea Chart</title>
<style>
${css}
</style>
${body.trim()}
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@${LIB_VERSION}/dist/lightweight-charts.standalone.production.js"></script>
<script>window.REA_FEED = 'demo';</script>
<script>
${js.replaceAll('</script', '<\\/script')}
</script>
`;

mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/rea-chart.html', page);
console.log(`dist-artifact/rea-chart.html (${(page.length / 1024).toFixed(1)} KB)`);
