import { describe, expect, it } from 'vitest';
import view from './ChatView.tsx?raw';
import app from '../../App.tsx?raw';
import css from './chat.css?raw';

// 2026-10-11 사용자: 음성 모드 단추를 참모 패널에서 빼서 채팅 입력칸 옆 단추 줄로 — 켜짐 검은 면은 그대로
describe('채팅 입력칸 옆 음성 모드 단추', () => {
  const row = view.slice(view.indexOf('<div className="chat-input">'), view.indexOf('</div>\n    </div>\n  );\n}'));
  it('입력칸 단추 줄(멈춤·보내기 옆)에 있다 — 직접 그린 스피커 아이콘, 이름은 aria-label·title, 켜짐은 aria-pressed', () => {
    expect(row).toMatch(/className=\{`btn chat-voice\$\{voice\.on \? ' on' : ''\}`\}/);
    expect(row).toMatch(/aria-pressed=\{voice\.on\}/);
    expect(row).toMatch(/<IconSpeaker \/>/);
    expect(row.indexOf('chat-voice')).toBeLessThan(row.indexOf('chat-send'));
  });
  it('참모 채팅 열(스페이스)에만 — App 이 그 열을 ChatVoice 로 감싼다', () => {
    expect(view).toMatch(/useContext\(ChatVoice\)/);
    expect(app).toMatch(/<ChatVoice\.Provider value=\{features\.voice \? \{ on: voice, toggle: \(\) => turnVoice\(!voice\) \} : null\}>/); // 음성 기능을 꺼 두면 단추도 없다
  });
  it('켜짐은 검은 면(위 막대 .voice.on 과 같은 accent)', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).toMatch(/\.chat-input \.chat-voice\.on \{[^}]*background: var\(--accent\)/);
  });
});
