// 설정 > 기기 관리 > 폰 — 폰이 어떤 길로 붙나 한 줄. 0.4.0 부터 Chammo 계정에 로그인하면 테일스케일 없이 중계로 붙는다(ADR 0013).
// 11-01 사용자: 폰 VPN(테일스케일)은 금융 앱을 막는다 — 로그인 전에도 테일스케일을 권하지 않고, 로그인 뒤엔 '있으면' 덤으로만
import { tr } from '../i18n';

/** relayReady = 이 기기가 Chammo 계정에 로그인돼 중계 길이 준비됨(Rust phone_relay::ready). login = 계정 탭으로 가는 단추를 띄우나 */
export function phoneReachHint(relayReady: boolean): { text: string; login: boolean } {
  return relayReady
    ? { login: false, text: tr('어디서나 붙고 내용은 암호화돼요. 테일스케일이 있으면 더 빠른 길도 써요.', 'Connects from anywhere, with content encrypted. If you have Tailscale, a faster path is used too.') }
    : { login: true, text: tr('Chammo 계정에 로그인하면 폰이 어디서나 붙어요.', 'Sign in to your Chammo account and your phone connects from anywhere.') };
}
