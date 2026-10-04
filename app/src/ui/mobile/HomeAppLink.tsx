// 홈 화면 앱 연결 — 홈 화면에 붙인 앱은 QR(카메라 → 사파리)로 못 열려서, 연결된 사파리에서 새 일회용 코드를 받아 복사하고
// 홈 화면 앱에서 붙여 넣는다(PairHelp). 아이폰 사파리는 서버를 기다리는 사이 '누른 동작'이 끊기면 복사를 막아서,
// 복사할 글을 약속으로 넘기는 ClipboardItem 을 먼저 쓰고 안 되면 코드 글자 + 복사 버튼
import { useState } from 'react';
import { newPairCode } from '../../data/web';
import { groupCode } from '../../domain/mobileAuth';
import { IconCopy } from '../Icons';
import { isStandalone } from './standalone';

export function HomeAppLink() {
  const [got, setGot] = useState<{ code: string; copied: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (isStandalone()) return null;
  const make = async () => {
    setBusy(true);
    setErr(null);
    const p = newPairCode();
    try {
      let copied = false;
      try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': p.then((r) => new Blob([r.code], { type: 'text/plain' })) })]);
          copied = true;
        }
      } catch { /* 복사가 막히면 아래 복사 버튼으로 */ }
      setGot({ code: (await p).code, copied });
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === 'too soon' ? '10초 뒤에 다시 눌러 주세요' : `코드를 못 받았어요: ${m}`);
    } finally {
      setBusy(false);
    }
  };
  const copy = () => { if (got) void navigator.clipboard?.writeText(got.code).then(() => setGot({ ...got, copied: true }), () => {}); };
  return (
    <div className="m-homeapp">
      {!got && <button type="button" className="m-btn" disabled={busy} onClick={() => void make()}>홈 화면 앱 연결</button>}
      {got && (
        <>
          <div className="m-sm">{got.copied ? '연결 코드를 복사했어요.' : '연결 코드예요.'} 홈 화면의 참모 앱을 열고 '붙여넣기로 연결'을 눌러 주세요 — 10분 안에 한 번</div>
          <div className="m-code-row">
            <code className="m-code">{groupCode(got.code)}</code>
            <button type="button" className="m-icon" onClick={copy} aria-label="코드 복사" title="코드 복사"><IconCopy /></button>
          </div>
        </>
      )}
      {err && <div className="m-error">{err}</div>}
    </div>
  );
}
