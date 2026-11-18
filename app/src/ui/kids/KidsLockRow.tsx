// 설정 > 키즈 모드 아래 — 부모 잠금 숫자(네 자리, 잊었을 때도 여기서 다시)·하루 시간(여섯째 조각).
// 잠금을 정해야 패드에서 아이 화면을 고를 수 있다(맥이 막는다)
import { useEffect, useState } from 'react';
import { kidsApiKeyClear, kidsApiKeySet, kidsDailySet, kidsLockSet, kidsPasskeyClear, kidsRead, type KidsView } from '../../data/tauri';
import { IconTrash } from '../Icons';
import { tr } from '../../i18n';

const DAILY = [10, 15, 20, 30, 45, 60];

export function KidsLockRow() {
  const [v, setV] = useState<KidsView | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 말 앞단 Claude API 키(일곱째 조각) — 넣으면 첫 대답이 빨라지고, 없으면 지금처럼. 값은 저장 뒤 다시 안 보인다(키체인)
  const [key, setKey] = useState('');
  const [keyErr, setKeyErr] = useState<string | null>(null);
  useEffect(() => { void kidsRead().then(setV, () => {}); }, []);
  const ok = /^\d{4}$/.test(pin);
  const save = () => {
    if (!ok) return;
    setErr(null);
    kidsLockSet(pin).then((x) => { setV(x); setPin(''); setSaved(true); }, (e: unknown) => setErr(String(e)));
  };
  return (
    <div className="cfg-kids-lock">
      <div className="cfg-kids-row">
        <b>{tr('부모 잠금', 'Parent lock')}</b>
        <input value={pin} onChange={(e) => { setSaved(false); setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); }} type="password" inputMode="numeric" autoComplete="off"
          placeholder={v?.lock ? '••••' : tr('숫자 네 자리', '4 digits')} aria-label={tr('부모 잠금 숫자', 'Parent lock code')} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        <button type="button" onClick={save} disabled={!ok}>{v?.lock ? tr('바꾸기', 'Change') : tr('정하기', 'Set')}</button>
        {saved && <span className="cfg-kids-ok" role="status">{tr('저장됨', 'Saved')}</span>}
      </div>
      {err && <p className="od-err" role="alert">{err}</p>}
      <div className="cfg-kids-row">
        <b>{tr('빠른 대답', 'Fast replies')}</b>
        {v?.api
          ? <><span className="cfg-kids-ok">{tr('API 키 넣어 둠', 'API key set')}</span><button type="button" className="cfg-kids-icon" aria-label={tr('API 키 지우기', 'Remove API key')} title={tr('API 키 지우기', 'Remove API key')} onClick={() => void kidsApiKeyClear().then(setV, (e: unknown) => setKeyErr(String(e)))}><IconTrash /></button></>
          : <><input value={key} onChange={(e) => setKey(e.target.value.trim())} type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" aria-label={tr('Claude API 키', 'Claude API key')} className="cfg-kids-key" />
              <button type="button" disabled={!key.startsWith('sk-ant-')} onClick={() => { setKeyErr(null); kidsApiKeySet(key).then((x) => { setV(x); setKey(''); }, (e: unknown) => setKeyErr(String(e))); }}>{tr('넣기', 'Save')}</button></>}
      </div>
      {keyErr && <p className="od-err" role="alert">{keyErr}</p>}
      {!!v?.passkey && (
        <div className="cfg-kids-row">
          <b>{tr('얼굴로 열기', 'Face ID unlock')}</b>
          <span className="cfg-kids-ok">{tr(`패드 ${v.passkey}대`, `${v.passkey} pad${v.passkey > 1 ? 's' : ''}`)}</span>
          <button type="button" className="cfg-kids-icon" aria-label={tr('얼굴로 열기 지우기', 'Remove Face ID unlock')} title={tr('얼굴로 열기 지우기 — 숫자로만 열린다', 'Remove Face ID unlock — code only')} onClick={() => void kidsPasskeyClear().then(setV, () => {})}><IconTrash /></button>
        </div>
      )}
      <label className="cfg-kids-row">
        <b>{tr('하루 시간', 'Daily time')}</b>
        <select value={v?.daily ?? 20} onChange={(e) => void kidsDailySet(Number(e.target.value)).then(setV, () => {})} aria-label={tr('하루 시간', 'Daily time')}>
          {DAILY.map((m) => <option key={m} value={m}>{tr(`${m}분`, `${m} min`)}</option>)}
        </select>
      </label>
    </div>
  );
}
