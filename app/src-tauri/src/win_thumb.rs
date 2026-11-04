//! 윈도우 파일 썸네일 — 맥 sips·qlmanage 자리(2026-11-01 H). 윈도우엔 그 둘이 없어 카드가 그림 말고는 다 확장자 표였고
//! 폰 썸네일은 502 였다(공개 이슈 #15). 새 크레이트 없이 윈도우에 늘 있는 것만:
//! - 그림(png·jpg·gif·bmp·tiff) 줄이기 → GDI+(win_jpeg 와 같은 것)
//! - PDF 첫 장 → Windows.Data.Pdf(윈10+ 내장 WinRT)
//! - 그 밖(영상·오피스·psd·svg·hwp·webp·heic …) → 탐색기 썸네일과 같은 셸 썸네일(IShellItemImageFactory). 그 형식의 썸네일
//!   처리기가 깔린 PC 에서만 나온다(영상은 기본, 오피스는 오피스, hwp 는 한컴, svg·psd 는 PowerToys 등) — 아이콘으로 대신하지 않는다
//! 결과는 늘 흰 바탕 JPEG(품질 85, 긴 변 max). 이 파일은 crate:: 에 기대지 않는다 — 윈도우 실측 프로브가 #[path] 로 같이 쓴다
#![allow(non_snake_case)]
#![cfg_attr(not(windows), allow(dead_code))]
#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::path::PathBuf;
#[cfg(windows)]
use std::sync::OnceLock;
use std::path::Path;
use std::time::Duration;

#[cfg(windows)]
use windows_sys::Win32::Graphics::GdiPlus::*;

/// 한 장의 한도 — 걸린 썸네일 처리기·큰 PDF 가 붙잡지 않게(맥 THUMB_LIMIT 와 같은 20초). 넘기면 그 실은 버리고 None
pub const LIMIT: Duration = Duration::from_secs(20);

#[cfg(windows)]
const PIXEL_24RGB: i32 = 0x0002_1808;
#[cfg(windows)]
const PIXEL_32PARGB: i32 = 0x000E_200B;
#[cfg(windows)]
const WHITE: u32 = 0xFFFF_FFFF;
#[cfg(windows)]
/// GDI+ JPEG 인코더 {557CF401-1A04-11D3-9A73-0000F81EF32E}
const JPEG_CLSID: windows_sys::core::GUID = windows_sys::core::GUID::from_u128(0x557cf401_1a04_11d3_9a73_0000f81ef32e);

/// GDI+ 로 바로 읽는 그림 — 나머지 그림(webp·heic·svg …)은 셸 썸네일(WIC 확장이 깔렸으면 나온다)
pub fn gdip_image(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| ["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"].contains(&e.to_ascii_lowercase().as_str()))
}

pub fn is_pdf(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

/// 긴 변 max 안에 들게 줄인 크기(키우지 않는다). max = None 이면 그대로
pub fn fit(w: u32, h: u32, max: Option<u32>) -> (u32, u32) {
    let Some(m) = max else { return (w.max(1), h.max(1)) };
    let long = w.max(h);
    if long <= m || long == 0 {
        return (w.max(1), h.max(1));
    }
    let s = m as f64 / long as f64;
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

/// 셸이 준 32비트 그림에 알파가 하나도 없으면(불투명 처리기가 알파를 0 으로 둔 것) 불투명으로 — 안 그러면 흰 장이 된다
pub fn opaque_if_no_alpha(bgra: &mut [u8]) {
    if bgra.chunks_exact(4).all(|p| p[3] == 0) {
        bgra.chunks_exact_mut(4).for_each(|p| p[3] = 255);
    }
}

#[cfg(windows)]
fn wide(p: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    p.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn gdiplus() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| unsafe {
        let mut token = 0usize;
        let input = GdiplusStartupInput { GdiplusVersion: 1, ..Default::default() };
        GdiplusStartup(&mut token, &input, std::ptr::null_mut()) == 0
    })
}

#[cfg(windows)]
fn tmp(ext: &str) -> PathBuf {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    std::env::temp_dir().join(format!("chammo-wthumb-{}-{}.{ext}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)))
}

#[cfg(windows)]
/// GDI+ 그림 하나를 흰 바탕에 긴 변 max 로 그려 JPEG 바이트로. 그림은 부른 쪽이 치운다
unsafe fn encode(src: *mut GpImage, max: Option<u32>) -> Option<Vec<u8>> {
    unsafe {
        let (mut w, mut h) = (0u32, 0u32);
        GdipGetImageWidth(src, &mut w);
        GdipGetImageHeight(src, &mut h);
        if w == 0 || h == 0 {
            return None;
        }
        let (tw, th) = fit(w, h, max);
        let mut dst: *mut GpBitmap = std::ptr::null_mut();
        if GdipCreateBitmapFromScan0(tw as i32, th as i32, 0, PIXEL_24RGB, std::ptr::null(), &mut dst) != 0 || dst.is_null() {
            return None;
        }
        let mut g: *mut GpGraphics = std::ptr::null_mut();
        let drawn = GdipGetImageGraphicsContext(dst as *mut GpImage, &mut g) == 0
            && !g.is_null()
            && GdipGraphicsClear(g, WHITE) == 0
            && GdipSetInterpolationMode(g, InterpolationModeHighQualityBicubic) == 0
            && GdipDrawImageRectI(g, src, 0, 0, tw as i32, th as i32) == 0;
        if !g.is_null() {
            GdipDeleteGraphics(g);
        }
        let out = tmp("jpg");
        let mut quality: u32 = 85;
        let params = EncoderParameters {
            Count: 1,
            Parameter: [EncoderParameter { Guid: EncoderQuality, NumberOfValues: 1, Type: EncoderParameterValueTypeLong as u32, Value: &mut quality as *mut u32 as *mut c_void }],
        };
        let saved = drawn && GdipSaveImageToFile(dst as *mut GpImage, wide(&out).as_ptr(), &JPEG_CLSID, &params) == 0;
        GdipDisposeImage(dst as *mut GpImage);
        let bytes = saved.then(|| std::fs::read(&out).ok()).flatten().filter(|b| !b.is_empty());
        let _ = std::fs::remove_file(&out);
        bytes
    }
}

#[cfg(windows)]
/// 그림 파일 → JPEG(긴 변 max, None 이면 크기 그대로) — 맥 sips_jpeg 자리
pub fn image_jpeg(src: &Path, max: Option<u32>) -> Option<Vec<u8>> {
    if !gdiplus() {
        return None;
    }
    unsafe {
        let mut bmp: *mut GpBitmap = std::ptr::null_mut();
        if GdipCreateBitmapFromFile(wide(src).as_ptr(), &mut bmp) != 0 || bmp.is_null() {
            return None;
        }
        let out = encode(bmp as *mut GpImage, max);
        GdipDisposeImage(bmp as *mut GpImage);
        out
    }
}

#[cfg(windows)]
/// 위에서 아래로 BGRA(곱한 알파) 화소 → JPEG
fn bgra_jpeg(w: u32, h: u32, px: &mut [u8], max: Option<u32>) -> Option<Vec<u8>> {
    if !gdiplus() || px.len() < (w * h * 4) as usize {
        return None;
    }
    opaque_if_no_alpha(px);
    unsafe {
        let mut bmp: *mut GpBitmap = std::ptr::null_mut();
        if GdipCreateBitmapFromScan0(w as i32, h as i32, (w * 4) as i32, PIXEL_32PARGB, px.as_ptr(), &mut bmp) != 0 || bmp.is_null() {
            return None;
        }
        let out = encode(bmp as *mut GpImage, max);
        GdipDisposeImage(bmp as *mut GpImage);
        out
    }
}

#[cfg(windows)]
/// 탐색기와 같은 셸 썸네일 — 처리기가 없으면(아이콘뿐) None
fn shell_jpeg(src: &Path, max: u32) -> Option<Vec<u8>> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY};
    use windows_sys::Win32::Graphics::Gdi::{DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
    unsafe {
        let f: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(src.as_os_str()), None).ok()?;
        let hbm = f.GetImage(SIZE { cx: max as i32, cy: max as i32 }, SIIGBF_THUMBNAILONLY).ok()?;
        let h = hbm.0 as *mut c_void;
        let mut bm: BITMAP = std::mem::zeroed();
        let got = GetObjectW(h, std::mem::size_of::<BITMAP>() as i32, &mut bm as *mut BITMAP as *mut c_void) != 0;
        let (w, ht) = (bm.bmWidth.max(0) as u32, bm.bmHeight.unsigned_abs());
        let mut out = None;
        if got && w > 0 && ht > 0 {
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w as i32, biHeight: -(ht as i32), biPlanes: 1, biBitCount: 32, biCompression: BI_RGB, ..std::mem::zeroed() };
            let mut px = vec![0u8; (w * ht * 4) as usize];
            let dc = GetDC(std::ptr::null_mut());
            let lines = GetDIBits(dc, h, 0, ht, px.as_mut_ptr() as *mut c_void, &mut info, DIB_RGB_COLORS);
            ReleaseDC(std::ptr::null_mut(), dc);
            if lines as u32 == ht {
                out = bgra_jpeg(w, ht, &mut px, Some(max));
            }
        }
        DeleteObject(h);
        out
    }
}

#[cfg(windows)]
/// PDF 첫 장 — Windows.Data.Pdf 로 긴 변 max 의 PNG 를 그린 뒤 흰 바탕 JPEG
fn pdf_jpeg(src: &Path, max: u32) -> Option<Vec<u8>> {
    use windows::core::HSTRING;
    use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
    use windows::Storage::StorageFile;
    use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
    let png = (|| -> windows::core::Result<Vec<u8>> {
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(src.as_os_str()))?.get()?;
        let doc = PdfDocument::LoadFromFileAsync(&file)?.get()?;
        let page = doc.GetPage(0)?;
        let size = page.Size()?;
        let opts = PdfPageRenderOptions::new()?;
        if size.Width >= size.Height {
            opts.SetDestinationWidth(max)?;
        } else {
            opts.SetDestinationHeight(max)?;
        }
        let stream = InMemoryRandomAccessStream::new()?;
        page.RenderWithOptionsToStreamAsync(&stream, &opts)?.get()?;
        let n = stream.Size()? as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(n)?.get()?;
        let mut buf = vec![0u8; n as usize];
        reader.ReadBytes(&mut buf)?;
        std::result::Result::Ok(buf) // GdiPlus::* 의 Ok(상태 상수)가 가린다
    })()
    .ok()?;
    let p = tmp("png");
    std::fs::write(&p, &png).ok()?;
    let out = image_jpeg(&p, Some(max));
    let _ = std::fs::remove_file(&p);
    out
}

#[cfg(windows)]
/// 카드 썸네일 한 장(맥 qlmanage -t 자리) — 그림은 GDI+, PDF 는 Windows.Data.Pdf, 그 밖은 셸 썸네일.
/// 따로 실(STA)에서 돌리고 LIMIT 를 넘기면 버린다(걸린 처리기가 부른 쪽을 붙잡지 않게).
/// 셸 썸네일·WinRT 는 화면 세션에서만 된다 — SSH(세션 0)에선 PDF·영상도 실패한다(앱은 늘 화면 세션이라 괜찮다, 11-01 실측)
pub fn first_page_jpeg(src: &Path, max: u32) -> Option<Vec<u8>> {
    // 셸·WinRT 는 절대 경로만 받는다(상대 경로면 0ms 에 실패 — 11-01 시험 PC 실측)
    let src = std::path::absolute(src).ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("win-thumb".into())
        .spawn(move || {
            use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
            let inited = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
            let out = if gdip_image(&src) {
                image_jpeg(&src, Some(max)).or_else(|| shell_jpeg(&src, max))
            } else if is_pdf(&src) {
                pdf_jpeg(&src, max).or_else(|| shell_jpeg(&src, max))
            } else {
                shell_jpeg(&src, max)
            };
            if inited {
                unsafe { CoUninitialize() };
            }
            let _ = tx.send(out);
        })
        .ok()?;
    rx.recv_timeout(LIMIT).ok().flatten()
}

#[cfg(test)]
#[path = "win_thumb_tests.rs"]
mod tests;
