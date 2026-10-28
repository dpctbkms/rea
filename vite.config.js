import { defineConfig } from 'vite';

// 상대 경로로 빌드해서 GitHub Pages의 /<저장소 이름>/ 아래에서도 그대로 동작하게 한다.
export default defineConfig({
  base: './',
});
