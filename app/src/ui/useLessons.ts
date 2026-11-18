// 메모 창 '교훈' 탭 — 열린 창의 칸(프로젝트 교훈, 참모 창이면 그 참모 기억 칸 orch:<기본 이름>)과 공통 교훈.
// 고칠 땐 파일을 방금 다시 읽어서(그 사이 task lesson·memory 가 붙인 줄을 안 날리게)
import { useCallback, useEffect, useState } from 'react';
import { readLessons, undoMemoryRule, unmirrorLesson, writeLessons } from '../data/tauri';
import { addLesson, COMMON, isOrchScope, memoryRuleId, parseLessons, removeLesson, shownLesson } from '../domain/lessons';

export function useLessons(scope: string | null) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!scope) return {};
    const f = await readLessons([scope, COMMON]);
    setFiles(f);
    return f;
  }, [scope]);
  useEffect(() => { void load().catch(() => {}); }, [load]);

  const remove = async (name: string, lesson: string) => {
    // 알아서 기억이 넣은 규칙은 장부(rules.json)째 되돌린다 — 줄만 빼면 장부는 살아 있다고 믿는다
    const rule = isOrchScope(name) ? memoryRuleId(lesson) : null;
    if (rule) {
      await undoMemoryRule(rule);
    } else {
      const f = await load();
      await writeLessons(name, removeLesson(f[name] ?? '', lesson), f[name] ?? '');
      if (name !== COMMON && !isOrchScope(name)) await unmirrorLesson(name, lesson);
    }
    await load();
  };
  // 공통으로 올리기 — 모든 프로젝트 지시에 붙는다. 프로젝트 CLAUDE.local.md 복사본은 남긴다(직접 켠 세션은 공통을 못 보니까)
  const promote = async (lesson: string) => {
    if (!scope) return;
    const f = await load();
    const rule = isOrchScope(scope) ? memoryRuleId(lesson) : null;
    await writeLessons(COMMON, addLesson(f[COMMON] ?? '', rule ? shownLesson(lesson) : lesson), f[COMMON] ?? '');
    if (rule) await undoMemoryRule(rule);
    else await writeLessons(scope, removeLesson(f[scope] ?? '', lesson), f[scope] ?? '');
    await load();
  };
  return {
    mine: scope ? parseLessons(files[scope] ?? '') : [],
    common: parseLessons(files[COMMON] ?? ''),
    remove,
    promote,
  };
}
