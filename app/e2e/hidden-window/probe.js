// 시험 앱 창 살피기(JXA) — osascript -l JavaScript probe.js <pid> → 앞 앱·활성화 정책·그 pid 창 자리·화면들(위 왼쪽 기준 논리 좌표)
ObjC.import('AppKit'); ObjC.import('CoreGraphics');
function run(argv){
  var pid = parseInt(argv[0]);
  var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  var wins = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0))) || [];
  var mine = wins.filter(function(w){return w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0;}).map(function(w){return {b:w.kCGWindowBounds, on:!!w.kCGWindowIsOnscreen, name:w.kCGWindowName||''};});
  var screens = [];
  var mainH = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  for (var i=0;i<$.NSScreen.screens.count;i++){var f=$.NSScreen.screens.objectAtIndex(i).frame; screens.push({X:f.origin.x, Y:mainH-f.origin.y-f.size.height, W:f.size.width, H:f.size.height, name:ObjC.unwrap($.NSScreen.screens.objectAtIndex(i).localizedName)});}
  return JSON.stringify({front: front.processIdentifier, frontName: ObjC.unwrap(front.localizedName), policy: app.isNil() ? null : app.activationPolicy, active: app.isNil()? null : app.active, windows: mine, screens: screens});
}
