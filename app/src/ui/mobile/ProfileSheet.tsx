// 폰 프로필 창 — 대시보드 머리 아바타를 누르면 아래에서 올라온다. 이름(별명)·모양·눈·색·목소리(2026-10-09, 그전엔 이름만).
// 이름은 길게 누르기 메뉴와 같은 길(/api/rename → 맥이 쉬는 때 /rename), 번호(참모-N)는 그대로라 배정이 안 바뀐다.
// 모양·목소리는 /api/avatar → 데스크톱 프로필 창과 같은 Rust avatar::save_in. 그림은 폰에서 못 올린다 — 그림 프로필이면 '그림' 칸으로 그대로 둔다
import { useState } from 'react';
import { nickChange, splitOrchName } from '../../domain/orchLabel';
import { avatarKey, defaultVoice, EYES, EYES_LABEL, ORCH_COLORS, resolveAvatar, SHAPE_LABEL, SHAPES, VOICES, type Avatar, type Voice } from '../../domain/avatar';
import { profileDraft, profileToSave, type ProfileDraft } from '../../domain/phoneProfile';
import { phoneName } from '../../domain/mobile';
import type { Session } from '../../domain/session';
import { saveOrchAvatar } from '../../data/web';
import { applyRemoved, applySaved, OrchAvatar, orchColor, useAvatars } from '../avatar';
import { renamePending, usePendingNicks } from './pendingNicks';

export function ProfileSheet({ orch, orchs, voiceBase, onClose }: { orch: Session; orchs: Session[]; voiceBase: string | null; onClose: () => void }) {
  const { nickOf, nameOf } = usePendingNicks(orchs);
  const { saved } = useAvatars();
  const key = avatarKey(orch.name);
  const [start] = useState<Avatar>(() => resolveAvatar(saved, orch.name));
  const [d, setD] = useState<ProfileDraft>(() => profileDraft(start));
  const [v, setV] = useState(nickOf(orch) ?? splitOrchName(orch.name).nick ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = nameOf(orch);
  const label = phoneName(orch.name, orchs);
  const base = VOICES.find((x) => x === voiceBase);
  const def = base ? defaultVoice(key, base) : undefined;
  const preview: Avatar = d.kind === 'image' ? start : d.preset;
  const av = (a: Avatar, size: number) => <OrchAvatar name={orch.name} label={label} size={size} state="rest" color={orchColor(orch.name)} preview={a} />;
  const pick = (p: Partial<ProfileDraft['preset']>) => setD({ ...d, kind: 'preset', preset: { ...d.preset, ...p } });

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try { await job(); onClose(); } catch (e) { setErr(`못 바꿨어요: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const a = profileToSave(start, d);
    if (a) applySaved(key, await saveOrchAvatar(orch.id, a));
    const nick = nickChange(nickOf(orch) ?? splitOrchName(orch.name).nick ?? '', v);
    if (nick !== null) await renamePending(orch.id, nick);
  });
  const reset = () => run(async () => { await saveOrchAvatar(orch.id, null); applyRemoved(key); });

  return (
    <div className="m-menu-wrap" role="dialog" aria-modal="true" aria-label={`${name} 프로필`}>
      <button type="button" className="m-pick-back m-on" aria-label="닫기" onClick={onClose} />
      <div className="m-menu m-prof">
        <div className="m-menu-title">{name} 프로필</div>
        <div className="m-prof-av">{av(preview, 72)}</div>
        <form className="m-new m-prof-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className="m-new-input" value={v} maxLength={24} enterKeyHint="done" aria-label="이름" placeholder="비우면 처음 이름으로" onChange={(e) => setV(e.target.value)} />
          <div className="m-prof-lbl" id="m-prof-shape">모양</div>
          <div className="m-prof-row" role="radiogroup" aria-labelledby="m-prof-shape">
            {start.kind === 'image' && (
              <button type="button" role="radio" aria-checked={d.kind === 'image'} aria-label="올린 그림 그대로" className={`m-prof-opt${d.kind === 'image' ? ' m-on' : ''}`} onClick={() => setD({ ...d, kind: 'image' })}>{av(start, 30)}</button>
            )}
            {SHAPES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={d.kind === 'preset' && d.preset.shape === s} aria-label={SHAPE_LABEL[s]()} className={`m-prof-opt${d.kind === 'preset' && d.preset.shape === s ? ' m-on' : ''}`} onClick={() => pick({ shape: s })}>
                {av({ ...d.preset, shape: s }, 30)}
              </button>
            ))}
          </div>
          {d.kind === 'preset' && (
            <>
              <div className="m-prof-lbl" id="m-prof-eyes">눈</div>
              <div className="m-prof-row" role="radiogroup" aria-labelledby="m-prof-eyes">
                {EYES.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={d.preset.eyes === e} aria-label={EYES_LABEL[e]()} className={`m-prof-opt${d.preset.eyes === e ? ' m-on' : ''}`} onClick={() => pick({ eyes: e })}>
                    {av({ ...d.preset, shape: 'circle', eyes: e }, 30)}
                  </button>
                ))}
              </div>
              <div className="m-prof-lbl" id="m-prof-color">색</div>
              <div className="m-prof-row" role="radiogroup" aria-labelledby="m-prof-color">
                {ORCH_COLORS.map((c, i) => (
                  <button key={c} type="button" role="radio" aria-checked={d.preset.color === c} aria-label={`색 ${i + 1}`} className={`m-prof-sw${d.preset.color === c ? ' m-on' : ''}`} onClick={() => pick({ color: c })}><i style={{ background: c }} /></button>
                ))}
                <button type="button" role="radio" aria-checked={d.preset.color === null} className={`m-prof-chip${d.preset.color === null ? ' m-on' : ''}`} onClick={() => pick({ color: null })}>순서대로</button>
              </div>
            </>
          )}
          {base && (
            <>
              <div className="m-prof-lbl" id="m-prof-voice">목소리</div>
              <div className="m-prof-row" role="radiogroup" aria-labelledby="m-prof-voice">
                <button type="button" role="radio" aria-checked={d.voice === null} className={`m-prof-chip${d.voice === null ? ' m-on' : ''}`} onClick={() => setD({ ...d, voice: null })}>기본 {def}</button>
                {VOICES.map((x: Voice) => (
                  <button key={x} type="button" role="radio" aria-checked={d.voice === x} className={`m-prof-chip${d.voice === x ? ' m-on' : ''}`} onClick={() => setD({ ...d, voice: x })}>{x}</button>
                ))}
              </div>
            </>
          )}
          {err && <div className="m-error">{err}</div>}
          <div className="m-new-row">
            {saved.has(key) && <button type="button" className="m-btn m-prof-reset" disabled={busy} onClick={() => void reset()}>처음대로</button>}
            <button type="button" className="m-btn" onClick={onClose}>취소</button>
            <button type="submit" className="m-send" disabled={busy}>저장</button>
          </div>
        </form>
      </div>
    </div>
  );
}
