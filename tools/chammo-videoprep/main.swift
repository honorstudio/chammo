// 영상 검토 도우미 — 폰으로 보낼 저용량(540p H.264 700kbps·키프레임 1초)과 끄는 동안 보여 줄 그림 묶음을 만든다. 맥 기본 프레임워크만.
// chammo-videoprep <원본> <나갈 폴더> [--no-low]
// 표준 출력: 줄마다 JSON — {"info":{…}} 먼저, 그다음 {"p":0.42}, 끝에 {"done":true}. 실패는 {"error":"…"} + 종료 1.
// 나갈 폴더엔 .part 로 쓰고 끝나면 이름을 바꾼다 — 앱은 이름이 맞는 파일만 읽어서 반쪽 파일을 내주지 않는다.
// 시각은 원본 그대로(자르지 않음) — 저용량에서 잡은 시각이 원본·필름에서도 맞아야 한다.
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

setbuf(stdout, nil)
_ = setpriority(PRIO_PROCESS, 0, 10) // 앱이 쓰는 동안 맥을 안 잡는다

func say(_ o: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s) }
}
func fail(_ m: String) -> Never {
    say(["error": m])
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: chammo-videoprep <in> <outdir> [--no-low]") }
let inURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let wantLow = !args.contains("--no-low")
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: inURL)
guard let vt = asset.tracks(withMediaType: .video).first else { fail("no video track") }
let dur = CMTimeGetSeconds(asset.duration)
guard dur.isFinite, dur > 0 else { fail("no duration") }
let fps = vt.nominalFrameRate > 0 ? vt.nominalFrameRate : 30
let natural = vt.naturalSize

/// 가로세로를 유지해 긴 변 960·짧은 변 540 안으로, 짝수로
func fit(_ s: CGSize, _ maxW: CGFloat, _ maxH: CGFloat) -> CGSize {
    let long = max(s.width, s.height), short = min(s.width, s.height)
    let k = min(1, min(maxW / long, maxH / short))
    let even = { (v: CGFloat) -> CGFloat in max(2, (v * k / 2).rounded() * 2) }
    return CGSize(width: even(s.width), height: even(s.height))
}

// 그림 묶음 — 먼저 만든다(저용량보다 훨씬 빠르고, 이것만 있어도 끌 수 있다)
let interval = max(2.0, dur / 600)
let count = max(1, Int((dur / interval).rounded(.up)))
let cols = 10, rows = 10, perSheet = cols * rows
let shown = natural.applying(vt.preferredTransform)
let display = CGSize(width: abs(shown.width), height: abs(shown.height))
let cell = fit(display, 160, 160 * min(display.width, display.height) / max(display.width, display.height))

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = cell
gen.requestedTimeToleranceBefore = CMTime(seconds: 1, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: 1, preferredTimescale: 600)

func writeJPEG(_ img: CGImage, _ url: URL) -> Bool {
    let tmp = url.appendingPathExtension("part")
    guard let d = CGImageDestinationCreateWithURL(tmp as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
    CGImageDestinationAddImage(d, img, [kCGImageDestinationLossyCompressionQuality: 0.55] as CFDictionary)
    guard CGImageDestinationFinalize(d) else { return false }
    try? FileManager.default.removeItem(at: url) // 앞 판이 도중에 꺼졌을 수 있다
    return (try? FileManager.default.moveItem(at: tmp, to: url)) != nil
}

let sheets = Int((Double(count) / Double(perSheet)).rounded(.up))
for sheet in 0..<sheets {
    let first = sheet * perSheet
    let n = min(perSheet, count - first)
    guard let ctx = CGContext(data: nil, width: cols * Int(cell.width), height: rows * Int(cell.height), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fail("no canvas") }
    ctx.setFillColor(gray: 0, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: ctx.width, height: ctx.height))
    let times = (0..<n).map { NSValue(time: CMTime(seconds: Double(first + $0) * interval, preferredTimescale: 600)) }
    let sem = DispatchSemaphore(value: 0)
    var left = n
    let lock = NSLock()
    gen.generateCGImagesAsynchronously(forTimes: times) { req, img, _, _, _ in
        lock.lock(); defer { lock.unlock() }
        if let img = img {
            let i = Int((CMTimeGetSeconds(req) / interval).rounded()) - first
            let x = (i % cols) * Int(cell.width)
            let y = ctx.height - (i / cols + 1) * Int(cell.height) // CG 는 아래가 0
            ctx.draw(img, in: CGRect(x: x, y: y, width: Int(cell.width), height: Int(cell.height)))
        }
        left -= 1
        if left == 0 { sem.signal() }
    }
    sem.wait()
    guard let out = ctx.makeImage(), writeJPEG(out, outDir.appendingPathComponent("sprite-\(sheet).jpg")) else { fail("sprite write failed") }
}

say(["info": ["duration": dur, "fps": fps, "width": Int(display.width), "height": Int(display.height),
              "sprite": ["interval": interval, "cols": cols, "rows": rows, "count": count, "cw": Int(cell.width), "ch": Int(cell.height), "sheets": sheets]]])

if !wantLow {
    say(["done": true])
    exit(0)
}

// 저용량
let lowURL = outDir.appendingPathComponent("low.mp4")
let tmpURL = outDir.appendingPathComponent("low.part.mp4")
try? FileManager.default.removeItem(at: tmpURL)
guard let reader = try? AVAssetReader(asset: asset), let writer = try? AVAssetWriter(outputURL: tmpURL, fileType: .mp4) else { fail("no reader or writer") }
writer.shouldOptimizeForNetworkUse = true // 앞에 목차 — 폰이 첫 조각만 받고 시작한다

let size = fit(natural, 960, 540)
let vOut = AVAssetReaderTrackOutput(track: vt, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
vOut.alwaysCopiesSampleData = false
guard reader.canAdd(vOut) else { fail("cannot read video") }
reader.add(vOut)
let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height), AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 700_000, AVVideoMaxKeyFrameIntervalKey: Int(fps.rounded()), AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel],
])
vIn.transform = vt.preferredTransform
vIn.expectsMediaDataInRealTime = false
guard writer.canAdd(vIn) else { fail("cannot write video") }
writer.add(vIn)

var aOut: AVAssetReaderTrackOutput?
var aIn: AVAssetWriterInput?
if let at = asset.tracks(withMediaType: .audio).first {
    let o = AVAssetReaderTrackOutput(track: at, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false])
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64_000])
    i.expectsMediaDataInRealTime = false
    if reader.canAdd(o), writer.canAdd(i) {
        reader.add(o)
        writer.add(i)
        aOut = o
        aIn = i
    }
}

guard reader.startReading(), writer.startWriting() else { fail(writer.error?.localizedDescription ?? reader.error?.localizedDescription ?? "cannot start") }
writer.startSession(atSourceTime: .zero)

let group = DispatchGroup()
var lastP = -1.0
let pLock = NSLock()
func pump(_ out: AVAssetReaderOutput, _ into: AVAssetWriterInput, _ name: String, progress: Bool) {
    group.enter()
    let q = DispatchQueue(label: name)
    into.requestMediaDataWhenReady(on: q) {
        while into.isReadyForMoreMediaData {
            guard let b = out.copyNextSampleBuffer() else {
                into.markAsFinished()
                group.leave()
                return
            }
            if progress {
                let p = (CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(b)) / dur * 100).rounded() / 100
                pLock.lock()
                if p > lastP { lastP = p; say(["p": p]) }
                pLock.unlock()
            }
            if !into.append(b) {
                into.markAsFinished()
                group.leave()
                return
            }
        }
    }
}
pump(vOut, vIn, "video", progress: true)
if let o = aOut, let i = aIn { pump(o, i, "audio", progress: false) }
group.wait()
if reader.status == .failed { fail(reader.error?.localizedDescription ?? "read failed") }

let end = DispatchSemaphore(value: 0)
writer.finishWriting { end.signal() }
end.wait()
guard writer.status == .completed else { fail(writer.error?.localizedDescription ?? "write failed") }
try? FileManager.default.removeItem(at: lowURL)
do { try FileManager.default.moveItem(at: tmpURL, to: lowURL) } catch { fail("move failed") }
// shouldOptimizeForNetworkUse 가 곁에 low.part.mp4.sb-… 임시 파일을 남긴다(17MB, 11-04 실측)
for f in (try? FileManager.default.contentsOfDirectory(atPath: outDir.path)) ?? [] where f.hasPrefix("low.part.mp4") {
    try? FileManager.default.removeItem(at: outDir.appendingPathComponent(f))
}
say(["done": true])
