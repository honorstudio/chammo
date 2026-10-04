// 아직 연결 안 된 화면 — 사파리는 맥 QR 을 찍으면 되지만, 홈 화면 앱은 QR 로 못 열린다. 실제 순서대로 안내하고
// '붙여넣기로 연결'(클립보드) 또는 코드 입력으로 짝짓는다(연결 주소를 통째로 붙여도 코드만 뽑는다)
import { useState } from 'react';
import { pair } from '../../data/web';
import { codeFromText } from '../../domain/mobileAuth';
import { isStandalone } from './standalone';
import { BrandMark } from '../avatar';

export function PairHelp() {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const home = isStandalone();
  const go = async (text: string) => {
    const code = codeFromText(text);
    if (!code) { setErr('연결 코드가 아니에요 — 32자 코드나 연결 주소를 붙여 넣어 주세요'); return; }
    setBusy(true);
    setErr(null);
    try {
      await pair(code, home);
      location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setV(t.trim());
      await go(t);
    } catch {
      setErr('붙여넣기가 막혔어요 — 아래 칸을 길게 눌러 붙여 넣어 주세요');
    }
  };
  return (
    <div className="m-center m-pairhelp">
      <BrandMark size={72} />
      <h1>이 {home ? '앱' : '폰'}은 아직 연결 안 됐어요</h1>
      {home ? (
        <ol className="m-steps">
          <li>사파리에서 이미 연결된 참모를 열고, 프사(참모 바꾸기)를 눌러 맨 아래 '홈 화면 앱 연결'을 눌러요 — 연결 코드가 복사돼요</li>
          <li>여기로 돌아와 '붙여넣기로 연결'을 눌러요</li>
          <li>맥 앞이라면 설정 &gt; 모바일에서 '폰 연결 QR 만들기' 아래 코드를 복사해 보내도 돼요</li>
        </ol>
      ) : (
        <p>맥 앱 설정 &gt; 모바일에서 '폰 연결 QR 만들기'를 눌러 카메라로 찍어 주세요. QR 은 10분 안에 한 번만 쓸 수 있어요. 코드를 받았다면 아래에 붙여 넣어도 돼요.</p>
      )}
      <button type="button" className="m-send" disabled={busy} onClick={() => void paste()}>붙여넣기로 연결</button>
      <form className="m-pair-form" onSubmit={(e) => { e.preventDefault(); void go(v); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="연결 코드 32자" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="연결 코드" />
        <button type="submit" className="m-btn" disabled={busy || !v.trim()}>연결</button>
      </form>
      {err && <div className="m-error">{err}</div>}
    </div>
  );
}
