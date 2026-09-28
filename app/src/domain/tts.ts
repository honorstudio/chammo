// 음성 설정 — 명령어 칸 대신 고르게(2026-09-28 사용자 "네이티브랑 수퍼토닉, 수퍼토닉은 원하면 받게").
// 저장은 예전처럼 음성 명령(config.ttsCommand) 한 줄 — Rust 쪽 읽기(tts_argv)는 안 바뀐다.
//   macOS 목소리  → `say` / `say -v Yuna`
//   Supertonic    → `<데이터 폴더>/tts/supertonic/speak -v M1` (받기 버튼으로 설치, 약 550MB)
//   직접 입력     → 적은 그대로(예전 설정·개인 스크립트)

export type TtsEngine = 'native' | 'supertonic' | 'custom';
export type TtsChoice = { engine: TtsEngine; voice: string; command: string };

export const SUPERTONIC_VOICES = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'];

/** 저장된 음성 명령 → 설정 화면의 선택. runner = Supertonic 실행기 경로(설정에 적히는 모양 그대로) */
export function readTts(command: string, runner: string): TtsChoice {
  const c = command.trim();
  if (c === '' || c === 'say') return { engine: 'native', voice: '', command: c };
  const say = /^say -v (\S+)$/.exec(c);
  if (say) return { engine: 'native', voice: say[1]!, command: c };
  if (c === runner || c.startsWith(`${runner} `)) {
    const v = /-v (\S+)/.exec(c.slice(runner.length));
    return { engine: 'supertonic', voice: v?.[1] ?? 'M1', command: c };
  }
  return { engine: 'custom', voice: '', command: c };
}

/** 선택 → 저장할 음성 명령 */
export function ttsCommand(choice: TtsChoice, runner: string): string {
  if (choice.engine === 'native') return choice.voice ? `say -v ${choice.voice}` : 'say';
  if (choice.engine === 'supertonic') return `${runner} -v ${choice.voice || 'M1'}`;
  return choice.command;
}

/** `say -v ?` 목록 → 그 언어 목소리의 짧은 이름("Eddy (한국어(한국))" → Eddy — say -v 에 그대로 쓴다) */
export function nativeVoices(list: string, lang: 'ko' | 'en'): string[] {
  const locale = lang === 'ko' ? 'ko_KR' : 'en_US';
  const out: string[] = [];
  for (const line of list.split('\n')) {
    const m = /^(\S+).*?\s([a-z]{2}_[A-Z]{2})\s+#/.exec(line);
    if (m && m[2] === locale && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}
