/**
 * 한/영 두 언어 — 사전 키 대신 한국어와 영어를 한 줄에 같이 적는다: tr('저장', 'Save').
 * 코드를 읽을 때 원문이 그대로 보이고, 키 이름을 짓고 관리할 일이 없다. 언어는 앱이 뜰 때 한 번 정하고
 * (main.tsx 가 App 을 불러오기 전에 setLang), 설정에서 바꾸면 창을 다시 연다 — 그래서 모듈 맨 위의 표(가챠 이름 등)도 tr 로 된다.
 * 세 번째 언어가 필요해지면 그때 키 방식으로 옮긴다(2026-09-28 결정: 지금은 ko·en 만)
 */
export type Lang = 'ko' | 'en';

let lang: Lang = 'ko';
let assistantName: string | null = null;

export const setLang = (l: Lang) => { lang = l; };
export const getLang = (): Lang => lang;
export const tr = (ko: string, en: string): string => (lang === 'en' ? en : ko);

/** 처음 켤 때 — 저장된 언어가 있으면 그것, 없으면 시스템 언어가 한국어일 때만 ko */
export function pickLang(saved: string | null, system: string): Lang {
  if (saved === 'ko' || saved === 'en') return saved;
  return system.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** 비서(오케스트레이터) 이름 — 설정에서 정한다. 없으면 참모/Chammo */
export const setAssistant = (name: string | null) => { assistantName = name?.trim() || null; };
export const assistant = (): string => assistantName ?? tr('참모', 'Chammo');
