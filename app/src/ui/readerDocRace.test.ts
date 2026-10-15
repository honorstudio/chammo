// 리더 Doc 은 path 가 바뀌어도 같은 컴포넌트라, 앞 문서(A) 읽기가 늦게 오면 뒤 문서(B) 자리에 A 글이 들어갔다 — 편집 모드면 편집기가
// docPath=B 에 A 글로 열려 한 글자만 쳐도 B 가 A 내용으로 저장됐다(2026-10-11 bug-hunt 정적 점검). 늦게 온 답은 버린다
import { describe, expect, it } from 'vitest';
import src from './reader/Reader.tsx?raw';

describe('리더 문서 읽기 — 늦게 온 앞 문서 답은 버린다', () => {
  it('Doc 의 read_doc_text 는 effect 정리에서 끊긴다(alive)', () => {
    const doc = src.slice(src.indexOf('function Doc('), src.indexOf('function Doc(') + 900);
    const eff = doc.slice(doc.indexOf('useEffect('), doc.indexOf('}, [path, kind, nonce]'));
    expect(eff).toMatch(/let alive = true/);
    expect(eff).toMatch(/alive &&|if \(!alive\)|alive \?/);
    expect(eff).toMatch(/return \(\) => \{ alive = false; \}/);
  });
});
