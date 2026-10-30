// 입력창 아래 줄 가운데·오른쪽 — 모델·에포트 칩(누르면 아래 시트에서 고르기), 스피커(앱 음성 모드 켜기·끄기)
// 칩 글·에포트 목록은 데스크톱 채팅 칩과 같은 domain/modelPick, 바꾸기는 맥 앱이 같은 runModelPick 으로(새 세션 기본값은 되돌린다)
import { useEffect, useState } from 'react';
import { pickOrchModel, readVoice, setVoiceMode } from '../../data/web';
import { effortChoices, isModel, MODEL_CHOICES, modelChip, modelChipShort, OTHER_MODELS } from '../../domain/modelPick';
import { pickState } from '../../domain/phoneComposer';
import type { Ctx } from '../../domain/ctx';
import { IconMore, IconSpeaker } from '../Icons';
import { useMemoPoll } from './usePoll';
import { setPhoneVoice, unlockAudio } from '../../data/phoneVoice';
import { machine } from '../../i18n';
import { BottomSheet } from './kit';

const keyOf = (c?: Ctx) => `${c?.model ?? ''}|${c?.effort ?? ''}`;

/** 모델 칩 — 칩은 일하는 중에도 그대로(바꾸기는 일하는 중에도 바로 먹는다, 데스크톱 칩과 같다) */
export function ModelChipRow({ orchId, info }: { orchId: string; info?: Ctx }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false); // '그 밖' 모델 줄 펼침
  const [asked, setAsked] = useState<{ key: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState<string | null>(null);
  const label = modelChip(info); // 'Opus 5.5 · high' — 시트 머리
  const short = modelChipShort(info); // 'Opus · high' — 칩
  const st = pickState(asked, keyOf(info), now);
  useEffect(() => { if (st !== 'wait') return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [st]);
  useEffect(() => { if (st === 'idle' && asked) setAsked(null); if (st === 'fail') { setAsked(null); setErr(`안 바뀌었어요 — ${machine()} 앱에 이 참모 창이 열려 있어야 해요`); } }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!err) return; const t = window.setTimeout(() => setErr(null), 7000); return () => window.clearTimeout(t); }, [err]);
  const go = (want: { model?: string; effort?: string }) => {
    setOpen(false); setMore(false); setErr(null);
    setAsked({ key: keyOf(info), at: Date.now() }); setNow(Date.now());
    pickOrchModel(orchId, want).catch((e: Error) => { setAsked(null); setErr(e.message === 'too soon' ? '방금 바꿨어요 — 잠깐 뒤에' : `못 바꿨어요: ${e.message}`); });
  };
  const efforts = effortChoices(info);
  const showOther = more || OTHER_MODELS.some((m) => isModel(info, m.id)); // 지금 모델이 '그 밖'이면 펼친 채로
  const modelBtn = (m: { id: string; label: string }) => {
    const sel = isModel(info, m.id);
    return <button key={m.id} type="button" role="radio" aria-checked={sel} className={`m-prof-chip${sel ? ' m-on' : ''}`} onClick={() => !sel && go({ model: m.id })}>{m.label}</button>;
  };
  return (
    <>
      {label && (
        <button type="button" className="m-mchip" disabled={st === 'wait'} onClick={() => setOpen(true)} aria-label={`모델·에포트 ${label} — 바꾸기`} title={err ?? '모델·에포트 바꾸기'}>
          <span>{st === 'wait' ? '바꾸는 중…' : short}</span>
        </button>
      )}
      {err && <span className="m-mfail" role="alert">{err}</span>}
      {open && (
        <BottomSheet label="모델·에포트" title={label} onClose={() => { setOpen(false); setMore(false); }}>
          <div className="m-prof-lbl">모델</div>
          <div className="m-prof-row" role="radiogroup" aria-label="모델">
            {MODEL_CHOICES.map(modelBtn)}
            <button type="button" className="m-prof-chip m-mmore" aria-expanded={showOther} aria-label="다른 모델" onClick={() => setMore((v) => !v)}><IconMore /></button>
          </div>
          {showOther && <div className="m-prof-row m-wrap" role="radiogroup" aria-label="다른 모델">{OTHER_MODELS.map(modelBtn)}</div>}
          {efforts.length > 0 && (
            <>
              <div className="m-prof-lbl">에포트</div>
              <div className="m-prof-row" role="radiogroup" aria-label="에포트">
                {efforts.map((e) => (
                  <button key={e.level} type="button" role="radio" aria-checked={info?.effort === e.level} title={e.why} className={`m-prof-chip${info?.effort === e.level ? ' m-on' : ''}`} onClick={() => info?.effort !== e.level && go({ effort: e.level })}>{e.level}</button>
                ))}
              </div>
            </>
          )}
          <p className="m-muted m-sm">이 참모에만 — 새 세션 기본값은 안 바뀌어요</p>
        </BottomSheet>
      )}
    </>
  );
}

/** 스피커 = 앱 음성 모드(참모가 답을 소리로 읽는다) — 마이크로 두면 받아 적기 단추로 헷갈렸다(2026-10-11). 켜짐은 참모 색 꽉 찬 면 */
export function VoiceMode() {
  const [on, , reload] = useMemoPoll('voice', readVoice, 30_000, false);
  const [now, setNow] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // 못 바꿨으면 한 줄(모델 칩과 같은 자리) — 예전엔 실패를 삼켜 눌러도 아무 일이 없어 보였다
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setNow(null); }, [on]);
  useEffect(() => { if (!err) return; const t = window.setTimeout(() => setErr(null), 7000); return () => window.clearTimeout(t); }, [err]);
  const cur = now ?? on;
  const flip = () => {
    if (!cur) unlockAudio(); // 이 누름 안에서 오디오를 풀어 둔다 — 소리가 폰으로 올 수 있게(iOS 는 사람이 누르기 전엔 못 튼다)
    setBusy(true);
    setErr(null);
    setVoiceMode(!cur).then((v) => { setNow(v); setPhoneVoice(v); reload(); }, () => setErr('음성 모드를 못 바꿨어요')).finally(() => setBusy(false));
  };
  return (
    <>
    {err && <span className="m-mfail" role="alert">{err}</span>}
    <button type="button" className={cur ? 'm-cbtn m-on' : 'm-cbtn'} disabled={busy} onClick={flip} aria-pressed={cur} aria-label={cur ? '음성 모드 켜짐 — 끄기' : '음성 모드 꺼짐 — 켜기'} title="음성 모드">
      <span className="m-cdot"><IconSpeaker /></span>
    </button>
    </>
  );
}
