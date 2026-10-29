import { defineConfig } from 'vite';

// 상대 경로로 빌드해서 GitHub Pages의 /<저장소 이름>/ 아래에서도 그대로 동작하게 한다.
export default defineConfig({
  base: './',
  // 메뉴 > 정보에 보이는 빌드 날짜 (새 버전이 들어왔는지 확인용)
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
});
