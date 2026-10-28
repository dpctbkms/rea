# Rea Chart

트레이딩뷰(TradingView) 화면 구성과 사용 흐름을 참고해 다시 만든 웹 차트 앱입니다.
차트 렌더링에는 TradingView가 오픈소스(Apache-2.0)로 공개한
[lightweight-charts](https://github.com/tradingview/lightweight-charts)를 쓰고,
나머지(지표 계산, 툴바, 관심 목록, 그리기, 데이터 피드)는 직접 구현했습니다.
트레이딩뷰의 비공개 코드나 리소스는 쓰지 않았습니다.

## 기능

- **실시간 시세 (무료, API 키 불필요)**: 업비트, 빗썸(원화), 바이낸스, 바이비트, OKX(USDT), 코인베이스(USD). 툴바 맨 왼쪽에서 거래소를 고릅니다. 연결이 안 되면 자동으로 데모 데이터로 전환하고 상태 표시줄에 알려 줍니다.
- **타임프레임**: 1분, 5분, 15분, 1시간, 4시간, 1일, 1주
- **차트 종류**: 캔들, 하이킨아시, 바, 라인, 영역
- **지표**: 거래량, SMA 20, EMA 20/50/200, 볼린저 밴드, VWAP, RSI 14(하단 창), MACD 12/26/9(하단 창)
- **OHLC 범례**: 십자선을 따라 시고저종, 등락, 지표 값을 표시합니다.
- **그리기**: 수평선(심볼별로 저장), 전체 삭제
- **심볼 검색**: 차트에서 바로 글자를 입력하면 검색창이 열립니다. ↑/↓와 Enter로 선택합니다.
- **관심 목록**: 10개 코인의 실시간 가격과 24시간 등락률을 보여주고, 클릭하면 해당 심볼로 전환합니다.
- **다크/라이트 테마**, **PNG 스크린샷 저장**
- 설정(심볼, 타임프레임, 지표, 테마, 그린 선)은 브라우저에 저장됩니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ 에 정적 파일 생성
npm test           # 지표 계산 단위 테스트
```

`npm run build:artifact`는 앱을 웹 페이지 한 장(`dist-artifact/rea-chart.html`)으로 묶습니다. 이 버전은 데모 시세를 쓰고 스크린샷 버튼이 없습니다.

`?feed=demo`를 URL에 붙이면 네트워크 없이 데모 데이터로 실행합니다.

## GitHub Pages 배포

`.github/workflows/deploy.yml`이 기본 브랜치에 푸시될 때마다 테스트, 빌드, 배포를 실행합니다.
처음 한 번은 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿔야 합니다.
배포 주소는 `https://<계정>.github.io/<저장소>/`입니다. Actions 탭에서 **Deploy to GitHub Pages → Run workflow**로 수동 배포도 할 수 있습니다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `src/main.js` | 차트 생성, UI 이벤트, 범례, 그리기, 관심 목록 |
| `src/feeds/` | 거래소별 시세 피드. 모두 같은 인터페이스를 가집니다(`common.js` 맨 위 설명 참고). |
| `scripts/check-feeds.mjs` | 거래소에 실제로 접속해 시세 연결을 점검합니다(`npm run check:feeds`). GitHub Actions의 **Check price feeds**로도 돌릴 수 있습니다. |
| `src/indicators.js` | SMA, EMA, 볼린저, RSI(Wilder), MACD, VWAP, 하이킨아시 계산 |
| `test/` | 지표·피드 도우미 단위 테스트(`node --test`) |

다른 거래소나 주식 데이터를 붙이려면 `src/feeds/`에 같은 인터페이스의 피드를 만들어 `src/feeds/index.js`의 `FEEDS`에 추가하면 됩니다.

사이트에는 `noindex` 표시가 있어 검색엔진 결과에 나오지 않습니다.
