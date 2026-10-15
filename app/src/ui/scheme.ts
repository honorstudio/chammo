// 지금 앱 테마(라이트·다크) — 데스크톱은 테마 메뉴(theme.rs)가 창 모양을 바꾸면 웹뷰 prefers-color-scheme 이 따라오고, 폰은 화면 설정.
// 페이지 CSS 는 알아서 따라가지만 <img> 안 SVG(모드 Svg)는 못 봐서 이 값을 넘겨 다시 그린다
import { useEffect, useState } from 'react';
import type { Scheme } from '../domain/modeSvg';
import { darkQuery } from './termTheme';

const now = (): Scheme => (darkQuery().matches ? 'dark' : 'light');

export function useScheme(): Scheme {
  const [scheme, setScheme] = useState(now);
  useEffect(() => {
    const mq = darkQuery();
    const on = () => setScheme(now());
    mq.addEventListener('change', on);
    on(); // 붙기 전에 바뀐 것까지
    return () => mq.removeEventListener('change', on);
  }, []);
  return scheme;
}
