// chammo-accessory.dylib — 세션 크롬(Chammo Browser 사본, ad-hoc 재서명)에 DYLD_INSERT_LIBRARIES 로 넣어 Dock·⌘Tab 에서 뺀다(2026-10-27 인앱 브라우저 A).
// 남의 앱 activation policy 는 밖에서 못 바꾸고(비공개 API 도 무시), Info.plist LSUIElement 는 크롬이 자기를 도우미로 여겨 죽는다 —
// 크롬 안에서 setActivationPolicy(accessory) 를 거는 게 유일하게 된 길(docs/research/2026-10-27-inapp-browser-spike.md 1절).
// 앱 빌드(app/src-tauri/build.rs)가 clang 으로 만들어 데이터 폴더 tools/ 에 깐다. 다윈 알림 chammo.<pid>.regular|accessory 로 바꾼다('크롬에서 보기' 동안 regular)
#import <AppKit/AppKit.h>
#include <notify.h>
#include <stdlib.h>
#include <unistd.h>

static void apply(NSApplicationActivationPolicy p) {
  dispatch_async(dispatch_get_main_queue(), ^{ [NSApp setActivationPolicy:p]; });
}

__attribute__((constructor)) static void chammo_accessory_init(void) {
  // 렌더러·GPU 같은 도우미 프로세스(--type=)엔 아무것도 안 한다 — 브라우저 프로세스만
  NSArray *args = [[NSProcessInfo processInfo] arguments];
  for (NSString *a in args) if ([a hasPrefix:@"--type="]) return;
  // 이 뒤로 띄우는 도우미들이 물려받지 않게(샌드박스 렌더러에 AppKit 을 싣지 않는다)
  unsetenv("DYLD_INSERT_LIBRARIES");
  for (NSString *name in @[ NSApplicationWillFinishLaunchingNotification, NSApplicationDidFinishLaunchingNotification ]) {
    [[NSNotificationCenter defaultCenter] addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *n) {
      [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    }];
  }
  int t1, t2;
  char name[96];
  snprintf(name, sizeof name, "chammo.%d.regular", getpid());
  notify_register_dispatch(name, &t1, dispatch_get_main_queue(), ^(int t) { apply(NSApplicationActivationPolicyRegular); });
  snprintf(name, sizeof name, "chammo.%d.accessory", getpid());
  notify_register_dispatch(name, &t2, dispatch_get_main_queue(), ^(int t) { apply(NSApplicationActivationPolicyAccessory); });
}
