// 설정 > 기기 관리 > 폰 — 폰이 어떤 길로 붙나 한 줄. 0.4.0 부터 Chammo 계정에 로그인하면 테일스케일 없이 중계로 붙는다(ADR 0013)
import { tr } from '../i18n';

/** relayReady = 이 기기가 Chammo 계정에 로그인돼 중계 길이 준비됨(Rust phone_relay::ready). login = 계정 탭으로 가는 단추를 띄우나 */
export function phoneReachHint(relayReady: boolean): { text: string; login: boolean } {
  return relayReady
    ? { login: false, text: tr('Chammo 계정에 로그인돼 있어서 폰이 어디서나 중계로 붙어요(내용은 종단 암호). 테일스케일이 있으면 그 길도 같이 써요.', 'This device is signed in to your Chammo account, so phones connect from anywhere through the relay (end-to-end encrypted). Tailscale works too if you have it.') }
    : { login: true, text: tr('Chammo 계정에 로그인하면 테일스케일 없이도 어디서나 붙어요. 지금은 테일스케일로만 열려요(폰도 같은 테일스케일 계정).', 'Sign in to your Chammo account and phones connect from anywhere, no Tailscale needed. For now it opens over Tailscale only (the phone on the same Tailscale account).') };
}
