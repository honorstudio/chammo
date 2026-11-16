"""HQ scripts/craft_diff — 사람이 참모 앱에서 고친 문서 전후를 쪽·글·도형 단위 한 줄로(13개 앱 공통, 2026-11-16 참모 슬라이드 돌려받음):
python3 -m unittest discover -s app/hq-tests -p 'test_hq_craft_diff.py' — 진짜 앱 없이 손으로 짠 파일로"""
import json, os, pathlib, sys, tempfile, unittest, zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'))
import craft_diff as cd  # noqa: E402

P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' \
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def slide(texts, pics=0, x=0):
    sp = ''.join(f'<p:sp><p:spPr><a:off x="{x}" y="0"/></p:spPr><p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp>' for t in texts)
    return f'<p:sld {P}><p:cSld><p:spTree>{sp}{"<p:pic/>" * pics}</p:spTree></p:cSld></p:sld>'


def pptx(path, slides):
    ids = ''.join(f'<p:sldId id="{256 + i}" r:id="rId{i + 1}"/>' for i in range(len(slides)))
    rels = ''.join(f'<Relationship Id="rId{i + 1}" Target="slides/slide{i + 1}.xml"/>' for i in range(len(slides)))
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('ppt/presentation.xml', f'<p:presentation {P}><p:sldIdLst>{ids}</p:sldIdLst></p:presentation>')
        z.writestr('ppt/_rels/presentation.xml.rels', f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')
        for i, s in enumerate(slides):
            z.writestr(f'ppt/slides/slide{i + 1}.xml', s)


W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def docx(path, paras):
    body = ''.join(f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>' for t in paras)
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('word/document.xml', f'<w:document {W}><w:body>{body}</w:body></w:document>')


X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def xlsx(path, cells):
    row = ''.join(f'<c r="{k}"><v>{v}</v></c>' if not str(v).startswith('=') else f'<c r="{k}"><f>{v[1:]}</f><v>0</v></c>' for k, v in cells.items())
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('xl/workbook.xml', f'<workbook {X}><sheets><sheet name="매출" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet {X}><sheetData><row r="1">{row}</row></sheetData></worksheet>')


class Diff(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.a, self.b = os.path.join(self.t.name, 'a'), os.path.join(self.t.name, 'b')

    def tearDown(self):
        self.t.cleanup()

    def pair(self, make, before, after, ext):
        self.a, self.b = self.a + ext, self.b + ext
        make(self.a, before)
        make(self.b, after)
        return cd.diff(self.a, self.b)

    def test_같은_파일이면_바뀐_것_없음(self):
        pptx(self.a, [slide(['안녕'])])
        pptx(self.b, [slide(['안녕'])])
        self.assertEqual(cd.diff(self.a, self.b), '바뀐 것 없음')

    def test_슬라이드_글을_고치면_그_쪽_글_전후(self):
        line = self.pair(pptx, [slide(['제목', '본문'])], [slide(['제목', '본문 고침'])], '.pptx')
        self.assertIn("1쪽 '본문'→'본문 고침'", line)

    def test_슬라이드를_더하거나_지우면_쪽_수와_그_쪽(self):
        line = self.pair(pptx, [slide(['하나']), slide(['둘'])], [slide(['하나']), slide(['새 쪽']), slide(['둘'])], '.pptx')
        self.assertIn('쪽 2→3', line)
        self.assertIn("2쪽 추가('새 쪽')", line)
        line = cd.diff(self.b, self.a)
        self.assertIn("2쪽 지움('새 쪽')", line)

    def test_글은_그대로고_도형만_바뀌면_도형_수나_모양(self):
        line = self.pair(pptx, [slide(['제목'])], [slide(['제목'], pics=1)], '.pptx')
        self.assertIn('1쪽 그림 0→1', line)
        pptx(self.b, [slide(['제목'], x=500)])
        self.assertIn('1쪽 모양 바뀜', cd.diff(self.a, self.b))

    def test_문서는_문단_전후(self):
        line = self.pair(docx, ['머리', '둘째 문단'], ['머리', '둘째 문단 고침', '셋째'], '.docx')
        self.assertIn('문단 2→3', line)
        self.assertIn("'둘째 문단'→'둘째 문단 고침'", line)

    def test_표는_칸_전후(self):
        line = self.pair(xlsx, {'A1': '1', 'B1': '2'}, {'A1': '1', 'B1': '5', 'C1': '=SUM(A1:B1)'}, '.xlsx')
        self.assertIn("'매출'!B1 '2'→'5'", line)
        self.assertIn("'매출'!C1 ''→'=SUM(A1:B1)'", line)

    def test_앱_자기_형식_JSON_은_글과_개수_전후(self):
        doc = lambda texts: {'format': 'vectorcraft', 'modified': 'x', 'layers': [{'id': i, 'name': t, 'x': 1} for i, t in enumerate(texts)]}
        mk = lambda p, v: pathlib.Path(p).write_text(json.dumps(v, ensure_ascii=False))
        line = self.pair(mk, doc(['로고', '글']), {**doc(['로고', '글자', '새 도형']), 'modified': 'y'}, '.vectorcraft')
        self.assertIn('layers 2→3개', line)
        self.assertIn("'글'→'글자'", line)
        self.assertNotIn('modified', line)

    def test_숫자만_바뀌면_몇_곳인지(self):
        mk = lambda p, v: pathlib.Path(p).write_text(json.dumps(v))
        line = self.pair(mk, {'shapes': [{'x': 1, 'y': 2}]}, {'shapes': [{'x': 9, 'y': 8}]}, '.fcproj')
        self.assertIn('숫자 2곳', line)

    def test_모르는_형식은_크기로(self):
        pathlib.Path(self.a).write_bytes(b'\x00' * 10)
        pathlib.Path(self.b).write_bytes(b'\x00' * 2048)
        self.assertIn('파일 바뀜', cd.diff(self.a, self.b))

    def test_PDF_는_쪽_수(self):
        pathlib.Path(self.a).write_bytes(b'%PDF-1.7 /Type /Pages /Type /Page')
        pathlib.Path(self.b).write_bytes(b'%PDF-1.7 /Type /Pages /Type /Page /Type /Page')
        self.assertIn('쪽 1→2', cd.diff(self.a, self.b))

    def test_한_줄은_너무_길지_않게(self):
        line = self.pair(docx, [f'문단{i}' for i in range(40)], [f'고친{i}' for i in range(40)], '.docx')
        self.assertLessEqual(len(line), 600)
        self.assertIn('더', line)

    def test_못_읽는_파일이면_None(self):
        self.assertIsNone(cd.diff(self.a, os.path.join(self.t.name, '없음')))
        pathlib.Path(self.a).write_bytes(b'PK broken')
        pathlib.Path(self.b).write_bytes(b'PK broken 2')
        self.assertIn('파일 바뀜', cd.diff(self.a, self.b))  # 깨진 zip 도 죽지 않고 크기로


if __name__ == '__main__':
    unittest.main()
