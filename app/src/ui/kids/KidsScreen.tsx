// 아이패드 키즈 화면 뼈대(1단계 셋째 조각, 시안 docs/design-drafts/kids-mode/screen-v3 · 계획서 C '화면'·D '말 시작·끝').
// 매트(참모 색에 맞춘 초록/남색 격자) 위에 종이(그림 카드)와 참모 캐릭터. 캐릭터를 누르는 순간 움직이고(0초 반응),
// 톡 한 번 = 바로 듣기(목소리, useKidVoice — 11-17 사용자 "꾹 누르고 있어야 대화 시작이네? 애들이 못 쓸 것 같아"). 맥 목소리를 못 쓰거나
// 마이크를 못 열면(맥 미리보기 포함) 톡 한 번에 글 칸. 답은 캐릭터 목소리 + 말풍선 + 종이(지금은 미리 그린 크레용 자리만).
// 나가기는 다음 조각(부모 잠금) 전까지 오른쪽 위 구석 3초 — 아이 눈엔 흐린 점 하나
import { useCallback, useEffect, useRef, useState } from 'react';
import { kidLook, pickReply, type KidLook, type PadRow } from '../../domain/kidsLook';
import { tr } from '../../i18n';
import { KidChar, type KidState } from './KidChar';
import { useKidVoice, type KidsVoiceApi } from './useKidVoice';
import { KidsPin, type KidsPasskeyApi, type LeaveResult } from './KidsPin';
import { PRE } from './kidsVoice';
import './kids.css';

/** voice = 맥 받아쓰기·목소리를 쓸 수 있나, voiceMode = 숨은 스위치(tap 기본 · hold) */
export type KidsTime = { usedMs: number; limitMs: number; leftMs: number };
export type KidsMe = { key: string; on: boolean; child?: string; avatar?: unknown; voice?: boolean; voiceMode?: 'tap' | 'hold'; time?: KidsTime; passkey?: boolean; turn?: { peekMs?: number; unsureMs?: number; moreMs?: number; speechLevel?: number } };
/** 패드(/api/kids/*)·맥 미리보기(앱 명령)가 같은 화면을 쓰게 — voice 가 없으면 글 칸 */
export type KidsApi = {
  me: () => Promise<KidsMe>; say: (text: string, cid: string) => Promise<void>; log: () => Promise<PadRow[]>; voice?: KidsVoiceApi;
  /** 나가기 — 패드는 보호자 숫자를 맥이 확인한다. pinless = 숫자 없이(맥 미리보기 — 보는 사람이 이미 보호자) */
  leave: (pin?: string) => Promise<LeaveResult>; pinless?: boolean;
  /** 아이 화면이 보이는 동안 30초마다 — 오늘 쓴 시간(여섯째 조각) */
  tick?: () => Promise<KidsTime>;
  /** 작품(다섯째 조각) — 최근 바뀐 것부터 · 한 작품 HTML(맥이 CSP 머리를 붙여 준다) */
  works?: () => Promise<KidsWork[]>; work?: (name: string) => Promise<string>;
  /** 패스키 나가기(일곱째 조각) — 패드만, 이 기기가 될 때만 숫자판에 얼굴 칸 */
  passkey?: KidsPasskeyApi;
};
export type KidsWork = { name: string; title: string; mtime: number };

const LEAVE_MS = 3000;
/** 마무리 인사("오늘은 여기까지 하자.")가 끝날 만큼 — 오늘 작품이 없어도 이만큼은 머문 뒤 "잘 자"(두 말이 겹치지 않게) */
const BYE_MIN_MS = 2500;
const WAIT_MAX_MS = 120_000;
const newCid = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 작품 칸 — 인터넷 0(맥이 붙인 CSP + iframe sandbox: 스크립트만, 같은 출처·폼·창 열기 없음). 파일이 바뀌면 새 글로 다시 그린다 */
function WorkFrame({ html, title }: { html: string; title: string }) {
  return <iframe className="kz-work" sandbox="allow-scripts" srcDoc={html} title={title} />;
}

/** 종이 위 크레용 물결 — 답이 왔는데 작품이 아직 없을 때·만드는 중(drawing = 그려지는 움직임) */
function CrayonWave({ drawing = false }: { drawing?: boolean }) {
  const pts = Array.from({ length: 49 }, (_, i) => {
    const x = 60 + i * 12.5, amp = 22 + 30 * Math.sin((i / 48) * Math.PI);
    return `${x.toFixed(1)} ${(150 + amp * Math.sin(i * 1.15)).toFixed(1)}`;
  });
  return (
    <svg className={drawing ? 'kz-wave kz-drawing' : 'kz-wave'} viewBox="0 0 720 300" aria-hidden="true">
      <path d={`M${pts.join('L')}`} fill="none" stroke="#ff9a6a" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
    </svg>
  );
}

export function KidsScreen({ api, preview = false }: { api: KidsApi; preview?: boolean }) {
  const [me, setMe] = useState<KidsMe | null>(null);
  const [look, setLook] = useState<KidLook | null>(null);
  const [state, setState] = useState<KidState>('idle');
  const [reply, setReply] = useState<PadRow | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [leaving, setLeaving] = useState(false);
  const waitFrom = useRef(0); // 보낸 때 — 그 뒤 답을 기다린다
  const seen = useRef(-1); // 마지막으로 보여 준 답(-1 = 아직 안 읽음)
  const [noMic, setNoMic] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  // 하루 시간 — 다 되면 마무리 장면(인사 → 오늘 만든 것 → 잘 자) 뒤 잠든 화면. 부모가 더하면 다시 깬다
  const [left, setLeft] = useState<number | null>(null);
  const [closing, setClosing] = useState<'' | 'bye' | 'done'>('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []); // StrictMode 두 번 붙이기에도 다시 true
  // 지금 작품 — 최근 바뀐 작품을 종이에(만드는 중엔 1초마다 보고 바뀌면 다시 그린다)
  const [work, setWork] = useState<{ name: string; title: string; mtime: number; html: string } | null>(null);
  const workRef = useRef(work);
  workRef.current = work;
  const busyRef = useRef(false);
  const talkT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let first = true;
    const read = () => void api.me().then((m) => {
      if (!live) return;
      setMe(m);
      setLook(kidLook(m.key, m.avatar));
      // 화면이 켜지면 먼저 인사(폴짝) 하고 '톡 하면 듣는' 채로 기다린다 — 마이크는 안 연다(늘 열린 마이크 안 씀, 계획서 D)
      if (first && m.on) { first = false; setState('joy'); setTimeout(() => setState((s) => (s === 'joy' ? 'idle' : s)), 800); }
    }).catch(() => {});
    read();
    const i = setInterval(read, 30_000);
    return () => { live = false; clearInterval(i); };
  }, [api]);

  const asleep = (!!me && !me.on) || closing === 'done';
  const voiceOn = !!me?.voice && !!api.voice && !noMic;
  // 답 뒤 계속 듣기는 아이 화면이 떠 있을 때만(잠듦·마무리 장면·글 칸이면 멈춤)
  const voice = useKidVoice(api.voice, voiceOn, me?.voiceMode === 'hold' ? 'hold' : 'tap', setState, useCallback(() => { setNoMic(true); setTyping(true); }, []), me?.turn, !asleep && !closing && !typing);
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;
  busyRef.current = state === 'think' || state === 'talk' || state === 'listen';
  useEffect(() => {
    if (!me?.on || !api.works || !api.work) return;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    let hot = 0; // 말한 뒤 2분은 1초마다(만들기 세션이 계속 고쳐 저장한다)
    const pull = async () => {
      try {
        if (busyRef.current) hot = Date.now();
        const w = (await api.works!())[0];
        const cur = workRef.current;
        if (live && w && (!cur || cur.name !== w.name || cur.mtime !== w.mtime)) {
          const html = await api.work!(w.name);
          if (live) setWork({ ...w, html });
        }
      } catch { /* 다음 차례에 */ }
      if (live) t = setTimeout(pull, Date.now() - hot < 120_000 ? 1000 : 4000);
    };
    void pull();
    return () => { live = false; clearTimeout(t); };
  }, [api, me?.on]);
  // 답 읽기 — 기다리는 동안 1.2초, 아니면 4초
  useEffect(() => {
    if (!me?.on) return;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const pull = async () => {
      try {
        const rows = await api.log();
        if (!live) return;
        // 처음 읽을 땐 옛 답을 다시 말하지 않는다(그때까지의 마지막 답을 본 것으로)
        if (seen.current < 0) { seen.current = rows.reduce((m, r) => (r.who === 'assistant' ? Math.max(m, r.ts) : m), 0); if (live) t = setTimeout(pull, 1200); return; }
        const r = pickReply(rows, seen.current);
        if (r && r.ts > seen.current) {
          seen.current = r.ts;
          waitFrom.current = 0;
          setReply(r);
          if (voiceRef.current) { if (live) t = setTimeout(pull, 1200); return; } // 목소리면 몸짓은 소리를 따라간다(useKidVoice)
          setState('talk');
          clearTimeout(talkT.current);
          talkT.current = setTimeout(() => setState((s) => (s === 'talk' ? 'idle' : s)), Math.min(2500 + r.text.length * 70, 9000));
        } else if (waitFrom.current && Date.now() - waitFrom.current > WAIT_MAX_MS) {
          waitFrom.current = 0;
          setState((s) => (s === 'think' ? 'idle' : s));
        }
      } catch { /* 망 오류 — 다음 차례에 */ }
      if (live) t = setTimeout(pull, waitFrom.current ? 1200 : 4000);
    };
    void pull();
    return () => { live = false; clearTimeout(t); };
  }, [api, me?.on]);

  // 캐릭터 — 누르는 순간 몸짓(0초 반응)과 함께 바로 듣기(목소리) 또는 글 칸(목소리를 못 쓸 때)
  const down = () => {
    if (asleep || typing) return;
    if (voice.down()) return;
    setState('listen');
    setTyping(true);
  };
  const up = () => voice.up();
  const send = useCallback(async () => {
    const t = text.trim();
    if (!t) return;
    setTyping(false);
    setText('');
    waitFrom.current = Date.now();
    setState('think');
    try { await api.say(t, newCid()); } catch { waitFrom.current = 0; setState('idle'); }
  }, [api, text]);
  const closeTyping = () => { setTyping(false); setState((s) => (s === 'listen' ? 'idle' : s)); };

  // 하루 시간 — 보이는 동안 30초마다 맥에 알린다(빈틈은 맥이 안 센다)
  useEffect(() => {
    if (!me?.on || !api.tick) return;
    if (me.time) setLeft(me.time.leftMs);
    const go = () => { if (document.visibilityState === 'visible') void api.tick!().then((u) => setLeft(u.leftMs), () => {}); };
    go();
    const i = setInterval(go, 30_000);
    return () => clearInterval(i);
  }, [api, me?.on, me?.time]);
  // 다 되면 — 말하던 건 마치고(갑자기 끊지 않기) 마무리 장면
  useEffect(() => {
    if (left === null) return;
    if (left > 0) { if (closing === 'done') { setClosing(''); setState('idle'); } return; }
    if (closing || (state !== 'idle' && state !== 'joy')) return;
    setClosing('bye');
    // 장면은 한 번 시작하면 끝까지 — 이 효과가 state 바뀜으로 다시 돌아도 끊지 않는다(화면이 닫힐 때만 멈춤)
    const live = () => mounted.current;
    void (async () => {
      const byeAt = Date.now();
      voice.say(PRE.today); // "오늘은 여기까지 하자."
      setState('joy');
      // 오늘 만든 작품을 짧게(3개까지, 2.5초씩)
      try {
        const start = new Date().setHours(0, 0, 0, 0);
        const today = (await api.works?.() ?? []).filter((w) => w.mtime >= start).slice(0, 3);
        for (const w of today) {
          if (!live()) return;
          const html = await api.work!(w.name);
          setWork({ ...w, html });
          await new Promise((r) => setTimeout(r, 2500));
        }
      } catch { /* 작품이 없어도 마무리는 한다 */ }
      const rest = BYE_MIN_MS - (Date.now() - byeAt);
      if (rest > 0) await new Promise((r) => setTimeout(r, rest));
      if (!live()) return;
      voice.say(PRE.night); // "잘 자, 내일 또 만들자."
      setState('sleep');
      setClosing('done');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, state]);

  // 보호자 나가기 — 구석 3초 → 숫자판(맥이 확인), 맥 미리보기는 바로 닫기
  const leaveDown = () => { setLeaving(true); leaveT.current = setTimeout(() => { setLeaving(false); if (api.pinless) void api.leave(); else setPinOpen(true); }, LEAVE_MS); };
  const leaveUp = () => { setLeaving(false); clearTimeout(leaveT.current); };
  useEffect(() => () => { clearTimeout(talkT.current); clearTimeout(leaveT.current); }, []);

  const shown = asleep ? 'sleep' : state;
  return (
    <div className={`kz${asleep ? ' kz-asleep' : ''}${preview ? ' kz-preview' : ''}`} data-closing={closing || undefined} style={{ ['--kz-mat' as string]: look?.mat ?? '#3e8e6b' }} data-mat={look?.mat === '#2b3560' ? 'navy' : 'green'} data-state={shown}>
      <div className="kz-paper">{!asleep && (work ? <WorkFrame key={work.name} html={work.html} title={work.title} /> : state === 'think' ? <CrayonWave drawing /> : reply && <CrayonWave />)}</div>
      <div className="kz-crayons" aria-hidden="true">
        {['#ff7b3a', '#ffcc3d', '#4cbd68', '#2f74e0', '#ef4a4a'].map((c, i) => <i key={c} style={{ background: c, transform: `rotate(${[-8, 4, -3, 7, -5][i]}deg)` }} />)}
      </div>
      {reply && !asleep && state !== 'think' && <div className="kz-bubble" role="status">{reply.text}</div>}
      {look && (
        <button type="button" className="kz-char" aria-label={tr('톡 눌러서 말하기', 'Tap to talk')} disabled={asleep}
          onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}>
          <KidChar shape={look.shape} eyes={look.eyes} color={look.color} state={shown} />
        </button>
      )}
      {typing && (
        <div className="kz-type" onPointerDown={(e) => { if (e.target === e.currentTarget) closeTyping(); }}>
          <form className="kz-type-box" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label={tr('아이 말', "Child's words")} enterKeyHint="send" />
            <button type="submit" className="kz-send" disabled={!text.trim()} aria-label={tr('보내기', 'Send')} title={tr('보내기', 'Send')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </div>
      )}
      {pinOpen && <KidsPin onTry={(pin) => api.leave(pin)} onClose={() => setPinOpen(false)} passkey={api.passkey ? { api: api.passkey, registered: !!me?.passkey } : undefined} />}
      <div className={`kz-corner${leaving ? ' kz-leaving' : ''}`} aria-label={tr('보호자 나가기 — 3초 길게', 'Guardian exit — hold 3 seconds')}
        onPointerDown={leaveDown} onPointerUp={leaveUp} onPointerLeave={leaveUp} onPointerCancel={leaveUp} onContextMenu={(e) => e.preventDefault()}>
        <span className="kz-corner-dot" />
        <svg className="kz-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="rgba(255,255,255,.22)" /><circle className="kz-ring-fill" cx="32" cy="32" r="22" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 32 32)" /></svg>
      </div>
    </div>
  );
}
