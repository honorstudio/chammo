// 세션 브라우저 숨은 글칸(스페이스 칸·크게 보기 모달) — 글칸 값의 차이만 페이지에 보낸다(domain/typeMirror). 조합 중 글자는 페이지에 미리 보이고,
// 조합을 끝내는 Enter(WebKit 229)는 마지막 글자 뒤에 간다. 키 처리기는 key() 를 먼저 부르고, true 면 그 키는 끝난 것
import { useMemo, useRef } from 'react';
import type { InputEv } from '../domain/agentInput';
import { TypeMirror } from '../domain/typeMirror';

type Key = { key: string; keyCode: number; isComposing: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** 글자 없는 키 처리 중 글칸이 맡을 것 — 'native' = 글칸 기본 동작 그대로(차이가 간다) · 'enter' · 'ignore'(입력기 몫) · 'key' = 키로 보내고 새로 시작 */
export function fieldKey(e: Key, value: string): 'native' | 'enter' | 'defer' | 'ignore' | 'key' {
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey;
  // WebKit 은 조합을 끝내는 Enter 를 compositionend 뒤 isComposing=false·229 로 준다 — 버리면 검색이 안 됐다
  if (e.key === 'Enter' && plain && !e.shiftKey && e.keyCode === 229 && !e.isComposing) return 'defer';
  if (e.isComposing || e.keyCode === 229) return 'ignore';
  if (e.key === 'Backspace' && plain && value.length > 0) return 'native';
  if (e.key === 'Enter' && plain && !e.shiftKey) return 'enter';
  return 'key';
}

export function useTypeField(field: React.RefObject<HTMLTextAreaElement | null>, send: (evs: InputEv[]) => void) {
  const m = useRef(new TypeMirror()).current;
  const sendRef = useRef(send);
  sendRef.current = send;
  return useMemo(() => {
    const out = (evs: InputEv[]) => { if (evs.length) sendRef.current(evs); };
    const restart = () => { if (field.current) field.current.value = ''; m.reset(); };
    return {
      props: {
        onInput: (e: React.FormEvent<HTMLTextAreaElement>) => out(m.input(e.currentTarget.value, !!(e.nativeEvent as InputEvent).isComposing)),
        onCompositionUpdate: (e: React.CompositionEvent<HTMLTextAreaElement>) => out(m.compose(e.data ?? '')),
        onCompositionEnd: (e: React.CompositionEvent<HTMLTextAreaElement>) => out(m.end(e.currentTarget.value)),
        onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
          e.preventDefault();
          const v = e.clipboardData.getData('text');
          if (v) out([...m.flush(e.currentTarget.value), { kind: 'text', text: v }]);
          restart(); // 붙인 글은 글칸에 없다 — 이어지는 지우기가 글칸 글 기준으로 어긋나지 않게 새로
        },
        onBlur: restart,
      },
      /** 키 처리기 맨 앞 — 입력기 몫(229)·글칸이 지울 Backspace 면 true(손대지 않음), Enter 는 여기서 보낸다(stop 은 부르는 쪽) */
      pre(e: KeyboardEvent): 'done' | 'stop' | 'pass' {
        const v = field.current?.value ?? '';
        switch (fieldKey(e, v)) {
          case 'ignore': case 'native': return 'done';
          case 'defer': setTimeout(() => out(m.enter(229, field.current?.value ?? '')), 0); return 'stop';
          case 'enter': out(m.enter(13, v)); restart(); return 'stop';
          case 'key': return 'pass';
        }
      },
      /** 글자 아닌 키를 보낼 때 — 남은 차이를 먼저, 보낸 뒤 새로 시작(화살표·Tab·⌘ 조합은 글칸과 페이지 자리를 어긋나게 한다) */
      key(k: InputEv[]) { out([...m.flush(field.current?.value ?? ''), ...k]); restart(); },
      /** 칸·그림을 눌렀다 — 조합 중이면 글칸 조합을 끝낸다(크롬은 누름에 조합 글자를 그 자리에 남긴다) */
      clicked() {
        const f = field.current;
        m.clicked();
        if (f && document.activeElement === f) { f.blur(); f.focus({ preventScroll: true }); }
        restart();
      },
    };
  }, [field, m]);
}
