// 아이 말 한 번(넷째 조각, 계획서 D '말 시작·끝') — 톡 = 바로 듣기(시작 소리·귀 반짝), 손을 떼도 안 끊김, 다시 톡 = 바로 끝.
// 끝 판정은 쉼 + 내용(domain/kidsTurn), 끝나면 0초에 미리 만든 말("알겠어!") → 맥 받아쓰기 → 아이 세션 → 답 조각을 받는 대로 이어 튼다.
// 답을 다 읽으면 8초 이어 듣기. 숨은 스위치 hold 면 누르는 동안만 듣고 뗀 뒤 0.5초 더
import { useCallback, useEffect, useRef } from 'react';
import { isSpeech, quietLoop, turnRules, turnStep, type PeekJudge, type Turn } from '../../domain/kidsTurn';
import type { KidState } from './KidChar';
import { Mic, nextFiller, PRE, Sound } from './kidsVoice';

/** 판정 기록(맥 turns.jsonl) — 마지막 판정·그때 쉼·그 뒤 아이가 이었나·끝까지 기다린 쉼 */
export type TurnMeta = { j: PeekJudge | 'none'; p: number; r: boolean; w: number; lv?: number; fl?: number };
/** 말을 못 넘긴 때 기록(맥 turns.jsonl) — giveup 말로 못 잡음 · empty 빈 받아쓰기 · hidden 화면 가려짐 · error 맥이 못 받음 */
export type TurnEvent = { cid: string; ev: 'giveup' | 'empty' | 'hidden' | 'error'; lv: number; fl: number; follow: boolean };
export type KidsVoiceApi = {
  peek: (wav: Uint8Array, cid: string) => Promise<{ text: string; more: boolean; judge?: PeekJudge }>;
  hear: (wav: Uint8Array, cid: string, meta?: TurnMeta) => Promise<{ text: string }>;
  /** 답 조각 n — 소리 · null = 아직 · 'end' = 더 없음 */
  clip: (cid: string, n: number) => Promise<ArrayBuffer | null | 'end'>;
  pre: (i: number) => Promise<ArrayBuffer>;
  turnLog?: (e: TurnEvent) => Promise<unknown>;
};

type Phase = 'idle' | 'listen' | 'think' | 'talk';
const newCid = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 걸린 시간(실측·하네스) — 손 뗌(끝 판정) → 첫 소리(미리 만든 말)·첫 대답 조각 */
export type VoiceTiming = { cannedMs: number; firstClipMs: number | null; heard: string };
const timings: VoiceTiming[] = [];
(globalThis as unknown as { __kidsTimings: VoiceTiming[] }).__kidsTimings = timings;

export function useKidVoice(vapi: KidsVoiceApi | undefined, enabled: boolean, mode: 'tap' | 'hold', setState: (s: KidState) => void, onNoMic: () => void, rulesIn?: { peekMs?: number; unsureMs?: number; moreMs?: number; speechLevel?: number }, active = true) {
  const sound = useRef(new Sound());
  const mic = useRef(new Mic());
  const phase = useRef<Phase>('idle');
  const turn = useRef<Turn & { cid: string; follow: boolean; floor: number; after: boolean; t0: number; judge: PeekJudge | 'none'; pauseAt: number; resumed: boolean; max: number; peekText: string }>(null);
  // 화면이 떠 있고(잠듦·마무리·글 칸 아님) 목소리를 쓰면 답 뒤에도 계속 듣는다(어린아이는 다시 톡을 기대하기 어렵다)
  const activeRef = useRef(active);
  activeRef.current = active && enabled;
  const quietN = useRef(0);
  const listenRef = useRef<(follow?: boolean) => Promise<void>>(async () => {});
  const log = (t: { cid: string; max: number; floor: number; follow: boolean }, ev: TurnEvent['ev']) => void vapi?.turnLog?.({ cid: t.cid, ev, lv: Math.round(t.max * 10_000) / 10_000, fl: Math.round(Math.min(t.floor, 1) * 10_000) / 10_000, follow: t.follow }).catch(() => {});
  /** 다시 듣기 — 화면이 떠 있으면 이어 듣기, 아니면 쉼 */
  const relisten = () => { mic.current.stop(); if (activeRef.current) void listenRef.current(true); else go('idle', 'idle'); };
  const rules = turnRules(rulesIn);
  const lastFiller = useRef<number | null>(null);
  const seq = useRef(0); // 말 번호 — 앞 말의 늦은 답이 새 말을 건드리지 않게

  useEffect(() => {
    if (!enabled || !vapi) return;
    void sound.current.loadPre(vapi.pre);
    const s = sound.current, m = mic.current;
    return () => { m.stop(); s.stopAll(); };
  }, [enabled, vapi]);

  const go = useCallback((p: Phase, st: KidState) => { phase.current = p; setState(st); }, [setState]);

  const finish = useCallback(async () => {
    const t = turn.current;
    if (!t || !vapi || phase.current !== 'listen') return;
    mic.current.stop();
    if (!t.spoke) { sound.current.chime(false); relisten(); return; }
    const t0 = performance.now();
    sound.current.chime(false);
    sound.current.playPre(PRE.gotIt); // 0초 반응 — 받아쓰기·답 만드는 시간을 가린다
    const rec: VoiceTiming = { cannedMs: Math.round(performance.now() - t0), firstClipMs: null, heard: '' };
    timings.push(rec);
    go('think', 'think');
    const my = ++seq.current;
    // 미리 받아쓴 글이 비었으면 그걸 쓰지 않고 끝난 녹음 전체를 다시 받아쓴다(11-18 실사용 — 첫 말이 빈 글로 끝났다)
    const useCached = (t.peek === 'end' || t.peek === 'more' || t.peek === 'unsure') && !t.after && !!t.peekText;
    try {
      const { text } = await vapi.hear(useCached ? new Uint8Array() : mic.current.wav(), t.cid, { j: t.judge, p: Math.round(t.pauseAt), r: t.resumed, w: Math.round(t.silence), lv: Math.round(t.max * 10_000) / 10_000, fl: Math.round(Math.min(t.floor, 1) * 10_000) / 10_000 });
      rec.heard = text;
      if (!text) {
        // 받아쓰기가 비었다 — 톡 한 말이면 '다시 말해 줄래?', 저절로 듣던 중(소음일 수 있다)이면 조용히. 어느 쪽이든 계속 듣는다
        log(t, 'empty');
        if (!t.follow) sound.current.playPre(PRE.again);
        if (seq.current === my) relisten();
        return;
      }
      quietN.current = 0;
      let n = 0;
      let done = false;
      sound.current.onIdle = () => { if (done && seq.current === my) relisten(); else if (seq.current === my) go('think', 'think'); };
      while (seq.current === my && performance.now() - t0 < 95_000) {
        const c = await vapi.clip(t.cid, n);
        if (c === 'end') break;
        if (c === null) { await sleep(150); continue; }
        if (n === 0) rec.firstClipMs = Math.round(performance.now() - t0);
        n++;
        go('talk', 'talk');
        await sound.current.enqueue(c);
      }
      done = true;
      if (seq.current === my && !sound.current.busy) relisten();
    } catch {
      // 맥이 못 받았다(아이 세션이 안 뜸 등) — 조용히 멈추지 않고 '다시 말해 줄래?' 뒤 계속 듣기. 보호자에겐 맥이 참모로 알린다(kids::kid_down)
      log(t, 'error');
      if (seq.current === my) { sound.current.playPre(PRE.again); relisten(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vapi, go]);

  const frame = useCallback((level: number) => {
    const t = turn.current;
    if (!t || phase.current !== 'listen' || !vapi) return;
    const dt = 4096 / (sound.current.ctx?.sampleRate ?? 48000) * 1000;
    t.sinceStart = performance.now() - t.t0;
    // 내가 소리를 내는 중·끝난 직후엔 말 감지를 끈다(시작 소리·답·미리 만든 말을 아이 말로 잡지 않게)
    const muted = sound.current.sounding(rules.mute / 1000);
    t.floor = Math.min(t.floor, level); // 바닥은 늘 잰다 — 소리 내는 동안 안 재면 감지가 켜질 때 이미 말하던 소리가 바닥이 되어 영영 못 넘는다
    if (!muted) t.max = Math.max(t.max, level);
    const speech = isSpeech(level, t.floor, rules, muted);
    if (speech) {
      t.spoke = true;
      t.silence = 0;
      if (t.peek !== 'none') { t.peek = 'none'; t.after = true; t.fillered = false; if (t.judge !== 'none') t.resumed = true; } // 쉼 뒤에 또 말했다 — 미리 받아쓴 글은 버리고 다시
      sound.current.stopFiller(); // 추임새가 아이 말과 겹치면 바로 멈춘다
    } else if (t.spoke) t.silence += dt;
    const act = turnStep(t.follow ? { ...t, nudged: true } : t, rules);
    if (act === 'nudge') { t.nudged = true; sound.current.playPre(PRE.umm); }
    else if (act === 'peek') {
      t.peek = 'pending';
      t.after = false;
      t.pauseAt = t.silence;
      const cid = t.cid;
      // 맥 판정(kids_turn) — 옛 맥은 judge 없이 more 만 준다. 못 받으면 모름(조금 더 기다렸다 대답)
      vapi.peek(mic.current.wav(), cid).then((r) => { if (turn.current?.cid === cid && t.peek === 'pending') { t.peek = r.judge ?? (r.more ? 'more' : 'end'); t.judge = t.peek; t.peekText = r.text ?? ''; } }, () => { if (t.peek === 'pending') { t.peek = 'unsure'; t.judge = 'unsure'; } });
    } else if (act === 'filler') {
      // 이어 갈 것 같은 쉼 — 추임새 한 번(같은 말 연속 금지), 계속 듣는다. 대답으로 세지 않는다
      t.fillered = true;
      const i = nextFiller(lastFiller.current);
      if (sound.current.playFiller(i)) lastFiller.current = i;
    } else if (act === 'end') void finish();
    else if (act === 'giveup') {
      // 말로 못 잡았다 — 기록(최대 소리·바닥)하고 계속 듣기. 조용한 바퀴가 쌓이면 한 번 먼저 불러 본다
      log(t, 'giveup');
      if (!t.follow) sound.current.chime(false);
      quietN.current += 1;
      if (quietLoop(quietN.current, rules) === 'call') sound.current.playPre(PRE.umm);
      relisten();
    }
  }, [vapi, finish, go]);

  /** 듣기 시작 — follow = 답 뒤 이어 듣기(시작 소리·부르기 없이 8초) */
  const listen = useCallback(async (follow = false) => {
    if (!vapi) return;
    const ctx = sound.current.unlock();
    try {
      await mic.current.open(ctx);
    } catch {
      onNoMic(); // 마이크를 못 연다(허락 안 함·없음) — 글 칸으로
      return;
    }
    if (!follow) sound.current.chime(true);
    if (!follow) quietN.current = 0;
    turn.current = { sinceStart: 0, spoke: false, silence: 0, peek: 'none', nudged: false, cid: newCid(), follow, floor: 1, after: false, t0: performance.now(), judge: 'none', pauseAt: 0, resumed: false, max: 0, peekText: '' };
    go('listen', 'listen');
    mic.current.start(ctx, frame);
  }, [vapi, frame, go, onNoMic]);
  listenRef.current = listen;

  // 화면이 가려지거나 잠듦·마무리·글 칸이면 듣기를 멈춘다(다시 보이면 톡으로 — 아이패드는 손길 없이 소리 길을 못 연다)
  useEffect(() => {
    const stop = (ev: TurnEvent['ev'] | null) => {
      const t = turn.current;
      if (phase.current !== 'listen' || !t) return;
      if (ev) log(t, ev);
      mic.current.stop();
      go('idle', 'idle');
    };
    if (!active) stop(null);
    const vis = () => { if (document.visibilityState === 'hidden') stop('hidden'); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, go]);

  /** 캐릭터를 누른 순간 */
  const down = useCallback(() => {
    if (!enabled) return false;
    sound.current.unlock(); // 누른 그 순간 — iPad 소리 길
    if (phase.current === 'listen') { if (mode === 'tap') void finish(); return true; } // 듣는 중 다시 톡 = 바로 끝
    if (phase.current !== 'idle') return true; // 말하는 중·만드는 중엔 끊지 않는다(1단계)
    void listen(false);
    return true;
  }, [enabled, mode, finish, listen]);

  /** 손을 뗀 순간 — hold 면 0.5초 더 듣고 끝 */
  const up = useCallback(() => {
    if (enabled && mode === 'hold' && phase.current === 'listen') setTimeout(() => void finish(), 500);
  }, [enabled, mode, finish]);

  /** 미리 만든 말 바로(마무리 장면) */
  const say = useCallback((i: number) => { sound.current.unlock(); return sound.current.playPre(i); }, []);
  return { down, up, say };
}
