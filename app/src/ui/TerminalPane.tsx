import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { findPathsWrapped, resolveLink } from '../domain/links';
import '@xterm/xterm/css/xterm.css';
import { imeStep, normalizeInput, yieldsToXterm } from '../domain/imeBridge';
import { macKeySequence, ctrlLetter } from '../domain/macKeys';
import { copyKeyAction, parseOsc52 } from '../domain/clipboard';
import { resizeAfterOpen } from '../domain/ptySize';
import { followLink } from './followLink';
import { closePty, imeDebugMode, imeLog, openPty, openTarget, resizePty, writeClipboard, writePty } from '../data/tauri';
import { currentContrast, currentTheme, darkQuery } from './termTheme';
import { IconNote } from './Icons';
import { DROP_EVENT } from './fileDrop';
import { tr } from '../i18n';

// 아이콘(Nerd Font 글리프: 상태줄 파워라인 등)은 맥에 깔린 Meslo Nerd Font, 한글은 번들한 Chammo Hangul(D2Coding 한글 수정판), 나머지는 Menlo.
// 폰트는 main.tsx 에서 그리기 전에 미리 불러온다 — 늦게 오면 xterm 이 칸 폭을 잘못 잰다
export const TERM_FONT =
  '"MesloLGSDZ Nerd Font Mono", "MesloLGS NF", "MesloLGLDZ Nerd Font Mono", "Chammo Hangul", Menlo, "Apple SD Gothic Neo", monospace';

export type PaneApi = { write: (data: string) => void; focus: () => void };

type Props = {
  /** pty 에서 돌릴 셸 명령. `exec '<claude>' attach <id>` 처럼 절대 경로로 */
  command: string;
  cwd?: string;
  title: string;
  subtitle?: string;
  /** 머리줄 오른쪽 버튼들 (크게·접기·끄기) */
  controls?: ReactNode;
  fontSize: number;
  /** 보기 전용(비서 화면 아래 미리보기) — 입력을 받지 않고, 머리줄을 누르면 onHeadClick */
  readOnly?: boolean;
  onHeadClick?: () => void;
  /** 머리줄을 끌어서 창 순서를 바꿀 때 (SessionGrid 가 넘긴다) */
  headDrag?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  /** 상대 경로 링크를 풀 기준 폴더(그 세션의 cwd)와 홈 */
  linkBase?: string;
  home?: string;
  /** 이 창을 클릭·입력하면 — ⌘W 가 어느 세션을 끌지 알기 위해 */
  onFocus?: () => void;
  /** 머리줄에 흐리게 붙는 최근 메모 한 줄. 누르면 onNoteClick */
  note?: string;
  onNoteClick?: () => void;
  /** 터미널 위에 띄우는 판(메모) */
  overlay?: ReactNode;
  /** 이 창을 밖에서 다루는 손잡이 — 입력칸에 글자 넣기(메모 → 세션에 보내기)·포커스 되돌리기(메모판 닫을 때). 창이 닫히면 null */
  inject?: (api: PaneApi | null) => void;
};

export function TerminalPane({ command, cwd, title, subtitle, controls, fontSize, readOnly, onHeadClick, headDrag, linkBase, home, onFocus, note, onNoteClick, overlay, inject }: Props) {
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const injectRef = useRef(inject);
  injectRef.current = inject;
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // 글자 크기만 바꿀 때 터미널을 다시 만들지 않도록 인스턴스를 들고 있는다
  const live = useRef<{ term: Terminal; refit: () => void } | null>(null);
  const initialFont = useRef(fontSize);
  // 화면 배율이 바뀌면(맥북 레티나 2배 → 외부 모니터 1배로 옮김) 터미널을 새로 만든다 — 켜질 때 배율로 잰 칸이 남아
  // 최대화하면 화면이 깨졌고 ⌘2→⌘1(다시 만들기)로만 풀렸다(2026-09-28 사용자). 세션은 그대로, 화면만 다시 붙는다
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      mq?.removeEventListener('change', onChange);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onChange);
    };
    function onChange() {
      watch();
      clearTimeout(timer);
      timer = setTimeout(() => setEpoch((e) => e + 1), 300); // 창이 새 화면에 자리 잡은 뒤
    }
    watch();
    return () => { mq?.removeEventListener('change', onChange); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const openLink = (text: string) => {
      followLink(resolveLink(text, linkBase ?? home ?? '/', home ?? '/')); // 웹 → 브라우저, 문서 → 리더, 나머지 → 기본 앱
    };
    const term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: initialFont.current,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: currentTheme(),
      minimumContrastRatio: currentContrast(),
      disableStdin: !!readOnly,
      // Claude Code 는 마우스 추적 모드를 켠다. 그 모드에서 xterm 은 트랙패드의 작은 휠 입력(<50px)을
      // 30%로 깎아서 iTerm 보다 확연히 느리다(xterm consumeWheelEvent). 그만큼 되돌린다
      scrollSensitivity: 3,
      // 마우스 추적 모드에선 드래그를 Claude 가 가져간다. ⌥+드래그는 xterm 자체 선택(⌘C 로 복사)
      macOptionClickForcesSelection: true,
      // OSC 8 하이퍼링크 — iTerm 처럼 ⌘+클릭일 때만 연다. 단 백그라운드 세션은 Claude 백그라운드 서비스(bg-pty-host)
      // 안에서 그려져서 우리 환경변수가 안 닿고, 그래서 Claude 가 링크를 안 찍는다(실측 0개). 실제로는 아래 자체 인식기가 일한다
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (e, text) => {
          if (e.metaKey) openLink(text);
        },
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // 링크로 안 찍힌 웹 주소·파일 경로 (https://…, src/app.ts:12 같은 것) — 둘 다 아래 한 곳에서.
    // xterm 기본 웹 링크(WebLinksAddon)는 Claude 화면이 직접 바꾼 줄을 못 이어 윗줄 조각만 링크로 잡았다(2026-09-28 사용자)
    // 두 줄로 접힌 경로도 한 링크로(domain/links findPathsWrapped). 한글은 두 칸이라 글자 순번 → 화면 칸을 셀로 다시 센다
    const rowCells = (i: number): { text: string; cols: number[] } | null => {
      const l = term.buffer.active.getLine(i);
      if (!l) return null;
      let text = '';
      const cols: number[] = [];
      for (let x = 0; x < l.length; x++) {
        const c = l.getCell(x);
        if (!c || c.getWidth() === 0) continue;
        const ch = c.getChars() || ' ';
        for (let k = 0; k < ch.length; k++) cols.push(x);
        text += ch;
      }
      const trimmed = text.trimEnd();
      return { text: trimmed, cols: cols.slice(0, trimmed.length) };
    };
    const pathLinks = term.registerLinkProvider({
      provideLinks: (y, cb) => {
        const rows = new Map<number, { text: string; cols: number[] } | null>();
        const row = (i: number) => { if (!rows.has(i)) rows.set(i, rowCells(i)); return rows.get(i)!; };
        const used = (i: number) => { const r = row(i); return r && r.cols.length ? r.cols[r.cols.length - 1]! + 1 : 0; };
        const found = findPathsWrapped((i) => row(i)?.text ?? null, (i) => term.buffer.active.getLine(i)?.isWrapped ?? false, y - 1, term.cols, used);
        const cell = (r: number, k: number) => (row(r)?.cols[k] ?? k) + 1;
        cb(found.map((m) => ({
          text: m.text,
          range: { start: { x: cell(m.from.row, m.from.col), y: m.from.row + 1 }, end: { x: cell(m.to.row, m.to.col), y: m.to.row + 1 } },
          decorations: { underline: true, pointerCursor: true },
          activate: (e: MouseEvent) => { if (e.metaKey) openLink(m.text); },
        })));
      },
    });
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL 이 없으면 xterm 기본 렌더러
    }

    let id: number | null = null;
    let disposed = false;
    const write = (d: string) => {
      if (id != null) void writePty(id, d);
    };
    term.onData((d) => { imeTrace?.('xterm', { d }); write(d); });
    injectRef.current?.({ write: (d) => { write(d); term.focus(); }, focus: () => term.focus() });
    // Claude 화면에서 드래그해 선택하면 Claude 가 OSC 52 로 "클립보드에 넣어라"를 보낸다 (domain/clipboard)
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const text = parseOsc52(data);
      if (text) void writeClipboard(text).catch(() => {});
      return true;
    });
    term.attachCustomKeyEventHandler((e) => {
      const copy = copyKeyAction(e, term.hasSelection());
      if (copy) {
        // 삼키지 않고 편집 메뉴로 넘기면 복사할 게 없어서 삑 소리가 난다
        e.preventDefault();
        if (copy === 'copySelection' && e.type === 'keydown') void writeClipboard(term.getSelection()).catch(() => {});
        return false;
      }
      const seq = macKeySequence(e) ?? ctrlLetter(e);
      if (!seq) return true;
      if (e.type === 'keydown') {
        e.preventDefault();
        write(seq);
      }
      return false; // keydown·keyup 둘 다 xterm 에 안 넘긴다
    });
    const detachIme = readOnly ? () => {} : installImeBridge(term, (d) => { imeTrace?.('bridge', { d }); write(d); });
    // 파일을 끌어다 놓으면(ui/fileDrop) 붙여넣기처럼 — Claude 가 붙여넣은 경로를 이미지로 읽는다
    const onDrop = (e: Event) => {
      term.paste((e as CustomEvent<string>).detail);
      term.focus();
    };
    const box = root.current;
    if (!readOnly) box?.addEventListener(DROP_EVENT, onDrop);
    const onTermFocus = () => focusRef.current?.();
    term.textarea?.addEventListener('focus', onTermFocus);
    // macOS 다크/라이트가 바뀌면 터미널 색도 바로 따라간다
    const mq = darkQuery();
    const onScheme = () => { term.options.theme = currentTheme(); term.options.minimumContrastRatio = currentContrast(); };
    mq.addEventListener('change', onScheme);

    fit.fit();
    let cols = term.cols;
    let rows = term.rows;
    void openPty(command, cwd, cols, rows, (bytes) => term.write(bytes)).then((n) => {
      if (disposed) { void closePty(n); return; }
      id = n;
      // 여는 사이 레이아웃이 자리 잡으며 크기가 바뀌었으면(앱을 막 켰을 때) 그 크기를 지금 알린다 — 안 그러면 버려진다
      fit.fit();
      const next = resizeAfterOpen({ cols, rows }, { cols: term.cols, rows: term.rows });
      if (next) { cols = next.cols; rows = next.rows; void resizePty(n, cols, rows); }
    });

    const refit = () => {
      if (disposed) return;
      fit.fit();
      if (id != null && (term.cols !== cols || term.rows !== rows)) {
        cols = term.cols;
        rows = term.rows;
        void resizePty(id, cols, rows);
      }
    };
    live.current = { term, refit };
    const ro = new ResizeObserver(() => requestAnimationFrame(refit));
    ro.observe(el);
    // 글꼴이 늦게 오면(재부팅 직후 main.tsx 의 1.5초 대기를 넘기면) 임시 글꼴로 잰 칸 크기가 그대로 남아
    // 줄 수가 모자라고 입력칸이 위로 붙었다 — ⌘2→⌘1 로 다시 열어야 풀렸다(2026-09-28 사용자). 글꼴이 다 오면 다시 잰다
    const remeasure = () => {
      if (disposed) return;
      const f = term.options.fontFamily ?? TERM_FONT;
      term.options.fontFamily = `${f} `; // 값이 바뀌어야 xterm 이 글자 칸을 다시 잰다
      term.options.fontFamily = f;
      term.clearTextureAtlas();
      refit();
    };
    document.fonts.addEventListener('loadingdone', remeasure);
    void document.fonts.ready.then(remeasure);

    return () => {
      disposed = true;
      pathLinks.dispose();
      osc52.dispose();
      live.current = null;
      injectRef.current?.(null);
      ro.disconnect();
      document.fonts.removeEventListener('loadingdone', remeasure);
      detachIme();
      box?.removeEventListener(DROP_EVENT, onDrop);
      mq.removeEventListener('change', onScheme);
      term.textarea?.removeEventListener('focus', onTermFocus);
      if (id != null) void closePty(id);
      term.dispose();
    };
  }, [command, cwd, readOnly, linkBase, home, epoch]);

  // 글자 크기: 창(윈도우) 크기는 그대로 두고 칸 수만 다시 계산해 pty 에 알린다 — iTerm 처럼 창이 늘었다 줄었다 하지 않는다
  useEffect(() => {
    const l = live.current;
    if (!l || l.term.options.fontSize === fontSize) return;
    l.term.options.fontSize = fontSize;
    requestAnimationFrame(l.refit);
  }, [fontSize]);

  return (
    <div ref={root} className={`pane ${readOnly ? 'readonly' : ''}`} data-drop={readOnly ? undefined : ''}>
      <div className="pane-head" onClick={onHeadClick} title={onHeadClick ? tr('눌러서 이 세션으로', 'Click to go to this session') : headDrag ? tr('끌어서 자리 바꾸기', 'Drag to reorder') : undefined} {...headDrag}>
        <b>{title}</b>
        <span className="sub">{subtitle}</span>
        {onNoteClick && (
          <span className={`note ${note ? '' : 'empty'}`} role="button" aria-label={tr('메모', 'Notes')} title={note ? tr(`${note}\n\n눌러서 메모 (⌘M)`, `${note}\n\nClick for notes (⌘M)`) : tr('메모 열기 (⌘M)', 'Open notes (⌘M)')} onClick={(e) => { e.stopPropagation(); onNoteClick(); }}>
            <IconNote />
            {note && <span className="note-text">{note.split('\n')[0]}</span>}
          </span>
        )}
        {controls && <span className="ctl">{controls}</span>}
      </div>
      <div className="pane-body" ref={host} />
      {overlay}
    </div>
  );
}

// 한글 입력 진단 — <데이터 폴더>/ime-debug.on 이 있으면 켤 때 한 번 켜진다. 0.5초마다 ime-debug.jsonl 에 몰아 쓴다
let imeTrace: ((type: string, v: object) => void) | null = null;
let imeNoSwallow = false;
void imeDebugMode().then((mode) => {
  if (mode == null) return;
  imeNoSwallow = mode.includes('noswallow');
  let buf: string[] = [];
  imeTrace = (type, v) => buf.push(JSON.stringify({ t: Math.round(performance.now()), type, ...v }));
  setInterval(() => { if (buf.length) { const out = buf.join('\n') + '\n'; buf = []; void imeLog(out).catch(() => {}); } }, 500);
}).catch(() => {});

/**
 * WKWebView 한글 입력 다리 (트러블슈팅 #99). 조상(term.element)에 capture 로 걸어야
 * xterm(textarea 자체 리스너)보다 먼저 받는다. 영어·단축키는 xterm 이 원래대로 처리한다.
 */
function installImeBridge(term: Terminal, write: (d: string) => void): () => void {
  const ta = term.textarea;
  const root = term.element;
  if (!ta || !root) return () => {};
  let before: string | null = null;
  let held: string | null = null; // 조합 확정 때 웹뷰가 잠깐 비운 칸(domain/imeBridge imeStep)
  let xtermOwns = false; // 입력기를 안 거친 키(스페이스·영문·Enter…)는 xterm 이 keydown 에서 이미 보냈다

  const onBeforeInput = () => {
    before = ta.value;
  };
  const onInput = (e: Event) => {
    if (xtermOwns) {
      before = null;
      return;
    }
    // 붙여넣기는 xterm 이 paste 이벤트로 이미 보냈다 — 여기서 또 보내면 두 번 들어간다
    if ((e as InputEvent).inputType === 'insertFromPaste') {
      before = null;
      setTimeout(() => {
        ta.value = '';
      }, 0);
      return;
    }
    const prev = normalizeInput(before ?? '');
    const now = normalizeInput(ta.value);
    before = null;
    const step = imeStep((e as InputEvent).inputType ?? '', prev, now, held);
    held = step.held;
    if (step.send == null) return;
    e.stopPropagation();
    if (step.send) write(step.send);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!yieldsToXterm(e)) return; // 조합 중이거나 수식키(Shift 등) — 조합을 끊지 않는다
    xtermOwns = true;
    setTimeout(() => {
      ta.value = '';
      xtermOwns = false;
    }, 0);
  };

  // 웹뷰가 조합(composition) 이벤트를 보낼 때가 있다 — 그러면 xterm 도 조합이 끝날 때 글자를 또 보내서
  // 한글이 두 번 들어간다("사이" → "사사이이", 2026-09-28 osascript 두벌식으로 재현). 한글은 이 다리가 보내니 xterm 조합 처리는 막는다
  const COMPOSITION = ['compositionstart', 'compositionupdate', 'compositionend'];
  const swallow = (e: Event) => { if (!imeNoSwallow) e.stopPropagation(); };

  root.addEventListener('beforeinput', onBeforeInput, true);
  root.addEventListener('input', onInput, true);
  root.addEventListener('keydown', onKeyDown, true);
  for (const t of COMPOSITION) root.addEventListener(t, swallow, true);
  // 진단(ime-debug.on): 키·입력·조합 이벤트를 그대로 적는다 — 진짜 키보드는 osascript 와 다른 길로 올 수 있어서
  const TRACE = ['keydown', 'keyup', 'beforeinput', 'input', ...COMPOSITION];
  const trace = (e: Event) => {
    if (!imeTrace) return; // 진단 설정은 창이 뜬 뒤에 도착할 수 있어서 늘 걸어 두고 여기서 본다
    const k = e as KeyboardEvent & InputEvent & CompositionEvent;
    imeTrace?.(e.type, { key: k.key, code: k.code, kc: k.keyCode, rep: k.repeat, comp: k.isComposing, it: k.inputType, data: k.data, ta: ta.value });
  };
  for (const t of TRACE) root.addEventListener(t, trace, true);
  return () => {
    for (const t of TRACE) root.removeEventListener(t, trace, true);
    root.removeEventListener('beforeinput', onBeforeInput, true);
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('keydown', onKeyDown, true);
    for (const t of COMPOSITION) root.removeEventListener(t, swallow, true);
  };
}
