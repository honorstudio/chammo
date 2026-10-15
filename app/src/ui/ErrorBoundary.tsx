// 렌더 오류 하나로 창 전체가 흰 화면이 되지 않게(2026-10-11 bug-hunt — src 에 막이가 하나도 없었다). 무엇이 깨졌는지 한 줄 + 다시 그리기
import { Component, type ReactNode } from 'react';
import { tr } from '../i18n';
import { IconRefresh } from './Icons';

type State = { err: string | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };
  static getDerivedStateFromError(e: unknown): State {
    return { err: String(e instanceof Error ? e.message : e).slice(0, 300) };
  }
  render() {
    if (this.state.err === null) return this.props.children;
    const again = tr('다시 그리기', 'Redraw');
    return (
      <div className="crash" role="alert" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <b>{tr('화면을 그리다 멈췄어요', 'The screen stopped drawing')}</b>
        <code style={{ whiteSpace: 'pre-wrap', opacity: 0.7 }}>{this.state.err}</code>
        <button className="btn" onClick={() => this.setState({ err: null })} aria-label={again} title={again}><IconRefresh /></button>
      </div>
    );
  }
}
