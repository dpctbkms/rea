const base = 'https://api.bithumb.com/v1/candles/minutes/60?market=KRW-BTC&count=3';
for (const to of ['', '&to=2026-10-20T00:00:00Z', '&to=2026-10-20T00:00:00', '&to=2026-10-20%2000:00:00', '&to=2026-10-20T09:00:00%2B09:00']) {
  const res = await fetch(base + to);
  const text = await res.text();
  let summary;
  try { summary = JSON.parse(text).map((r) => `${r.candle_date_time_utc}/${r.candle_date_time_kst}`).join(', '); } catch { summary = text.slice(0, 200); }
  console.log(`to=${to || '(없음)'} -> ${res.status} ${summary}`);
}
