use super::*;
use std::cell::{Cell, RefCell};

/// 받는 쪽(B) 가짜 환경 — 되묻기는 요청하는 쪽(A)의 Asks 에 진짜로 묻는다
struct Env<'a> {
    a: &'a Asks,
    now: Cell<u64>,
    supported: bool,
    peers: Vec<LinkPeer>,
    confirms: Cell<u32>,
    cards: RefCell<Vec<(String, String, u64)>>,
    closed: RefCell<Vec<(String, bool, String)>>,
    commits: RefCell<Vec<String>>,
    commit_fails: bool,
}

fn peer(id: &str, name: &str) -> LinkPeer {
    LinkPeer { id: id.into(), name: name.into(), os: "macOS".into(), ip: "100.64.0.20".parse().unwrap(), tailnet: "example.ts.net".into() }
}

fn env(a: &Asks) -> Env<'_> {
    Env {
        a,
        now: Cell::new(T0),
        supported: true,
        peers: vec![peer("nA", "office-mac"), peer("nC", "home-mac"), peer("nD", "studio"), peer("nE", "spare")],
        confirms: Cell::new(0),
        cards: RefCell::new(Vec::new()),
        closed: RefCell::new(Vec::new()),
        commits: RefCell::new(Vec::new()),
        commit_fails: false,
    }
}

impl LinkEnv for Env<'_> {
    fn supported(&self) -> bool {
        self.supported
    }
    fn lookup(&self, node: &str) -> Option<LinkPeer> {
        self.peers.iter().find(|p| p.id == node).cloned()
    }
    fn confirm(&self, _peer: &LinkPeer, hash: &str) -> bool {
        self.confirms.set(self.confirms.get() + 1);
        self.a.asking(hash, self.now.get())
    }
    fn card(&self, peer: &LinkPeer, until: u64) -> Result<String, String> {
        let id = format!("card{}", self.cards.borrow().len() + 1);
        self.cards.borrow_mut().push((id.clone(), peer.name.clone(), until));
        Ok(id)
    }
    fn close_card(&self, card: &str, done: bool, note: &str) {
        self.closed.borrow_mut().push((card.into(), done, note.into()));
    }
    fn commit(&self, peer: &LinkPeer) -> Result<(String, String), String> {
        if self.commit_fails {
            return Err("키체인".into());
        }
        self.commits.borrow_mut().push(peer.id.clone());
        Ok(("a".repeat(64), "b".repeat(64)))
    }
}

const T0: u64 = 1_800_000_000_000;

#[test]
fn pe_허용하면_열쇠_둘을_한_번만_받아_간다() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    let req = a.start("nB", T0).unwrap();
    b.request(&e, &req, "nA", T0).unwrap();
    let (card, name, until) = e.cards.borrow()[0].clone();
    assert_eq!((name.as_str(), until), ("office-mac", T0 + TTL_MS), "카드 이름은 받는 쪽 테일넷이 아는 이름");
    assert_eq!(b.status(&e, &req, T0 + 1000), Status::Wait);
    b.decide(&card, true, T0 + 2000).unwrap();
    assert!(e.commits.borrow().is_empty(), "열쇠는 받아 갈 때 만든다");
    assert_eq!(b.status(&e, &req, T0 + 3000), Status::Yes { token: "a".repeat(64), back: "b".repeat(64) });
    assert_eq!(*e.commits.borrow(), ["nA"]);
    assert_eq!(e.closed.borrow()[0], (card.clone(), true, "연결됨".into()));
    assert_eq!(b.status(&e, &req, T0 + 4000), Status::Unknown, "한 번 받아 가면 끝");
    assert!(b.decide(&card, true, T0 + 5000).is_err(), "끝난 카드는 다시 못 누른다");
}

#[test]
fn pe_거절하면_아무것도_안_생긴다() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    let req = a.start("nB", T0).unwrap();
    b.request(&e, &req, "nA", T0).unwrap();
    let card = e.cards.borrow()[0].0.clone();
    b.decide(&card, false, T0 + 1000).unwrap();
    assert!(b.decide(&card, true, T0 + 1500).is_err(), "거절한 뒤 허용으로 바꿀 수 없다(새 요청으로)");
    assert_eq!(b.status(&e, &req, T0 + 2000), Status::No);
    assert!(e.commits.borrow().is_empty());
    assert_eq!(b.status(&e, &req, T0 + 3000), Status::Unknown);
}

#[test]
fn pe_5분_무응답이면_끝나고_그_뒤엔_못_누른다() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    let req = a.start("nB", T0).unwrap();
    b.request(&e, &req, "nA", T0).unwrap();
    let card = e.cards.borrow()[0].0.clone();
    assert!(b.decide(&card, true, T0 + TTL_MS + 1).is_err(), "시간이 지난 카드는 허용이 안 먹는다");
    assert_eq!(b.status(&e, &req, T0 + TTL_MS + 2), Status::Expired);
    assert!(e.commits.borrow().is_empty());
    assert_eq!(e.closed.borrow()[0].0, card);
    assert!(!e.closed.borrow()[0].1);
}

#[test]
fn pe_허용했는데_1분_안에_안_받아_가면_사라진다() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    let req = a.start("nB", T0).unwrap();
    b.request(&e, &req, "nA", T0).unwrap();
    let card = e.cards.borrow()[0].0.clone();
    b.decide(&card, true, T0 + 1000).unwrap();
    assert_eq!(b.status(&e, &req, T0 + 1000 + PICKUP_MS + 1), Status::Expired);
    assert!(e.commits.borrow().is_empty(), "안 받아 간 열쇠는 만들지 않는다");
}

#[test]
fn pe_받아_갈_때_못_만들면_실패로_카드도_닫는다() {
    let (a, b) = (Asks::default(), Asks::default());
    let mut e = env(&a);
    e.commit_fails = true;
    let req = a.start("nB", T0).unwrap();
    b.request(&e, &req, "nA", T0).unwrap();
    let card = e.cards.borrow()[0].0.clone();
    b.decide(&card, true, T0 + 1000).unwrap();
    assert!(matches!(b.status(&e, &req, T0 + 2000), Status::Failed(_)));
    assert_eq!(e.closed.borrow()[0].1, false);
}

#[test]
fn pe_요청한_기기가_되물음에_모른다고_하면_카드가_안_뜬다() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    // 남이 A 인 척 — A 는 그런 요청을 한 적이 없다
    let fake = "0123456789abcdef0123456789abcdef";
    assert_eq!(b.request(&e, fake, "nA", T0), Err(AskErr::Unconfirmed));
    // A 가 요청을 거둔 뒤에 온 것도
    let req = a.start("nB", T0).unwrap();
    a.end(&req);
    assert_eq!(b.request(&e, &req, "nA", T0), Err(AskErr::Unconfirmed));
    assert!(e.cards.borrow().is_empty());
}

#[test]
fn pe_같은_계정_기기가_아니면_되묻기도_안_하고_거절() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    let req = a.start("nB", T0).unwrap();
    assert_eq!(b.request(&e, &req, "nSHARED", T0), Err(AskErr::NotMine));
    assert_eq!(e.confirms.get(), 0);
    assert!(e.cards.borrow().is_empty());
}

#[test]
fn pe_요청은_10분에_5번_기다리는_카드는_3장까지() {
    let (a, b) = (Asks::default(), Asks::default());
    let e = env(&a);
    let ok = |node: &str, t: u64| {
        let r = a.start(&format!("to-{node}"), t).unwrap();
        b.request(&e, &r, node, t)
    };
    assert!(ok("nA", T0).is_ok());
    assert!(ok("nC", T0).is_ok());
    assert!(ok("nD", T0).is_ok());
    assert_eq!(ok("nE", T0), Err(AskErr::TooMany), "기다리는 카드 3장");
    assert!(ok("nA", T0 + 1).is_ok(), "같은 기기 새 요청은 옛 카드를 바꿔 끼운다");
    assert_eq!(e.closed.borrow()[0].0, "card1");
    assert_eq!(ok("nA", T0 + 2), Err(AskErr::TooMany), "10분에 5번");
    assert!(ok("nA", T0 + WINDOW_MS + 1).is_ok(), "창이 지나면 다시");
}

#[test]
fn pe_모양이_틀리거나_못_받는_기기면_거절() {
    let (a, b) = (Asks::default(), Asks::default());
    let mut e = env(&a);
    let req = a.start("nB", T0).unwrap();
    assert_eq!(b.request(&e, "XYZ", "nA", T0), Err(AskErr::Bad));
    assert_eq!(b.request(&e, &req.to_uppercase(), "nA", T0), Err(AskErr::Bad));
    assert_eq!(b.request(&e, &req, "n A\n", T0), Err(AskErr::Bad));
    assert_eq!(b.status(&e, "../etc", T0), Status::Unknown);
    e.supported = false;
    assert_eq!(b.request(&e, &req, "nA", T0), Err(AskErr::Unsupported));
}

#[test]
fn pe_요청하는_쪽은_자기가_낸_요청만_맞다고_하고_같은_기기는_하나만() {
    let a = Asks::default();
    let r1 = a.start("nB", T0).unwrap();
    assert_eq!(r1.len(), 32);
    assert!(a.asking(&hex_sha(&r1), T0));
    let r2 = a.start("nB", T0 + 1).unwrap();
    assert!(!a.asking(&hex_sha(&r1), T0 + 1), "같은 기기에 새로 요청하면 옛 것은 죽는다");
    assert!(a.asking(&hex_sha(&r2), T0 + 1));
    assert!(!a.asking(&hex_sha(&r2), T0 + 1 + TTL_MS + PICKUP_MS + 1), "시간이 지나면 모른다");
    assert!(a.waiting(&r2, T0 + 2));
    a.end(&r2);
    assert!(!a.waiting(&r2, T0 + 3), "취소하면 기다림도 끝");
}
