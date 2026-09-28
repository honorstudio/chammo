// persistent profile 격리/영속/충돌 검증 스파이크
//   node scripts/verify-profile.js   (실제 크로미움을 띄운다 — npm test 에는 안 들어간다)
const path = require('path');
// playwright 는 따로 설치하지 않고 @playwright/mcp 가 고정해 둔 버전을 빌려 쓴다
const { chromium } = require(require.resolve('playwright', {
  paths: [path.dirname(require.resolve('@playwright/mcp/package.json'))],
}));
const fs = require('fs');
const os = require('os');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-test-'));
const profA = path.join(base, 'profileA');
const profB = path.join(base, 'profileB');

async function main() {
  console.log('테스트 베이스:', base, '\n');

  // [1] profileA에 로그인 쿠키 심고 닫기 (영속 저장)
  let ctxA = await chromium.launchPersistentContext(profA, { headless: true });
  await ctxA.addCookies([{
    name: 'demo_login', value: 'token_ABC123',
    domain: 'example.com', path: '/',
    expires: Math.floor(Date.now() / 1000) + 3600,
  }]);
  console.log('[1] profileA에 로그인 쿠키 심음 → 닫음');
  await ctxA.close();

  // [2] profileA 재오픈 → 쿠키 유지되는지 (로그인 영속 검증)
  ctxA = await chromium.launchPersistentContext(profA, { headless: true });
  const ckA = (await ctxA.cookies('https://example.com')).find(c => c.name === 'demo_login');
  console.log('[2] 재오픈 후 쿠키:', ckA ? `✅ 유지됨 (${ckA.value})` : '❌ 사라짐');

  // [3] profileB 동시 기동 → A의 쿠키가 안 보여야 함 (격리 검증)
  const ctxB = await chromium.launchPersistentContext(profB, { headless: true });
  const ckB = (await ctxB.cookies('https://example.com')).find(c => c.name === 'demo_login');
  console.log('[3] profileB(동시기동) 쿠키:', ckB ? '❌ 보임(격리실패)' : '✅ 안보임(격리OK)');
  await ctxB.close();

  // [4] profileA가 이미 열린 상태에서 같은 프로필 또 열기 (충돌 검증)
  try {
    const dup = await chromium.launchPersistentContext(profA, { headless: true, timeout: 8000 });
    console.log('[4] 같은 프로필 중복 오픈: ⚠️ 성공해버림 (Playwright가 락 우회?)');
    await dup.close();
  } catch (e) {
    console.log('[4] 같은 프로필 중복 오픈: ✅ 충돌/거부 →', e.message.split('\n')[0]);
  }

  await ctxA.close();
  fs.rmSync(base, { recursive: true, force: true });
  console.log('\n정리 완료');
}

main().catch(e => { console.error('에러:', e); process.exit(1); });
