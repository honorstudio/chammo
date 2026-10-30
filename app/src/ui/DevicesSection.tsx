// 설정 > 기기 관리 — Chammo 계정에 묶인 내 기기 한 목록(시안 device-manage A, ADR 0014). 넣기 단추 없음: 같은 계정으로 로그인하면 들어온다.
// 허용 대기 줄의 허용·거절은 그 기기 카드로 답한다(Rust direct_answer — 사람 클릭에서만, 카드와 같은 길). 이 기기 빼기 = 로그아웃.
// 테일넷으로 직접 잇기(폰 QR·다른 기기 참모)는 맨 아래 접힘 대피로
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { chammoHere, teamDeviceRename, teamDeviceRevoke, teamLogout, teamStatus, type TeamView } from '../data/teamApi';
import { hereOthers, type HereAccount } from '../domain/chammoHere';
import { mobileApi, type EntryQr } from '../data/tauri';
import { directCards } from '../domain/directAsk';
import { deviceCounts, deviceRows, pendingCardFor } from '../domain/myDevices';
import { tr } from '../i18n';
import { IconChevronDown, IconChevronUp, IconClose, IconPencil, IconRefresh, IconUnlink } from './Icons';
import { IconButton } from './kit/IconButton';
import { BetaTag } from './kit/BetaTag';
import { desktopNumber, NumberEntry, outsideHint, useCardNumber } from './e2e/NumberEntry';
import { NumberWait } from './e2e/NumberWait';

const hm = (ms: number) => { const t = new Date(ms); return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };

export function DevicesSection({ title, onAccount, fallback }: { title: string; onAccount: () => void; fallback: ReactNode }) {
  const [v, setV] = useState<TeamView | null>(null);
  const [log, setLog] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // 빼기는 그 줄 자리에서 한 번 더(창 없이)
  const [removing, setRemoving] = useState<string | null>(null);
  // 허용 대기 줄에서 '허용'을 누르면 그 자리에서 숫자 넣기(사슬 있는 계정) 또는 예전처럼 허용·거절
  const [numbering, setNumbering] = useState<string | null>(null);
  const [fold, setFold] = useState(false);
  const [phoneOff, setPhoneOff] = useState(false);
  // 폰 추가 QR — 입구 주소만. 카메라는 늘 사파리로 열어서, 짝 코드를 실으면 사파리가 써 버려 홈 화면 앱엔 안 남는다(10-24 사용자)
  const [entry, setEntry] = useState<EntryQr | null>(null);
  // 이 컴퓨터의 다른 Chammo(시험판 데이터 폴더)가 어느 계정에 붙어 있나 — 홈 폴더를 읽어서 열 때·다시 받기 때만
  const [here, setHere] = useState<HereAccount[]>([]);
  const loadHere = () => void chammoHere().then(setHere, () => {});
  // 로그인 화면 단계(Rust e2e_self_step) — outside(허용됐지만 사슬 밖)면 대기 기기처럼 숫자 칸을 여기서도 다시 본다
  const [step, setStep] = useState('');

  const load = () => {
    void teamStatus().then(setV, (e: unknown) => setErr(String(e)));
    void invoke<string>('direct_log').then(setLog, () => {});
    void mobileApi.status().then((m) => setPhoneOff(!!m.off), () => {});
    void invoke<string>('e2e_self_step').then(setStep, () => {});
  };
  useEffect(() => {
    load();
    loadHere();
    // 다른 기기에서 허용·거절하면 앱이 목록을 다시 받는다(1분·알림) — 화면도 따라가게
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);
  const act = (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    void f().then(() => { setRenaming(null); setRemoving(null); load(); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const cards = useMemo(() => directCards(log, { alive: () => true, prompt: () => undefined, reply: () => undefined }), [log]);
  const acc = v?.account ?? null;
  const list = v?.devices ?? [];
  const rows = deviceRows(list, Date.now());
  const n = deviceCounts(list);
  const others = hereOthers(here, acc?.email ?? '');
  // 사람 클릭만 — 스크립트가 만든 클릭은 무시(카드와 같은 문)
  const decide = (e: React.MouseEvent, card: string, yes: boolean) => {
    if (!e.nativeEvent.isTrusted || busy) return;
    act(() => invoke('direct_answer', { id: card, pick: { pick: yes ? 'yes' : 'no' } }));
  };

  return (
    <>
      <section className="su-sec">
        <div className="su-sec-head">
          <div className="su-title"><h2>{title}</h2><BetaTag /></div>
          {acc && <IconButton size="l" tone="line" label={tr('다시 받기', 'Refresh')} disabled={busy} onClick={() => { load(); loadHere(); }}><IconRefresh /></IconButton>}
        </div>
        {v && !acc && (
          <>
            <p className="su-hint">{tr('Chammo 계정으로 로그인하면 컴퓨터와 폰이 한 목록에 모여요. 다른 기기도 같은 계정으로 로그인하세요', 'Sign in to your Chammo account and your computers and phones show up here. Sign in with the same account on each device.')}</p>
            <div className="su-inline"><button className="btn pri" onClick={onAccount}>{tr('Chammo 계정에 로그인', 'Sign in to Chammo account')}</button></div>
          </>
        )}
        {acc && (v?.pending || step === 'outside') && (
          <div className="dm-wait">
            {/* 숫자 넣기 허용(chammo-relay ADR 0007, 시안 e2e-approve v1) — 다른 기기에서 카드를 열면 숫자가 뜬다 */}
            <NumberWait>
              {/* 대기 기기는 기기 목록을 못 받아(403) 아래 줄의 로그아웃이 안 보인다 — 여기서 빠져나간다(10-26 아이맥) */}
              <button className="btn" disabled={busy} onClick={(e) => { if (e.nativeEvent.isTrusted) act(() => teamLogout()); }}>{tr('로그인 취소', 'Cancel sign-in')}</button>
            </NumberWait>
            {v?.pendingAutoAt ? <span>{tr(`${hm(v.pendingAutoAt)}까지 거절이 없으면 접속은 열리지만, 메시지는 숫자 확인 뒤에 읽어요.`, `If nobody declines by ${hm(v.pendingAutoAt)} it can connect, but messages need the number check.`)}</span> : null}
          </div>
        )}
        {acc && !v?.pending && !phoneOff && (entry ? (
          <div className="su-mobile">
            {entry.qrSvg && <img className="su-qr" alt={tr('폰 추가 QR', 'Add phone QR')} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.qrSvg)}`} />}
            <div className="su-mobile-side">
              <b>{tr('폰 카메라로 찍어 주세요', 'Scan with the phone camera')}</b>
              <span className="su-hint">{tr('홈 화면에 추가(사파리, 안드로이드는 크롬)한 뒤 앱을 열어 구글로 로그인하고, 이 컴퓨터를 고르세요. 양쪽에 뜬 숫자가 같은지 확인해요',
                'Add to Home Screen (Safari, or Chrome on Android), open the app and sign in with Google, then pick this computer. Check the number matches on both')}</span>
              <div className="su-inline"><IconButton size="l" tone="line" label={tr('닫기', 'Close')} onClick={() => setEntry(null)}><IconClose /></IconButton></div>
            </div>
          </div>
        ) : (
          <div className="su-inline"><button className="btn" onClick={() => void mobileApi.entryQr().then(setEntry, (e: unknown) => setErr(String(e)))}>{tr('폰 추가', 'Add phone')}</button></div>
        ))}
        {acc && phoneOff && <span className="su-hint">{tr('이 컴퓨터는 폰을 받지 않아요 — 아래 테일스케일로 직접 잇기의 폰 연결을 켜면 받아요', 'This computer does not accept phones — turn on phone connection below to allow it')}</span>}
        {acc && (
          <>
            {/* 기기 목록이 비었으면(허용 대기·확인 중 403) '이 기기' 줄의 로그아웃이 없다 — 따로 둔다(10-26 아이맥) */}
            {!rows.some((r) => r.me) && (removing === 'self' ? (
              <div className="su-row dev-row dm-confirm">
                <span>{tr('이 기기에서 로그아웃할까요? 다시 쓰려면 다시 로그인해요', 'Sign out of this device? Sign in again to use it')}</span>
                <button className="btn danger" disabled={busy} onClick={(e) => { if (e.nativeEvent.isTrusted) act(() => teamLogout()); }}>{tr('로그아웃', 'Sign out')}</button>
                <button className="btn" onClick={() => setRemoving(null)}>{tr('취소', 'Cancel')}</button>
              </div>
            ) : (
              <div className="su-inline"><button className="peer-alt" onClick={() => setRemoving('self')}>{tr('이 기기 로그아웃', 'Sign out of this device')}</button></div>
            ))}
            <div className="dm-acct"><span>{tr(`${acc.email || acc.name} 계정`, `${acc.email || acc.name} account`)}</span><span>{tr(`폰 ${n.phones} · 컴퓨터 ${n.computers}`, `${n.phones} phone(s) · ${n.computers} computer(s)`)}</span></div>
            <div className="su-rows">
              {rows.map((r) => {
                const card = r.pending ? pendingCardFor(cards, r.id) : undefined;
                if (removing === r.id) {
                  return (
                    <div key={r.id} className="su-row dev-row dm-confirm">
                      <span>{r.me ? tr('이 기기에서 로그아웃할까요? 다시 쓰려면 다시 로그인해요', 'Sign out of this device? Sign in again to use it') : tr(`${r.name} 를 뺄까요? 그 기기는 로그아웃되고 이 계정 참모와 말을 못 해요`, `Remove ${r.name}? It is signed out and can no longer talk to this account's assistants`)}</span>
                      <button className="btn danger" disabled={busy} onClick={(e) => { if (e.nativeEvent.isTrusted) act(() => (r.me ? teamLogout() : teamDeviceRevoke(r.id))); }}>{r.me ? tr('로그아웃', 'Sign out') : tr('정말 빼기', 'Remove now')}</button>
                      <button className="btn" onClick={() => setRemoving(null)}>{tr('취소', 'Cancel')}</button>
                    </div>
                  );
                }
                if (renaming === r.id) {
                  return (
                    <div key={r.id} className="su-row dev-row">
                      <div className="su-inline">
                        <input autoFocus autoComplete="off" aria-label={tr('기기 이름', 'Device name')} value={newName} onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) act(() => teamDeviceRename(r.id, newName)); if (e.key === 'Escape') setRenaming(null); }} />
                        <button className="btn pri" disabled={busy || !newName.trim()} onClick={() => act(() => teamDeviceRename(r.id, newName))}>{tr('저장', 'Save')}</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={r.id} className="su-row dev-row">
                    <div className="su-row-text">
                      <b title={r.name}>{r.name}{r.me && <span className="dm-me">{tr('이 기기', 'This device')}</span>}</b>
                      <span><i className={`dm-dot${r.online ? ' on' : ''}${r.pending ? ' wait' : ''}`} />{r.meta}</span>
                    </div>
                    {/* 허용하고 4자리를 띄운 줄은 대기가 끝나도 그대로(R7) */}
                    {(r.pending || numbering === r.id) && !v?.pending ? (
                      card
                        ? numbering === r.id
                          ? <DeviceNumber dev={r.id} decide={(e, yes) => decide(e, card, yes)} busy={busy} onDone={() => { setNumbering(null); load(); }} />
                          : <><button className="btn su-row-act" disabled={busy} onClick={(e) => decide(e, card, false)}>{tr('거절', 'Decline')}</button><button className="btn pri su-row-act" disabled={busy} onClick={() => setNumbering(r.id)}>{tr('허용', 'Allow')}</button></>
                        : <span className="su-hint">{tr('카드 받는 중…', 'Loading card…')}</span>
                    ) : v?.pending && !r.me ? null : (
                      <>
                        {!r.pending && <IconButton size="m" tone="line" label={tr(`${r.name} 이름 바꾸기`, `Rename ${r.name}`)} disabled={busy} onClick={() => { setRenaming(r.id); setNewName(r.name); }}><IconPencil /></IconButton>}
                        <button className="ib danger su-row-act" aria-label={r.me ? tr('이 기기 빼기(로그아웃)', 'Remove this device (sign out)') : tr(`${r.name} 빼기`, `Remove ${r.name}`)} title={r.me ? tr('이 기기 빼기(로그아웃)', 'Remove this device (sign out)') : tr('빼기', 'Remove')} disabled={busy} onClick={() => setRemoving(r.id)}><IconUnlink /></button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {others.length > 0 && (
          <>
            <div className="dm-acct"><span>{tr('이 컴퓨터의 다른 Chammo', 'Other Chammo on this computer')}</span><span>{tr('데이터 폴더별 계정', 'Account per data folder')}</span></div>
            <div className="su-rows">
              {others.map((o) => (
                <div key={o.folder} className="su-row dev-row">
                  <div className="su-row-text">
                    <b title={o.folder}>{o.folder}</b>
                    <span>{o.who}{o.other && <> · <span className="acct-st-out">{tr('다른 계정', 'Another account')}</span></>}</span>
                  </div>
                </div>
              ))}
            </div>
            <span className="su-hint">{tr('끊으려면 그 계정 기기 관리에서 빼거나 그 앱을 켜서 로그아웃해요', "To disconnect, remove it in that account's device list or sign out in that app")}</span>
          </>
        )}
        {err && <div className="su-error">{err}</div>}
      </section>
      <section className="su-sec">
        <div className="su-sec-head">
          <div className="su-title"><h2 className="dm-fold-h">{tr('테일스케일로 직접 잇기', 'Connect directly over Tailscale')}</h2><BetaTag /></div>
          <IconButton size="l" tone="line" label={fold ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')} pressed={fold} onClick={() => setFold(!fold)}>{fold ? <IconChevronUp /> : <IconChevronDown />}</IconButton>
        </div>
        {!fold && <span className="su-hint">{tr('계정 없이, 또는 옛 버전 기기와 연결해요(폰 QR, 같은 테일넷의 다른 기기)', 'Without an account, or with older versions: phone QR and Chammo on your tailnet')}</span>}
      </section>
      {fold && fallback}
    </>
  );
}

/** 기기 관리 줄의 허용 — 사슬 있는 계정은 새 기기 화면 숫자 넣기, 아니면 예전처럼 허용·거절(카드와 같은 길) */
function DeviceNumber({ dev, decide, busy, onDone }: { dev: string; decide: (e: React.MouseEvent, yes: boolean) => void; busy: boolean; onDone: () => void }) {
  const num = useCardNumber(dev, desktopNumber);
  if (num.mode === 'loading') return <span className="su-hint">{tr('확인 중…', 'Checking…')}</span>;
  if (num.mode === 'outside') return <span className="su-hint">{outsideHint()}</span>;
  if (num.mode === 'click') {
    return <><button className="btn su-row-act" disabled={busy} onClick={(e) => decide(e, false)}>{tr('거절', 'Decline')}</button><button className="btn pri su-row-act" disabled={busy} onClick={(e) => decide(e, true)}>{tr('허용', 'Allow')}</button></>;
  }
  return <div className="dm-number"><NumberEntry dev={dev} api={desktopNumber} ready={num.ready} mine={num.mine} claim={num.claim} note={num.err} code={num.code} decline={(e) => decide(e, false)} onDone={onDone} /></div>;
}
