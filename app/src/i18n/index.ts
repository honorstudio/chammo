/**
 * 한/영 두 언어 — 사전 키 대신 한국어와 영어를 한 줄에 같이 적는다: tr('저장', 'Save').
 * 코드를 읽을 때 원문이 그대로 보이고, 키 이름을 짓고 관리할 일이 없다. 언어는 앱이 뜰 때 한 번 정하고
 * (main.tsx 가 App 을 불러오기 전에 setLang), 설정에서 바꾸면 창을 다시 연다 — 그래서 모듈 맨 위의 표(가챠 이름 등)도 tr 로 된다.
 * 세 번째 언어가 필요해지면 그때 키 방식으로 옮긴다(2026-09-28 결정: 지금은 ko·en 만)
 */
import { keyLabel } from '../domain/keys';
import { IS_WIN } from '../domain/reader';

export type Lang = 'ko' | 'en';

let lang: Lang = 'ko';
let assistantName: string | null = null;

export const setLang = (l: Lang) => { lang = l; };
export const getLang = (): Lang => lang;
/** 윈도우면 글 속 맥 단축키 표기(⌘M·⌥⌘2)를 윈도우 키로(domain/keys) — 문구마다 따로 안 적게 여기서 한 번 */
let winKeys = IS_WIN;
export const setWinKeys = (w: boolean) => { winKeys = w; };
export const tr = (ko: string, en: string): string => keyLabel(lang === 'en' ? en : ko, winKeys);

/** 처음 켤 때 — 저장된 언어가 있으면 그것, 없으면 시스템 언어가 한국어일 때만 ko */
export function pickLang(saved: string | null, system: string): Lang {
  if (saved === 'ko' || saved === 'en') return saved;
  return system.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** 비서(오케스트레이터) 이름 — 설정에서 정한다. 없으면 참모/Chammo */
export const setAssistant = (name: string | null) => { assistantName = name?.trim() || null; };
export const assistant = (): string => assistantName ?? tr('참모', 'Chammo');

/** 이 컴퓨터를 부르는 말 — 윈도우는 PC, 맥은 맥/Mac. 조사는 josa(machine(), '이', '가') */
export const machine = (win = IS_WIN): string => (win ? 'PC' : tr('맥', 'Mac'));

/** 이름 + 조사 — 받침이 있으면 앞의 것(두목이), 없으면 뒤의 것(참모가). 비서 이름을 사용자가 정하니까 */
export const josa = (w: string, withBatchim: string, without: string): string => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return `${w}${c >= 0 && c <= 11171 && c % 28 ? withBatchim : without}`;
};
