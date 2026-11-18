"""run.py 판정만 — 시험 앱 없이(python3 -m unittest app/e2e/hidden-window/test_judge.py)"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run import judge  # noqa: E402

SCREENS = [{"X": 0, "Y": 0, "W": 1920, "H": 1080, "name": "주"}, {"X": -3390, "Y": 956, "W": 1920, "H": 1200, "name": "Chammo agents"}]
OFF = {"X": 20000, "Y": 20000, "Width": 1440, "Height": 900}
OK_DUMP = {"raf": 118, "hidden": False}


def s(front=1, policy=2, active=False, b=OFF):
    return {"front": front, "policy": policy, "active": active, "windows": [{"b": b}], "screens": SCREENS}


class T(unittest.TestCase):
    def test_화면_밖_앞으로_안_옴_그림_돌면_통과(self):
        self.assertEqual(judge([s()] * 3, OK_DUMP, 99), [])

    def test_맨_앞으로_나오면_실패(self):
        self.assertTrue(any("맨 앞" in x for x in judge([s(), s(front=99)], OK_DUMP, 99)))

    def test_dock_에_보이면_실패(self):
        self.assertTrue(any("Dock" in x for x in judge([s(policy=0)], OK_DUMP, 99)))

    def test_가짜_화면도_화면이다(self):
        bad = judge([s(b={"X": -3300, "Y": 1000, "Width": 800, "Height": 600})], OK_DUMP, 99)
        self.assertTrue(any("Chammo agents" in x for x in bad))

    def test_숨은_창은_화면_위_자리여도_괜찮다(self):
        hid = s(); hid["windows"].append({"b": {"X": 0, "Y": 580, "Width": 500, "Height": 500}, "on": False})
        self.assertEqual(judge([hid], OK_DUMP, 99), [])

    def test_그리기가_멈추면_실패(self):
        self.assertTrue(any("rAF" in x for x in judge([s()], {"raf": 2, "hidden": False}, 99)))
        self.assertTrue(any("hidden" in x for x in judge([s()], {"raf": 100, "hidden": True}, 99)))


    def test_시험판_알림은_0건(self):
        quiet = "1\tnotify\tchammo-hidden-test-notify — 시험 · 맥만\n2\tnotify-quiet\tchammo-hidden-test-notify\n"
        self.assertEqual(judge([s()] * 3, OK_DUMP, 99, quiet), [])
        loud = "1\tnotify\tchammo-hidden-test-notify — 시험 · 맥만\n"
        self.assertTrue(any("알림" in x for x in judge([s()] * 3, OK_DUMP, 99, loud)))
        self.assertTrue(any("알림" in x for x in judge([s()] * 3, OK_DUMP, 99, "")))


if __name__ == "__main__":
    unittest.main()
