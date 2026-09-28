// 보이는 세션들의 프로젝트 메모를 5초마다 읽는다 — iTerm memo 로 적은 것도 곧 따라 보이게
import { useCallback, useEffect, useState } from 'react';
import { appendMemo, readMemos, writeMemo } from '../data/tauri';
import { formatEntry, memoTime, parseMemo, removeEntry, serializeMemo, validMemoName, type MemoItem } from '../domain/memo';

export function useMemos(projects: string[]) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const key = [...new Set(projects.filter(validMemoName))].sort().join('|');
  const load = useCallback(() => {
    if (!key) return;
    void readMemos(key.split('|')).then(setFiles).catch(() => {});
  }, [key]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  const items = (project: string): MemoItem[] => parseMemo(files[project] ?? '');
  const add = async (project: string, text: string) => {
    await appendMemo(project, formatEntry(memoTime(new Date()), text));
    load();
  };
  // 지울 땐 파일을 방금 다시 읽어서 — 5초 사이 iTerm memo 로 붙은 줄을 날리지 않게
  const remove = async (project: string, item: MemoItem) => {
    const fresh = (await readMemos([project]))[project] ?? '';
    const next = removeEntry(parseMemo(fresh), item);
    if (next) await writeMemo(project, serializeMemo(next));
    load();
  };
  return { items, add, remove };
}
