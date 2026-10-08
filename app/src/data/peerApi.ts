// 참모 폰 서버(/api, mobile_http.rs)를 부르는 길 중 '보기 + 채팅 + 대기함 답하기' — 운반(io)만 갈아 끼운다.
// 폰(web.ts)은 fetch + Bearer, 데스크톱이 다른 기기 참모를 볼 땐(remote.ts) Rust remote_call 이 대신 보낸다.
// 이름·모양을 한 곳에 둬서 두 쪽이 어긋나지 않게 한다(domain/* 은 이 모양을 그대로 쓴다)
import { fwdEnv } from '../domain/paths';
import type { TranscriptChunk } from './tauri';

export type MobileEnv = { assistantName: string; language: string; devRoot: string; extraProjects: string[]; hqDir: string };

/** 운반 — 2xx 가 아니면 서버 글(없으면 HTTP 번호)을 메시지로 던진다(폰 서버의 'not working'·'too soon' 같은 글을 그대로 읽는다) */
export type Io = {
  text(path: string, signal?: AbortSignal): Promise<string>;
  json<T>(path: string, signal?: AbortSignal): Promise<T>;
  /** 쓰기는 JSON 으로만 — 폰 서버가 같은 출처 + application/json 이 아니면 거절한다 */
  post<T>(path: string, body: object): Promise<T>;
  bytes(path: string): Promise<ArrayBuffer>;
};

export function makeApi(io: Io) {
  /** 멈춤 — 비서 세션에 Esc 한 번. 이미 쉬는 중(409 not working)·연타(429 too soon)는 결과로 */
  async function interruptSession(id: string): Promise<'ok' | 'idle' | 'soon'> {
    try {
      await io.post<{ ok: true }>('/api/interrupt', { id });
      return 'ok';
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'not working') return 'idle';
      if (m === 'too soon') return 'soon';
      throw e;
    }
  }
  return {
    /** 경로는 fwdEnv 로 — 윈도우 기기는 hqDir 을 C:\Users\me/.chammo/hq 처럼 섞어 보냈다(2026-10-05) */
    getEnv: (signal?: AbortSignal) => io.json<MobileEnv>('/api/env', signal).then(fwdEnv),
    /** `claude agents --json` 원문 — 파싱은 domain/session.ts parseAgents */
    listSessionsRaw: (signal?: AbortSignal) => io.text('/api/sessions', signal),
    /** 대화 기록 이어 읽기 — 세션 id(UUID)로만 */
    readTranscript: (sessionId: string, from?: number, signal?: AbortSignal) =>
      io.json<TranscriptChunk>(`/api/transcript?id=${encodeURIComponent(sessionId)}${from === undefined ? '' : `&from=${from}`}`, signal),
    /** 앞 대화 — before(첫 줄 자리) 앞의 온전한 줄들. start = 그 첫 줄 자리(0 이면 대화 처음) */
    readTranscriptBefore: (sessionId: string, before: number) =>
      io.json<{ text: string; start: number }>(`/api/transcript?id=${encodeURIComponent(sessionId)}&before=${before}`),
    readTasks: () => io.text('/api/tasks'),
    routinesList: () => io.text('/api/routines'),
    readUsage: () => io.text('/api/usage'),
    /** 맥 부하 — 앱이 적는 load.json + 빌드·시뮬레이터·갤럭시 자리(읽기만). 해석은 domain/phoneLoad */
    readLoad: (signal?: AbortSignal) => io.text('/api/load', signal),
    /** 직접 답하기 카드 기록(direct.jsonl) — 상태는 domain/directAsk */
    readDirect: () => io.text('/api/direct'),
    /** 사람이 카드에서 누른 답 — 그 기기가 세션 입력칸에 사람 말로 친다 */
    directAnswer: (id: string, pick: unknown) => io.post<{ ok: true }>('/api/direct-answer', { id, pick }).then(() => undefined),
    /** 결정 대기함(scripts/task ask) 답 기록 — 그 일이 아직 물음일 때만 answer 한 줄(아니면 'not waiting', 같은 일 연타는 'too soon') */
    taskAnswer: (task: string, note: string) => io.post<{ ok: true; again?: boolean }>('/api/task-answer', { task, note }).then(() => undefined),
    /** 비서 세션(HQ 폴더)에만 — 다른 세션이면 서버가 403 */
    sendTextToSession: (id: string, text: string, cid?: string) => io.post<{ ok: true }>('/api/send', cid ? { id, text, cid } : { id, text }).then(() => undefined),
    /** 보낸 말을 뒤에서 쳤나(보낼 함 cid) — typing·done·failed·unknown */
    sendStatus: (cid: string) => io.json<{ state: string; error?: string }>(`/api/send-status?cid=${encodeURIComponent(cid)}`),
    interruptSession,
    /** 꺼진 참모 — HQ 폴더의 꺼진 대화 원문(파싱은 domain/stopped) */
    listStoppedOrchs: () => io.text('/api/stopped'),
    /** 대화 기록 꼬리(세션 번호 → 꼬리 글) — 한 번에 12개까지 */
    readTails: (sessionIds: string[]) =>
      sessionIds.length ? io.json<Record<string, string>>(`/api/tails?ids=${sessionIds.slice(0, 12).map(encodeURIComponent).join(',')}`) : Promise.resolve({} as Record<string, string>),
    /** 떠 있는 세션 브라우저(보기에 필요한 것만) */
    listBrowsers: () => io.json<import('../domain/agentBrowser').Live[]>('/api/browsers'),
    /** 세션 브라우저 화면 한 장 — since 보다 새 것이 있으면 [순번 8바이트][jpeg](domain/agentBrowser unpackFrame), 없으면 빈 것 */
    browserFrame: (profile: string, since: number) => io.bytes(`/api/browser-frame?profile=${encodeURIComponent(profile)}&since=${since}`),
    /** 참모 고정·맡은 일 — 그 기기 <데이터> 파일 글 그대로(domain/orchPins·orchRoles) */
    readPins: () => io.text('/api/pins'),
    readRoles: () => io.text('/api/roles'),
  };
}

export type PeerApi = ReturnType<typeof makeApi>;
