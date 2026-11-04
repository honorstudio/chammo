use super::*;

#[test]
fn 긴_변을_max_안으로_줄이고_키우지_않는다() {
    assert_eq!(fit(4000, 3000, Some(480)), (480, 360));
    assert_eq!(fit(3000, 4000, Some(480)), (360, 480));
    assert_eq!(fit(300, 200, Some(480)), (300, 200), "작은 건 그대로");
    assert_eq!(fit(10000, 3, Some(480)), (480, 1), "아주 납작해도 1px 은 남긴다");
    assert_eq!(fit(1200, 800, None), (1200, 800));
}

#[test]
fn 셸_그림에_알파가_하나도_없으면_불투명으로() {
    // 불투명 썸네일 처리기가 알파 바이트를 0 으로 두면 곱한 알파로 그릴 때 흰 장이 된다
    let mut px = vec![10, 20, 30, 0, 40, 50, 60, 0];
    opaque_if_no_alpha(&mut px);
    assert_eq!(px, vec![10, 20, 30, 255, 40, 50, 60, 255]);
    // 알파가 하나라도 있으면(투명 PNG 썸네일) 그대로
    let mut px = vec![10, 20, 30, 0, 40, 50, 60, 128];
    opaque_if_no_alpha(&mut px);
    assert_eq!(px, vec![10, 20, 30, 0, 40, 50, 60, 128]);
}

#[test]
fn 어느_길로_그리나() {
    for p in ["a.png", "a.JPG", "a.jpeg", "a.gif", "a.bmp", "a.tif", "a.tiff"] {
        assert!(gdip_image(Path::new(p)), "{p}");
    }
    for p in ["a.webp", "a.heic", "a.svg", "a.psd", "a.pdf", "a.mp4"] {
        assert!(!gdip_image(Path::new(p)), "{p} 는 셸·PDF 길");
    }
    assert!(is_pdf(Path::new("발주.PDF")));
    assert!(!is_pdf(Path::new("a.pdf.zip")));
}
