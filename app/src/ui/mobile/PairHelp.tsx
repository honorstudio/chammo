// 아직 연결 안 된 화면 — 사파리는 맥 QR 을 찍으면 되지만, 홈 화면 앱은 QR 로 못 열린다. 기본은 QR 로 연 사파리에서 추가할 때 저절로(bootPair),
// 여기 왔으면 그게 안 된 것(옛 앱·10분 지남)이라 실제 순서대로 안내하고
// '붙여넣기로 연결'(클립보드) 또는 코드 입력으로 짝짓는다(연결 주소를 통째로 붙여도 코드만 뽑는다)
import { useState } from 'react';
import { pair } from '../../data/web';
import { codeFromText } from '../../domain/mobileAuth';
import { isStandalone } from './standalone';
import { BrandMark } from '../avatar';
import { tr } from '../../i18n';

export function PairHelp() {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const home = isStandalone();
  const go = async (text: string) => {
    const code = codeFromText(text);
    if (!code) { setErr(tr('연결 코드가 아니에요 — 32자 코드나 연결 주소를 붙여 넣어 주세요', "That isn't a connect code — paste the 32-character code or the connect link")); return; }
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
      setErr(tr('붙여넣기가 막혔어요 — 아래 칸을 길게 눌러 붙여 넣어 주세요', 'Pasting was blocked — long-press the field below and paste there'));
    }
  };
  return (
    <div className="m-center m-pairhelp">
      <BrandMark size={72} />
      <h1>{home ? tr('이 앱은 아직 연결 안 됐어요', "This app isn't connected yet") : tr('이 폰은 아직 연결 안 됐어요', "This phone isn't connected yet")}</h1>
      {home ? (
        <>
          <p>{tr("QR 로 연 사파리 화면에서 '홈 화면에 추가'하면 새 앱은 저절로 연결돼요. 이 앱을 이으려면", "If you tap 'Add to Home Screen' in Safari after opening the QR, the new app connects by itself. To connect this app:")}</p>
          <ol className="m-steps">
            <li>{tr("사파리에서 이미 연결된 참모를 열고, 프로필(참모 바꾸기)을 눌러 맨 아래 '홈 화면 앱 연결'을 눌러요 — 연결 코드가 복사돼요", "In Safari, open an assistant that is already connected, tap the profile (Switch assistant), then tap 'Connect home-screen app' at the bottom — the connect code is copied")}</li>
            <li>{tr("여기로 돌아와 '붙여넣기로 연결'을 눌러요", "Come back here and tap 'Connect by pasting'")}</li>
            <li>{tr("컴퓨터 앞이라면 Chammo 설정 > 기기 관리에서 '폰 연결 QR 만들기' 아래 코드를 복사해 보내도 돼요", "If you're at your computer, you can copy the code under 'Make connect QR' in Chammo Settings > Devices and send it over")}</li>
          </ol>
        </>
      ) : (
        <p>{tr("컴퓨터의 Chammo 앱 설정 > 기기 관리에서 '폰 연결 QR 만들기'를 눌러 카메라로 찍어 주세요. QR 은 10분 안에 한 번만 쓸 수 있어요. 코드를 받았다면 아래에 붙여 넣어도 돼요.", "On your computer, open Chammo Settings > Devices, tap 'Make connect QR', and scan it with your camera. The QR works once, within 10 minutes. If you got a code, you can paste it below.")}</p>
      )}
      <button type="button" className="m-send" disabled={busy} onClick={() => void paste()}>{tr('붙여넣기로 연결', 'Connect by pasting')}</button>
      <form className="m-pair-form" onSubmit={(e) => { e.preventDefault(); void go(v); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={tr('연결 코드 32자', '32-character connect code')} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={tr('연결 코드', 'Connect code')} />
        <button type="submit" className="m-btn" disabled={busy || !v.trim()}>{tr('연결', 'Connect')}</button>
      </form>
      {err && <div className="m-error">{err}</div>}
    </div>
  );
}
