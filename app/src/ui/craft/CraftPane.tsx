// Craft 맥 앱 칸 — 스페이스 탭(기본, place="space")과 따로 창(craft.html, place="window")이 같이 쓴다.
// 머리줄 ①(이름·판·저장 상태 + 개입·자리 옮기기·닫기 — 꺼내기는 따로 창 아이콘과 헷갈려(10/16 실사용) 탭 오른쪽 클릭 메뉴에 글자로) · 가운데 칸(네이티브 비추기가 위에 얹힌다) · 아래 줄(참모가 한 일).
// 칸은 비워 두고 비추기가 안 될 때만 안내(Swift 뷰는 첫 프레임 전엔 숨어 있어 이 글이 보인다). 사람 입력은 잠금 — 개입을 누르면 그 앱 조작 채널로 넘어가고(craft_input), 돌려주면 바뀐 것이 참모 입력칸으로.
// 스페이스 탭이면 칸 자리·보이는지를 매 프레임 재서 바뀔 때만 Rust 에 알린다(WebPage 미리보기와 같은 길) — 따로 창은 Rust 가 머리줄·아래 줄 높이로 안다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { doingLine, mirrorNote, paneShotDue, saveState, takeButton, type CraftInfo } from '../../domain/craftWin';
import { IS_WIN } from '../../domain/reader';
import { boxOf, COVERS, shown } from '../../domain/craftTab';
import { usePanePlace } from '../space/panePlace';
import { IconClose, IconDockIn, IconPower, IconSettings, IconWindowOut } from '../Icons';
import { askPermission } from '../../data/tauri';
import './craft.css';

const EMPTY: CraftInfo = { name: '', version: '', pid: null, last: '', dirty: false, mirror: 'waiting', takeover: false, place: '' };

/** 스페이스 탭 칸 자리 알리기 — 답이 "window" 면 따로 창에 떠 있다(여긴 안내만). 몸통은 세션 브라우저 칸과 같이 쓴다(ui/space/panePlace) */
function useSpacePlace(app: string, on: boolean, stage: React.RefObject<HTMLElement | null>) {
  const { answer, still } = usePanePlace(on, stage, {
    place: (rect, vh, visible) => invoke<string>('craft_space_place', { app, rect, vh, visible }),
    still: () => invoke<string>('craft_space_still', { app }),
    detach: () => void invoke('craft_space_detach', { app }).catch(() => {}),
  }, app);
  return { elsewhere: answer === 'window', still };
}

/** 윈도우 칸 그림 — 맥 비추기 대신 그 앱 조작 채널 그림(craft_pane_shot)을 보는 중에만 1초에 한 번 이하, 참모 일이 바뀌면 바로(paneShotDue) */
function usePaneShot(app: string, info: CraftInfo, stage: React.RefObject<HTMLElement | null>) {
  const [pic, setPic] = useState('');
  const now = useRef(info);
  now.current = info;
  useEffect(() => {
    if (!IS_WIN) return;
    const r = { inFlight: false, lastAt: 0, shotLast: '\u0000' };
    const t = setInterval(() => {
      const i = now.current;
      const el = stage.current;
      const visible = !!el && shown(boxOf(el.getBoundingClientRect()), !!document.querySelector(COVERS));
      if (!paneShotDue({ mirror: String(i.mirror), visible, docVisible: document.visibilityState === 'visible', takeover: i.takeover, inFlight: r.inFlight, lastAt: r.lastAt, now: Date.now(), last: i.last, shotLast: r.shotLast })) return;
      r.inFlight = true;
      r.lastAt = Date.now();
      const last = i.last;
      void invoke<string>('craft_pane_shot', { app }).then((u) => { if (u) setPic(u); r.shotLast = last; }, () => {}).finally(() => { r.inFlight = false; });
    }, 250);
    return () => clearInterval(t);
  }, [app, stage]);
  return pic;
}

/** app = 인스턴스 키('photocraft-2' 도), whoOf = 띄운 세션 id → 별명(스페이스만 — 따로 창은 세션 목록이 없어 대표 참모 이름) */
export function CraftPane({ app, place, whoOf }: { app: string; place: 'space' | 'window'; whoOf?: (by?: string) => string | undefined }) {
  const [info, setInfo] = useState<CraftInfo>(EMPTY);
  const stage = useRef<HTMLElement | null>(null);
  const { elsewhere, still } = useSpacePlace(app, place === 'space', stage);
  useEffect(() => {
    let alive = true;
    const tick = () => void invoke<CraftInfo>('craft_win_info', { app }).then((i) => alive && setInfo(i), () => {});
    tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [app]);
  const pic = usePaneShot(app, info, stage);

  const hide = () => void invoke('craft_hide', { app }).catch(() => {}); // 닫기 = 탭(창)만 닫기 — 앱은 독에 남는다
  // 끄기(v7 B1·B3) — 바뀐 게 있으면 저장하고 끈다, 누르면 '저장하고 끄는 중'(꺼지면 칸이 닫힌다)
  const [quitting, setQuitting] = useState(false);
  const quit = () => { setQuitting(true); void invoke('craft_win_act', { app, act: 'close' }).catch(() => setQuitting(false)); };
  const quitLabel = tr('끄기 — 바뀐 게 있으면 저장하고', 'Quit — saves first if anything changed');
  const save = saveState(info);
  const take = takeButton(info);
  // 개입은 진짜 창을 칸 자리로 옮긴다(손쉬운 사용) — 허용이 없으면 맥 권한 창 대신 칸 안 카드 한 번, 켜지면 저절로 개입(2026-10-19)
  const [needAx, setNeedAx] = useState(false);
  useEffect(() => {
    if (!needAx) return;
    const t = setInterval(() => void invoke<boolean>('ax_trusted').then((ok) => { if (ok) { setNeedAx(false); start(); } }, () => {}), 1000);
    return () => clearInterval(t);
  }, [needAx]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => {
    setInfo((i) => ({ ...i, takeover: true }));
    void invoke('craft_win_takeover', { app, on: true }).catch(() => {});
  };
  const flip = () => {
    if (take.on) {
      void invoke<boolean>('ax_trusted').then((ok) => (ok ? start() : setNeedAx(true)), start);
      return;
    }
    setInfo((i) => ({ ...i, takeover: false }));
    void invoke('craft_win_takeover', { app, on: false }).catch(() => {});
  };
  const note = elsewhere ? null : info.mirror === 'shot' && !pic ? { text: tr('앱 화면을 받는 중…', 'Getting the app screen…'), settings: false } : mirrorNote(info);
  const who = whoOf?.(info.by);
  const move = () => void invoke('craft_move', { app, to: place === 'space' ? 'window' : 'space' }).catch(() => {});
  const moveLabel = place === 'space' ? tr('따로 창으로', 'Open in its own window') : tr('스페이스로 옮기기', 'Move into the space');
  const closeLabel = tr('닫기 — 앱은 독에 남아요(10분 안 다시 안 열면 저장하고 꺼요)', 'Close — the app stays in the dock (saved and quit after 10 minutes)');

  return (
    <div className="cw">
      <header className="cw-head">
        <b className="cw-name">{info.name}</b>
        {who && <span className="cw-who">{who}</span>}
        {info.version && <span className="cw-ver">{info.version}</span>}
        <span className="cw-sep" />
        {quitting ? <span className="cw-save cw-quitting"><span className="cw-spin" aria-hidden="true" />{tr('저장하고 끄는 중', 'Saving and quitting')}</span>
          : <span className={`cw-save${save.dirty ? ' dirty' : ''}`}><i />{save.text}</span>}
        <span className="cw-sp" />
        {info.pid != null && (
          <button className={`cw-take${info.takeover ? ' on' : ''}`} onClick={flip}
            title={info.takeover ? undefined : tr('직접 조작 — 그동안 참모는 이 앱 일을 멈춰요', 'Take control — the assistant pauses its work in this app')}>{take.text}</button>
        )}
        <button className="ib" onClick={move} aria-label={moveLabel} title={moveLabel}>{place === 'space' ? <IconWindowOut /> : <IconDockIn />}</button>
        {info.pid != null && <button className="ib" onClick={quit} disabled={quitting} aria-label={quitLabel} title={quitLabel}><IconPower /></button>}
        <button className="ib" onClick={hide} aria-label={closeLabel} title={closeLabel}><IconClose /></button>
      </header>
      {/* 칸 안에 두면 위에 얹힌 비추기 층에 가린다 — 머리줄 아래 띠로(칸이 그만큼 줄고 비추기가 다시 맞춘다) */}
      {needAx && (
          <div className="cw-axbar">
            <span>{tr('직접 손대려면 손쉬운 사용 허용이 한 번 필요해요 — 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 Chammo 를 켜면 바로 이어져요', 'Taking over needs Accessibility once — turn on Chammo in System Settings > Privacy & Security > Accessibility and it continues right away')}</span>
            <span className="cw-ax-acts">
              <button className="ib" aria-label={tr('설정 열기', 'Open Settings')} title={tr('맥 설정 열기 — 손쉬운 사용', 'Open macOS Settings — Accessibility')} onClick={() => void askPermission('ax').catch(() => {})}><IconSettings /></button>
              <button className="ib" aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')} onClick={() => setNeedAx(false)}><IconClose /></button>
            </span>
          </div>
        )}
      <main className="cw-stage" ref={stage}>
        {pic && !elsewhere && <img className="cw-still cw-pane" src={pic} alt="" />}
        {still && !elsewhere && <img className="cw-still" src={still} alt="" />}
        {elsewhere && (
          <div className="cw-note">
            <span>{tr('따로 창에 떠 있어요', 'It is open in its own window')}</span>
            <button className="cw-btn" onClick={() => void invoke('craft_move', { app, to: 'space' }).catch(() => {})}>{tr('여기로 가져오기', 'Bring it here')}</button>
          </div>
        )}
        {note && (
          <div className="cw-note">
            <span>{note.text}</span>
            {note.settings && (
              <button className="cw-btn" onClick={() => void askPermission('screen').catch(() => {})}>{tr('권한 열기', 'Open settings')}</button>
            )}
          </div>
        )}
      </main>
      <footer className={`cw-doing${info.pid != null ? ' busy' : ''}${info.takeover ? ' taking' : ''}`}><span>{doingLine(info, who)}</span></footer>
    </div>
  );
}
