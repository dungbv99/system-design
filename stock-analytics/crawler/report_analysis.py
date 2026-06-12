"""
Quarterly financial-report analysis.

Pipeline (triggered on demand from the UI):
  1. Crawl finance.vietstock.vn for the symbol's latest quarterly financial
     report (BCTC) — session cookie + CSRF token, then the JSON document API.
  2. Download the report PDF from static*.vietstock.vn.
  3. Send the PDF + Wyckoff/price context to Gemini for a written analysis.

The analysis result is cached in Postgres per (symbol, year, quarter) — the
report for a quarter never changes, so each report is crawled and billed once.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import zipfile
from typing import Optional
from urllib.parse import quote

from curl_cffi import requests as cffi_requests

log = logging.getLogger(__name__)

VIETSTOCK_BASE = "https://finance.vietstock.vn"
GEMINI_BASE    = "https://generativelanguage.googleapis.com/v1beta/models"

_UA_HEADERS = {
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
}


class ReportError(Exception):
    """Raised with a user-facing message when any pipeline step fails."""


# ── Step 1+2: Vietstock crawl ─────────────────────────────────────────────────

def fetch_latest_report(symbol: str) -> dict:
    """
    Return the newest quarterly BCTC for `symbol`:
      {title, url, year, quarter, pdf_bytes}

    Prefers the consolidated ("Hợp nhất") report; falls back to the first
    quarterly report when the company does not publish consolidated statements.
    """
    sym = symbol.strip().upper()
    session = cffi_requests.Session(impersonate="chrome136")

    # 1. Documents page → session cookie + CSRF token (unquoted HTML attributes)
    page_url = f"{VIETSTOCK_BASE}/{sym}/tai-lieu.htm"
    r = session.get(page_url, headers=_UA_HEADERS, timeout=30)
    if r.status_code != 200:
        raise ReportError(f"Vietstock trả về HTTP {r.status_code} cho trang tài liệu {sym}")
    m = re.search(
        r'name=["\']?__RequestVerificationToken["\']?[^>]*?value=["\']?([^>"\'\s]+)',
        r.text,
    )
    if not m:
        raise ReportError("Không tìm thấy CSRF token trên trang Vietstock — cấu trúc trang có thể đã đổi")
    token = m.group(1)

    # 2. Document list API (type=1 = financial statements, newest first)
    r = session.post(
        f"{VIETSTOCK_BASE}/data/getdocument",
        data={"code": sym, "type": 1, "page": 1, "pageSize": 20,
              "__RequestVerificationToken": token},
        headers={**_UA_HEADERS,
                 "X-Requested-With": "XMLHttpRequest",
                 "Referer": page_url},
        timeout=30,
    )
    if r.status_code != 200:
        raise ReportError(f"API tài liệu Vietstock trả về HTTP {r.status_code}")
    try:
        docs = r.json()
    except Exception:
        raise ReportError("API tài liệu Vietstock không trả về JSON (có thể bị chặn phiên)")
    if not docs:
        raise ReportError(f"Vietstock không có tài liệu BCTC nào cho {sym}")

    chosen = _pick_quarterly(docs)
    if chosen is None:
        raise ReportError(f"Không tìm thấy BCTC quý nào cho {sym} trong 20 tài liệu mới nhất")

    title = (chosen.get("FullName") or chosen.get("Title") or "").strip()
    year, quarter = _parse_period(title)
    pdf_url = (chosen.get("Url") or "").strip()
    if not pdf_url:
        raise ReportError("Tài liệu không có link PDF")

    # 3. Download the report (static server needs no auth; URL may contain spaces)
    r = session.get(quote(pdf_url, safe=":/%"), headers=_UA_HEADERS, timeout=120)
    if r.status_code != 200:
        raise ReportError(f"Tải tài liệu thất bại (HTTP {r.status_code}) — {pdf_url}")
    pdf_bytes = _extract_pdf(r.content, pdf_url)

    return {"title": title, "url": pdf_url, "year": year, "quarter": quarter,
            "pdf_bytes": pdf_bytes}


def _extract_pdf(content: bytes, url: str) -> bytes:
    """
    Return PDF bytes from a raw download.  Some companies (e.g. BVB) publish
    their BCTC as a .zip containing the PDF — unpack and take the largest PDF.
    """
    if content.startswith(b"%PDF"):
        return content
    if content.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                pdf_names = [n for n in zf.namelist() if n.lower().endswith(".pdf")]
                if not pdf_names:
                    raise ReportError(f"File ZIP không chứa PDF nào — {url}")
                name = max(pdf_names, key=lambda n: zf.getinfo(n).file_size)
                data = zf.read(name)
        except zipfile.BadZipFile:
            raise ReportError(f"File ZIP bị hỏng — {url}")
        if not data.startswith(b"%PDF"):
            raise ReportError(f"File trong ZIP không phải PDF hợp lệ — {url}")
        return data
    raise ReportError(f"Tài liệu không phải PDF hay ZIP — {url}")


def _pick_quarterly(docs: list[dict]) -> Optional[dict]:
    """Newest-first list → first consolidated quarterly report, else first quarterly."""
    def title_of(d: dict) -> str:
        return ((d.get("FullName") or d.get("Title") or "")).lower()

    quarterly = [d for d in docs if "quý" in title_of(d)]
    for d in quarterly:
        if "hợp nhất" in title_of(d):
            return d
    return quarterly[0] if quarterly else None


def _parse_period(title: str) -> tuple[int, int]:
    m = re.search(r"quý\s*(\d)\s*năm\s*(\d{4})", title, re.IGNORECASE)
    if m:
        return int(m.group(2)), int(m.group(1))
    m = re.search(r"năm\s*(\d{4})", title, re.IGNORECASE)
    return (int(m.group(1)) if m else 0), 0


# ── Step 3: Gemini analysis ───────────────────────────────────────────────────

def analyze_with_gemini(pdf_bytes: bytes, prompt: str) -> tuple[str, str]:
    """Send the PDF + prompt to Gemini. Returns (analysis_markdown, model_name)."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ReportError("Chưa cấu hình GEMINI_API_KEY — đặt biến môi trường cho service crawler")
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

    body = {
        "contents": [{
            "parts": [
                {"inline_data": {
                    "mime_type": "application/pdf",
                    "data": base64.b64encode(pdf_bytes).decode(),
                }},
                {"text": prompt},
            ],
        }],
        "generationConfig": {"temperature": 0.3},
    }
    r = cffi_requests.post(
        f"{GEMINI_BASE}/{model}:generateContent",
        json=body,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        timeout=300,
    )
    if r.status_code != 200:
        detail = ""
        try:
            detail = r.json().get("error", {}).get("message", "")[:300]
        except Exception:
            pass
        raise ReportError(f"Gemini API lỗi HTTP {r.status_code}: {detail}")

    data = r.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "\n".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        raise ReportError(f"Gemini trả về cấu trúc không mong đợi: {json.dumps(data)[:300]}")
    if not text:
        raise ReportError("Gemini trả về nội dung rỗng (có thể bị chặn bởi safety filter)")
    return text, model


def analyze_with_claude(pdf_bytes: bytes, prompt: str) -> tuple[str, str]:
    """Send the PDF + prompt to Claude. Returns (analysis_markdown, model_name)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise ReportError("Chưa cấu hình ANTHROPIC_API_KEY — đặt biến môi trường cho service crawler")
    model = os.environ.get("CLAUDE_MODEL", "claude-opus-4-8").strip()

    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    try:
        with client.messages.stream(
            model=model,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": base64.b64encode(pdf_bytes).decode(),
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.APIStatusError as e:
        raise ReportError(f"Claude API lỗi HTTP {e.status_code}: {str(e)[:300]}")
    except anthropic.APIError as e:
        raise ReportError(f"Claude API lỗi: {str(e)[:300]}")

    if message.stop_reason == "refusal":
        raise ReportError("Claude từ chối phân tích tài liệu này (safety refusal)")

    text = "\n".join(
        block.text for block in message.content if block.type == "text"
    ).strip()
    if not text:
        raise ReportError("Claude trả về nội dung rỗng")
    return text, model


def build_prompt(symbol: str, report_title: str,
                 wyckoff: Optional[dict], quotes: list[dict]) -> str:
    """Vietnamese analysis prompt combining the PDF with chart context from our DB."""
    recent = quotes[-15:] if quotes else []
    quotes_txt = "\n".join(
        f"  {q.get('date')}: đóng cửa {q.get('close')}, KL {q.get('volume')}"
        for q in recent
    ) or "  (không có dữ liệu giá)"
    wyckoff_txt = json.dumps(
        {k: v for k, v in (wyckoff or {}).items() if k != "vsa_labels"},
        ensure_ascii=False, default=str,
    )

    return f"""Bạn là chuyên gia phân tích tài chính chứng khoán Việt Nam. Hãy phân tích báo cáo tài chính đính kèm ({report_title}) của mã {symbol} và kết hợp với bối cảnh kỹ thuật bên dưới để đánh giá cổ phiếu.

BỐI CẢNH KỸ THUẬT (phân tích Wyckoff từ hệ thống, giá đơn vị VND):
{wyckoff_txt}

GIÁ 15 PHIÊN GẦN NHẤT:
{quotes_txt}

YÊU CẦU PHÂN TÍCH:
1. Kết quả kinh doanh quý: doanh thu, lợi nhuận gộp, biên gộp, LNST — so sánh cùng kỳ năm trước (số liệu có sẵn trong báo cáo).
2. CHẤT LƯỢNG LỢI NHUẬN — quan trọng nhất: soi thuyết minh để phát hiện các khoản bất thường/một lần (lãi chuyển nhượng đầu tư, đánh giá lại tài sản, hoàn nhập dự phòng...). Nếu có, hãy bóc tách và ước tính lợi nhuận cốt lõi.
3. Dòng tiền: lưu chuyển tiền từ HĐKD, biến động tồn kho và phải thu.
4. Bảng cân đối: nợ vay, tiền mặt, vốn chủ — các thay đổi đáng chú ý.
5. Định giá nhanh nếu đủ dữ liệu (P/E, P/B từ vốn chủ và số cổ phiếu trong báo cáo, giá hiện tại lấy từ bối cảnh kỹ thuật).
6. Kết hợp với bối cảnh Wyckoff: nền tảng cơ bản và vị thế kỹ thuật đang đồng thuận hay mâu thuẫn? Đưa ra nhận định tổng hợp và các mức giá/sự kiện cần theo dõi.

ĐỊNH DẠNG BẮT BUỘC:
- Viết tiếng Việt, dùng markdown ĐƠN GIẢN: tiêu đề bằng "## ", gạch đầu dòng bằng "- ", in đậm bằng **...**.
- TUYỆT ĐỐI KHÔNG dùng bảng markdown (không dùng ký tự |).
- Số liệu lớn viết theo tỷ đồng (ví dụ: 52.901 tỷ).
- Mở đầu bằng 2-3 câu tóm tắt nhận định quan trọng nhất.
- Kết thúc bằng một dòng: "_Phân tích tham khảo, không phải khuyến nghị đầu tư._"
"""
