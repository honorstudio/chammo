// 한/영 두 언어 — 프런트의 tr('한국어', 'English') 와 같은 방식. 언어는 설정(config.json 의 language)을 따른다.
// config::current() 가 처음 한 번 파일을 읽고 기억해 두니 매번 불러도 싸다

/// 언어 코드로 고르기(테스트용으로 따로 뺐다). "en" 만 영어, 나머지는 한국어
pub fn pick<'a>(lang: &str, ko: &'a str, en: &'a str) -> &'a str {
    if lang == "en" { en } else { ko }
}

/// 지금 설정 언어가 영어인가 — format! 이 필요한 문장은 이걸로 가른다
pub fn is_en() -> bool {
    crate::config::current().language == "en"
}

/// 사용자에게 보이는 글자 — 설정 언어로
pub fn tr<'a>(ko: &'a str, en: &'a str) -> &'a str {
    pick(&crate::config::current().language, ko, en)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 영어만_영어_나머지는_한국어() {
        assert_eq!(pick("en", "저장", "Save"), "Save");
        assert_eq!(pick("ko", "저장", "Save"), "저장");
        assert_eq!(pick("", "저장", "Save"), "저장");
    }
}
