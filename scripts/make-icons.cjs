// 앱 아이콘 PNG 만들기: public/icons/icon.svg, favicon.svg -> 홈 화면·앱 설치용 PNG
// 아이콘 SVG를 고친 뒤 한 번 실행하고 결과 PNG를 커밋한다: node scripts/make-icons.cjs
// (Playwright 필요. 클라우드 세션에는 미리 깔려 있다)
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'public', 'icons');
const icon = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const favicon = fs.readFileSync(path.join(dir, 'favicon.svg'), 'utf8');

// 배경을 네모 끝까지 채우고 그림을 가운데로 줄인 판 (안드로이드 maskable, 아이폰은 모서리를 알아서 둥글게 깎는다)
const fullBleed = (scale) => icon
  .replace(/<rect width="512" height="512" rx="116"/, '<rect width="512" height="512"')
  .replace(/(<rect width="512" height="512"[^>]*\/>)([\s\S]*)<\/svg>/, (_, bg, rest) =>
    `${bg}<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${rest}</g></svg>`);

const outputs = [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  ['maskable-512.png', fullBleed(0.78), 512],
  ['apple-touch-icon.png', fullBleed(0.9), 180],
  ['favicon-32.png', favicon, 32],
];

(async () => {
  const browser = await chromium.launch();
  for (const [name, svg, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.waitForFunction(() => document.querySelector('img').complete);
    await page.screenshot({ path: path.join(dir, name), omitBackground: true });
    await page.close();
    console.log(name, `${size}x${size}`);
  }
  await browser.close();
})();
