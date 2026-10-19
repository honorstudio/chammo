import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { savingText } from '../domain/quitSave';
import { IconSkip } from './Icons';
import './tour.css';

/**
 * ⌥⌘Q "완전히 종료 — 세션도 끄기" 확인. ⌘Q 는 묻지 않고 독에서만 뺀다(세션은 계속, 사용자 2026-09-28).
 * 이건 참모·프로젝트 세션까지 끄는 드문 길이라 한 번 묻는다. 대화는 남아서 나중에 이어서 켤 수 있다
 */
export function QuitDialog({ running, dock, onQuit, onCancel }: { running: number; dock?: boolean; onQuit: (stopSessions: boolean) => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState<'app' | 'all' | null>(null);
  // 세션을 끈 뒤 — 떠 있는 Craft 앱 저장(바뀐 게 있으면 저장 후 끄기). 큰 문서는 몇 초 걸려 무엇을 저장 중인지 보여 주고 건너뛸 수 있게(2026-10-19 끄기 QA).
  // 건너뛰어도 저장은 Craft 가 마저 하고 스스로 꺼진다(가짜 화면 도우미가 그때까지 화면을 살려 둔다)
  const [saving, setSaving] = useState<{ names: string[]; t0: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const exit = () => void invoke('app_exit').catch(() => {});
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onCancel]);
  useEffect(() => {
    if (!saving) return;
    const t = setInterval(() => {
      setNow(Date.now());
      void invoke<string[]>('craft_quit_left').then((left) => { if (!left.length) exit(); else setSaving((s) => s && { ...s, names: left }); }, exit);
    }, 500);
    return () => clearInterval(t);
  }, [!!saving]); // eslint-disable-line react-hooks/exhaustive-deps
  // 독 '종료' — 묻지 않는다(세션은 두고 앱만), 바로 저장 단계로
  useEffect(() => { if (dock) void go(false); }, [dock]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (all: boolean) => {
    setBusy(all ? 'all' : 'app');
    await onQuit(all);
    const names = await invoke<string[]>('craft_quit_start').catch(() => [] as string[]);
    if (!names.length) return exit();
    setSaving({ names, t0: Date.now() });
  };
  return (
    <div className="tour" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="tour-card" role="dialog" aria-modal="true" aria-label={tr('Chammo 종료', 'Quit Chammo')}>
        <h2>{dock ? tr('끄는 중', 'Quitting') : tr('세션까지 모두 끄고 종료할까요?', 'Stop all sessions and quit?')}</h2>
        {dock ? <p>{tr('Craft 앱이 바뀐 걸 저장하면 바로 꺼져요. 세션은 계속 돌아요.', 'Quits as soon as the Craft apps save their changes. Sessions keep running.')}</p> : <p>
          {running
            ? tr(`Chammo 가 다루는 세션 ${running}개를 끄고 앱을 닫아요. 대화는 남아서 나중에 "꺼진 세션"에서 이어서 켤 수 있어요. 세션은 두고 앱만 다시 켜려면 '앱만 종료'.`, `Stops the ${running} sessions Chammo manages and quits. Conversations are kept — resume them later from "Stopped sessions". To restart only the app and keep sessions running, choose 'Quit app only'.`)
            : tr('돌고 있는 세션이 없어요. 앱을 닫아요.', 'No sessions are running. The app will quit.')}
        </p>}
        {saving ? (
          <div className="tour-nav">
            <span>{savingText(saving.names, Math.floor((now - saving.t0) / 1000))}</span>
            <span className="grow" />
            <button className="ib" onClick={exit} aria-label={tr('건너뛰기', 'Skip')} title={tr('건너뛰기 — 기다리지 않고 끄기, 저장은 뒤에서 마저 하고 앱이 스스로 꺼져요', 'Skip — quit now, the save finishes in the background')}><IconSkip /></button>
          </div>
        ) : (
        <div className="tour-nav">
          <button className="btn" disabled={!!busy} onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <span className="grow" />
          {running > 0 && <button className="btn" disabled={!!busy} onClick={() => go(false)}>{busy === 'app' ? tr('끄는 중…', 'Quitting…') : tr('앱만 종료', 'Quit app only')}</button>}
          <button className="btn pri" disabled={!!busy} onClick={() => go(true)}>{busy === 'all' ? tr('끄는 중…', 'Stopping…') : running ? tr('끄고 종료', 'Stop and quit') : tr('종료', 'Quit')}</button>
        </div>
        )}
      </div>
    </div>
  );
}
