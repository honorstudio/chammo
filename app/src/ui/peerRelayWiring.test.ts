import { describe, expect, it } from 'vitest';
import dev from './DevicesSection.tsx?raw';

// 컴퓨터끼리 잇기(시안 peer-relay 안 A, 사용자 11-01) — '내 기기' 컴퓨터 줄에서. 리뷰 뒤 A 카드는 A 앱·A 의 폰만 누른다
describe('내 기기 컴퓨터 줄 잇기', () => {
  it('연결은 사람 클릭(isTrusted)만 Rust peer_relay_connect 로', () => {
    expect(dev).toMatch(/const connectPeer = \(e: React\.MouseEvent, id: string\) => \{\s*if \(!e\.nativeEvent\.isTrusted\) return;/);
    expect(dev).toContain("invoke('peer_relay_connect', { hub: id })");
  });
  it('숫자 안내는 폰에서 — 다른 컴퓨터에서 누르라고 하지 않는다', () => {
    expect(dev).toContain('폰에서 확인하고 허용해 주세요');
    expect(dev).not.toContain('다른 컴퓨터에서');
  });
  it('이어진 컴퓨터 참모는 relay:<id> 로 채팅, 참모 목록은 5초 고리 밖에서', () => {
    expect(dev).toContain('chatPeer(`relay:${r.id}`');
    expect(dev).toMatch(/useEffect\(\(\) => \{\s*for \(const id of linked\)/);
  });
});
