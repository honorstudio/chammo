// 폰 화면 언어 — 붙은 컴퓨터(Chammo) 설정 언어를 따른다. 폰은 setLang 을 한 번도 안 불러 영어로 골라도 한국어로만 나왔다(공개 이슈 #16).
// 모듈 맨 위의 tr() 표가 맞는 언어로 평가되게 mobile.tsx 가 화면 모듈보다 **먼저** 이 파일을 불러온다 — 지난번 맥 정보(m.env)의 언어로 정하고,
// 새로 받은 맥 정보의 언어가 다르면 MobileApp 이 저장한 뒤 다시 연다
import { pickLang, setLang, type Lang } from '../../i18n';

/** domain/boot 의 ENV_KEY 와 같은 글(시험이 대조) — boot 를 불러오면 그 밑 모듈의 tr() 표가 언어를 정하기 전에 평가된다 */
export const ENV_KEY = 'm.env';

/** 지난번 맥 정보(JSON 글)의 언어 — 없거나 모르는 값이면 폰 시스템 언어로 짐작 */
export function hostLang(cachedEnv: string | null, phone: string): Lang {
  let saved: string | null = null;
  try {
    const v: unknown = JSON.parse(cachedEnv ?? 'null');
    if (v && typeof v === 'object' && typeof (v as { language?: unknown }).language === 'string') saved = (v as { language: string }).language;
  } catch { /* 깨진 기록은 없는 것으로 */ }
  return pickLang(saved, phone);
}

/** 새로 받은 맥 정보의 언어가 지금 화면 언어와 다른가(옛 서버·모르는 값이면 그대로) */
export const langChanged = (language: string | undefined, now: Lang): boolean => (language === 'ko' || language === 'en') && language !== now;

try {
  setLang(hostLang(localStorage.getItem(ENV_KEY), navigator.language));
} catch {
  setLang(pickLang(null, typeof navigator === 'undefined' ? '' : navigator.language));
}
