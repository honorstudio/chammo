// 메모 창 '교훈' 탭 — 열린 프로젝트의 교훈과 공통 교훈. 고칠 땐 파일을 방금 다시 읽어서(그 사이 task lesson 이 붙인 줄을 안 날리게)
import { useCallback, useEffect, useState } from 'react';
import { readLessons, unmirrorLesson, writeLessons } from '../data/tauri';
import { addLesson, COMMON, parseLessons, removeLesson } from '../domain/lessons';

export function useLessons(project: string | null) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!project) return {};
    const f = await readLessons([project, COMMON]);
    setFiles(f);
    return f;
  }, [project]);
  useEffect(() => { void load().catch(() => {}); }, [load]);

  const remove = async (name: string, lesson: string) => {
    const f = await load();
    await writeLessons(name, removeLesson(f[name] ?? '', lesson));
    if (name !== COMMON) await unmirrorLesson(name, lesson);
    await load();
  };
  // 공통으로 올리기 — 모든 프로젝트 지시에 붙는다. 프로젝트 CLAUDE.local.md 복사본은 남긴다(직접 켠 세션은 공통을 못 보니까)
  const promote = async (lesson: string) => {
    if (!project) return;
    const f = await load();
    await writeLessons(COMMON, addLesson(f[COMMON] ?? '', lesson));
    await writeLessons(project, removeLesson(f[project] ?? '', lesson));
    await load();
  };
  return {
    mine: project ? parseLessons(files[project] ?? '') : [],
    common: parseLessons(files[COMMON] ?? ''),
    remove,
    promote,
  };
}
