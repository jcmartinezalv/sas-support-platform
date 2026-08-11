from pathlib import Path
import os
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak, Preformatted, Table, TableStyle, KeepTogether
from reportlab.pdfbase.pdfmetrics import stringWidth

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "manual-usuario-sas.md"
OUTPUT = Path(os.environ.get("SAS_MANUAL_OUTPUT", ROOT / "output" / "pdf" / "manual-usuario-sas.pdf"))

PAGE_WIDTH, PAGE_HEIGHT = LETTER
MARGIN_X = 0.72 * inch
MARGIN_TOP = 0.72 * inch
MARGIN_BOTTOM = 0.62 * inch

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=24,
    leading=30,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#17324d"),
    spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="CoverSubtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=12,
    leading=17,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#44566c"),
))
styles.add(ParagraphStyle(
    name="H1Manual",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=16,
    leading=20,
    textColor=colors.HexColor("#17324d"),
    spaceBefore=14,
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H2Manual",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=12.2,
    leading=15,
    textColor=colors.HexColor("#24516f"),
    spaceBefore=10,
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="BodyManual",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9.3,
    leading=13.2,
    textColor=colors.HexColor("#22313f"),
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="BulletManual",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9.1,
    leading=12.8,
    leftIndent=16,
    firstLineIndent=-8,
    textColor=colors.HexColor("#22313f"),
    spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="SmallManual",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8,
    leading=10,
    textColor=colors.HexColor("#5d6b7a"),
))
styles.add(ParagraphStyle(
    name="CodeManual",
    parent=styles["Code"],
    fontName="Courier",
    fontSize=7.8,
    leading=10.2,
    backColor=colors.HexColor("#f3f6f8"),
    borderColor=colors.HexColor("#d7e0e7"),
    borderWidth=0.5,
    borderPadding=6,
    leftIndent=0,
    spaceBefore=4,
    spaceAfter=7,
))


def esc(text: str) -> str:
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))


def inline_markup(text: str) -> str:
    text = esc(text)
    text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


class ManualDoc(BaseDocTemplate):
    def __init__(self, filename):
        frame = Frame(MARGIN_X, MARGIN_BOTTOM, PAGE_WIDTH - 2 * MARGIN_X, PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM, id="normal")
        super().__init__(filename, pagesize=LETTER, rightMargin=MARGIN_X, leftMargin=MARGIN_X, topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOTTOM)
        self.addPageTemplates([PageTemplate(id="manual", frames=[frame], onPage=draw_page)])


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#d7e0e7"))
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN_X, PAGE_HEIGHT - 0.48 * inch, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 0.48 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#667789"))
    canvas.drawString(MARGIN_X, PAGE_HEIGHT - 0.37 * inch, "SAS Support Platform - Manual de Usuario")
    page_text = f"Pagina {doc.page}"
    canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 0.34 * inch, page_text)
    canvas.restoreState()


def cover(metadata):
    return [
        Spacer(1, 1.35 * inch),
        Paragraph("SAS Support Platform", styles["CoverTitle"]),
        Paragraph("Manual de Usuario", styles["CoverSubtitle"]),
        Spacer(1, 0.24 * inch),
        Table([
            ["Version", metadata.get("Version", "0.1 inicial")],
            ["Fecha", metadata.get("Fecha", "2026-06-30")],
            ["Estado", metadata.get("Estado del producto", "pruebas funcionales basicas")],
        ], colWidths=[1.7 * inch, 3.8 * inch], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f3f6f8")),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#17324d")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9.5),
            ("LEADING", (0, 0), (-1, -1), 13),
            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#d7e0e7")),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d7e0e7")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ])),
        Spacer(1, 0.45 * inch),
        Paragraph("Guia inicial para operar tickets, agente Fisher, consentimiento remoto, vista en vivo, diagnostico y control interactivo simulado.", styles["CoverSubtitle"]),
        PageBreak(),
    ]


def parse_markdown(md: str):
    lines = md.splitlines()
    metadata = {}
    story = []
    in_code = False
    code_lines = []
    list_buffer = []

    def flush_list():
        nonlocal list_buffer
        if list_buffer:
            story.extend(list_buffer)
            list_buffer = []

    def flush_code():
        nonlocal code_lines
        if code_lines:
            story.append(Preformatted("\n".join(code_lines), styles["CodeManual"]));
            code_lines = []

    title_seen = False
    for raw in lines:
        line = raw.rstrip()
        if line.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_list()
                in_code = True
                code_lines = []
            continue
        if in_code:
            code_lines.append(line)
            continue

        if not line:
            flush_list()
            story.append(Spacer(1, 3))
            continue

        if line.startswith("# "):
            title = line[2:].strip()
            if not title_seen:
                title_seen = True
                continue
            flush_list()
            story.append(Paragraph(inline_markup(title), styles["H1Manual"]))
            continue

        meta_match = re.match(r"^(Version|Fecha|Estado del producto):\s*(.+)$", line)
        if meta_match:
            metadata[meta_match.group(1)] = meta_match.group(2)
            continue

        if line.startswith("## "):
            flush_list()
            story.append(Paragraph(inline_markup(line[3:].strip()), styles["H1Manual"]))
            continue

        if line.startswith("### "):
            flush_list()
            story.append(Paragraph(inline_markup(line[4:].strip()), styles["H2Manual"]))
            continue

        if line.startswith("- "):
            list_buffer.append(Paragraph("- " + inline_markup(line[2:].strip()), styles["BulletManual"]))
            continue

        numbered = re.match(r"^(\d+)\.\s+(.+)$", line)
        if numbered:
            list_buffer.append(Paragraph(f"{numbered.group(1)}. " + inline_markup(numbered.group(2)), styles["BulletManual"]))
            continue

        flush_list()
        if line.startswith("http://") or line.startswith("https://") or line.startswith("C:\\") or line.startswith(".\\"):
            story.append(Preformatted(line, styles["CodeManual"]))
        else:
            story.append(Paragraph(inline_markup(line), styles["BodyManual"]))

    flush_list()
    flush_code()
    return metadata, story


def add_toc(story):
    sections = []
    for item in story:
        if isinstance(item, Paragraph) and item.style.name == "H1Manual":
            sections.append(item.getPlainText())
    toc_rows = [[Paragraph("Seccion", styles["SmallManual"]), Paragraph("Descripcion", styles["SmallManual"])]]
    for sec in sections[:20]:
        toc_rows.append([Paragraph(sec, styles["BodyManual"]), Paragraph("Ver detalle en el cuerpo del manual", styles["SmallManual"])])
    table = Table(toc_rows, colWidths=[2.7 * inch, 3.6 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17324d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d7e0e7")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#fbfcfd")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return [Paragraph("Indice Operativo", styles["H1Manual"]), table, PageBreak()]


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    metadata, body = parse_markdown(SOURCE.read_text(encoding="utf-8"))
    doc = ManualDoc(str(OUTPUT))
    story = []
    story.extend(cover(metadata))
    story.extend(add_toc(body))
    story.extend(body)
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()


