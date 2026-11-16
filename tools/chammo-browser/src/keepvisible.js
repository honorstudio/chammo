// 숨기지 않을 프로필 — <데이터>/browser/keep-visible.json 에 ["이름", "앞자리*"] (대소문자 안 가림).
// 24시간 운영 수집처럼 사람이 그 창을 직접 봐야 하는 크롬(캡차·스크롤 확인)은 숨기면 결과가 조용히 비어도 안 보인다(2026-11-17 운영 수집 PC).
// 윈도우 숨은 데스크톱(window.js placement — MCP 래퍼·스크립트 지킴이)과 앱 안전망(app/src-tauri/src/win_stray.rs keep_visible)이 같은 파일·같은 규칙.
// config.json 에 안 두는 까닭: 앱이 설정을 저장할 때 구조에 없는 키를 지운다
const fs = require('fs');
const path = require('path');

function file(dataDir) {
  return path.join(dataDir, 'browser', 'keep-visible.json');
}

function matches(name, pats) {
  if (!Array.isArray(pats)) return false;
  const n = String(name).toLowerCase();
  return pats.some((p) => {
    if (typeof p !== 'string' || !p) return false;
    const q = p.toLowerCase();
    return q.endsWith('*') ? n.startsWith(q.slice(0, -1)) : n === q;
  });
}

function keepVisible(dataDir, profile) {
  try {
    return matches(profile, JSON.parse(fs.readFileSync(file(dataDir), 'utf8')));
  } catch {
    return false;
  }
}

module.exports = { file, matches, keepVisible };
