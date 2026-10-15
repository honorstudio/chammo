// 폰 작업 기록(tasks.jsonl) 이어 받기 — 예전엔 5초마다 꼬리 512KB 를 통째로 다시 받았다(2026-10-08, 안 바뀐 5초에도 518KB).
// 서버(/api/tasks?from=, mobile_http tasks_chunk)는 from 뒤의 온전한 줄만 주고, 512KB 넘게 뒤처졌거나 파일이 줄었으면 reset
import { parseTaskLog, type TaskEvent } from './tasks';
export type TaskChunk = { text: string; next: number; reset: boolean };

/** 서버 몸통 — 첫 줄 {"next","reset"}, 그 뒤 줄 원문(JSON 글로 싸지 않는다 — 따옴표 이스케이프로 7% 커졌다) */
export function parseTaskChunk(body: string): TaskChunk {
  const i = body.indexOf('\n');
  const m = (i < 0 ? null : JSON.parse(body.slice(0, i))) as { next?: unknown; reset?: unknown } | null;
  if (!m || typeof m.next !== 'number' || typeof m.reset !== 'boolean') throw new Error('bad tasks chunk');
  return { text: body.slice(i + 1), next: m.next, reset: m.reset };
}

/** 들고 있는 꼬리 상한(글자) — 서버 첫 꼬리(512KB)와 비슷하게, 오래 열어 둬도 안 불어나게 */
export const TASK_TAIL_CHARS = 512 * 1024;

/** 받은 조각을 붙인 글 — 안 바뀌었으면 같은 글(화면이 다시 안 그린다), 넘치면 앞을 줄 단위로 버린다 */
export function mergeTaskTail(prev: string, c: TaskChunk, max = TASK_TAIL_CHARS): string {
  const text = c.reset ? c.text : prev + c.text;
  if (text.length <= max) return text;
  const cut = text.indexOf('\n', text.length - max - 1);
  return cut < 0 ? '' : text.slice(cut + 1);
}

/** 받기 함수 — 지난번 next 를 from 으로 보낸다. 같은 자리에서 겹쳐 받은 늦은 답은 버린다(줄이 두 번 붙지 않게) */
export function makeTaskTail(read: (from: number) => Promise<TaskChunk>): () => Promise<string> {
  let text = '';
  let next = 0;
  return async () => {
    const from = next;
    const c = await read(from);
    if (next !== from) return text;
    text = mergeTaskTail(text, c);
    next = c.next;
    return text;
  };
}

/** 데스크톱 작업 기록 이어 읽기 조각(Rust read_tasks_since) — id = 파일 신원, 다음에 그대로 넘긴다 */
export type TaskLogChunk = { text: string; next: number; reset: boolean; id: string };

/**
 * 데스크톱 받기 함수 — 3초마다 686KB 통째로 읽고 다 다시 파싱하던 것(2026-10-11 perf 4번). 처음은 통째, 다음엔 늘어난 줄만 파싱해 뒤에 붙인다.
 * 안 바뀌었으면 같은 배열(App 이 다시 안 그린다). 데스크톱은 꼬리를 자르지 않는다 — 옛 일·맡은 일 짐작이 기록 전체를 본다
 */
export function makeTaskLog(read: (from: number | undefined, id: string | undefined) => Promise<TaskLogChunk>): () => Promise<TaskEvent[]> {
  let events: TaskEvent[] = [];
  let next: number | undefined;
  let id: string | undefined;
  return async () => {
    const from = next;
    const c = await read(from, id);
    if (next !== from) return events;
    if (c.reset) events = parseTaskLog(c.text);
    else if (c.text) events = events.concat(parseTaskLog(c.text));
    next = c.next;
    id = c.id;
    return events;
  };
}
