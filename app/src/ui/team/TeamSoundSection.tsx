// 설정 > 폰과 메신저 > 메신저 알림 — 새 팀 말이 오면 OS 알림 + 알림음(Rust team_alert). 소리 켜고 끄기·고르기·미리 듣기.
// 지금 보고 있는 대화엔 안 울린다(그 창이 앞일 때). 저장은 <데이터>/team-alert.json — 바꾸면 바로 쓴다
import { useEffect, useState } from 'react';
import { teamAlertGet, teamAlertSet, teamSoundTry, type TeamAlert } from '../../data/teamApi';
import { tr } from '../../i18n';
import { IconPlay } from '../Icons';
import { IconButton } from '../kit/IconButton';

export function TeamSoundSection({ title }: { title: string }) {
  const [a, setA] = useState<TeamAlert | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void teamAlertGet().then(setA, (e: unknown) => setErr(String(e))); }, []);
  if (!a) return err ? <section className="su-sec"><div className="su-sec-head"><h2>{title}</h2></div><p className="su-hint">{err}</p></section> : null;
  const save = (sound: boolean, name: string) => {
    setA({ ...a, settings: { sound, name } });
    void teamAlertSet(sound, name).catch((e: unknown) => setErr(String(e)));
  };
  const s = a.settings;
  return (
    <section className="su-sec">
      <div className="su-sec-head"><h2>{title}</h2></div>
      <p className="su-hint">{tr('팀 메신저에 새 말이 오면 알림을 띄워요. 지금 보고 있는 대화엔 안 울려요.', 'Shows a notification for new team messages — not for the chat you are looking at.')}</p>
      <div className="cfg-rows">
        <label className="cfg-row">
          <span className="cfg-rt"><b>{tr('알림음', 'Sound')}</b></span>
          <input type="checkbox" role="switch" className="cfg-sw" checked={s.sound} onChange={(e) => save(e.target.checked, s.name)} />
        </label>
        <div className="cfg-row">
          <span className="cfg-rt"><b>{tr('소리', 'Tone')}</b></span>
          <span className="su-inline">
            <select value={s.name} disabled={!s.sound} aria-label={tr('알림음 고르기', 'Pick a sound')} onChange={(e) => { save(s.sound, e.target.value); void teamSoundTry(e.target.value); }}>
              {a.sounds.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <IconButton tone="line" label={tr('미리 듣기', 'Preview')} disabled={!s.sound} onClick={() => void teamSoundTry(s.name)}><IconPlay /></IconButton>
          </span>
        </div>
      </div>
      {err && <p className="su-hint" role="alert">{err}</p>}
    </section>
  );
}
