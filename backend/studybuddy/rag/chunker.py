"""Markdown-aware chunker.

Strategy:
  1. Walk the markdown line by line, tracking the active heading stack
     (h1/h2/h3). Top-level sections end at any same-or-higher heading.
  2. For each section, accumulate paragraphs (separated by blank lines)
     until the accumulated token count approaches target_tokens. Emit
     a chunk, carry an overlap_tokens tail into the next chunk.
  3. Never split inside a markdown table (lines starting with `|`).
  4. heading_path for a chunk = the heading stack active at the chunk's
     first line, joined with " > ".
  5. page_hint for a chunk = the page active at the chunk's start offset,
     if the ParsedDoc carried page data.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Iterator
import tiktoken

from studybuddy.rag.parser import ParsedDoc


_ENC = tiktoken.get_encoding("cl100k_base")


@dataclass
class Chunk:
    chunk_index: int
    text: str
    token_count: int
    heading_path: str | None
    page_hint: int | None


_H1 = re.compile(r"^#\s+(.+)$")
_H2 = re.compile(r"^##\s+(.+)$")
_H3 = re.compile(r"^###\s+(.+)$")


def _count_tokens(s: str) -> int:
    return len(_ENC.encode(s))


def _heading_path(stack: list[str]) -> str | None:
    return " > ".join(stack) if stack else None


def _page_for_offset(pages: list[tuple[int, int]], offset: int) -> int | None:
    if not pages:
        return None
    current = None
    for page_no, page_offset in pages:
        if page_offset <= offset:
            current = page_no
        else:
            break
    return current


def chunk_markdown(
    doc: ParsedDoc,
    *,
    target_tokens: int = 800,
    overlap_tokens: int = 100,
) -> Iterator[Chunk]:
    md = doc.markdown
    if not md.strip():
        return

    lines = md.split("\n")
    line_offsets: list[int] = []
    running = 0
    for ln in lines:
        line_offsets.append(running)
        running += len(ln) + 1  # +1 for the "\n" we split on

    stack: list[str] = []  # depth-1 list; last item is deepest heading title
    depths: list[int] = []  # parallel to stack; heading level 1/2/3

    buf_lines: list[str] = []
    buf_start_line: int | None = None
    chunk_index = 0
    in_table = False

    def _pop_to(level: int):
        while depths and depths[-1] >= level:
            depths.pop()
            stack.pop()

    def _flush(force_end: bool = False) -> Iterator[Chunk]:
        nonlocal chunk_index, buf_lines, buf_start_line
        if not buf_lines:
            return
        text = "\n".join(buf_lines).strip()
        if not text:
            buf_lines = []
            buf_start_line = None
            return
        start_offset = line_offsets[buf_start_line] if buf_start_line is not None else 0
        start_page = _page_for_offset(doc.pages, start_offset)
        heading = _heading_path(stack)

        # If the buffered text is substantially larger than target_tokens
        # (e.g., a single paragraph is bigger than the target), subdivide by
        # tokens at word boundaries so no single chunk is unmanageable.
        pieces = _subdivide_by_tokens(text, target_tokens, overlap_tokens)
        for piece in pieces:
            yield Chunk(
                chunk_index=chunk_index,
                text=piece,
                token_count=_count_tokens(piece),
                heading_path=heading,
                page_hint=start_page,
            )
            chunk_index += 1

        # Keep an overlap tail for the next chunk: the last ~overlap_tokens worth of text.
        if not force_end and overlap_tokens > 0:
            tail_text = _tail_by_tokens(pieces[-1], overlap_tokens)
            buf_lines = [tail_text] if tail_text else []
            # page hint stays — approximate
        else:
            buf_lines = []
            buf_start_line = None

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Heading boundaries flush the current buffer first (so the new chunk's
        # heading_path reflects the *new* stack).
        m1 = _H1.match(stripped)
        m2 = _H2.match(stripped)
        m3 = _H3.match(stripped)
        if m1 or m2 or m3:
            yield from _flush(force_end=True)
            if m1:
                _pop_to(1); stack.append(m1.group(1).strip()); depths.append(1)
            elif m2:
                _pop_to(2); stack.append(m2.group(1).strip()); depths.append(2)
            else:
                _pop_to(3); stack.append(m3.group(1).strip()); depths.append(3)
            i += 1
            continue

        # Detect table boundaries (pipe-rows). Don't split inside a table.
        if stripped.startswith("|"):
            in_table = True
        elif in_table and stripped == "":
            in_table = False

        if buf_start_line is None:
            buf_start_line = i
        buf_lines.append(line)

        # Size check after every paragraph break.
        if (stripped == "" or i == len(lines) - 1) and not in_table:
            current_text = "\n".join(buf_lines)
            if _count_tokens(current_text) >= target_tokens:
                yield from _flush(force_end=False)

        i += 1

    yield from _flush(force_end=True)


def _tail_by_tokens(text: str, n: int) -> str:
    """Return the trailing ~n tokens of text, snapped to a word boundary."""
    if n <= 0:
        return ""
    ids = _ENC.encode(text)
    if len(ids) <= n:
        return text
    tail_ids = ids[-n:]
    tail = _ENC.decode(tail_ids)
    # Snap to the next space so we don't split a token.
    sp = tail.find(" ")
    if 0 < sp < 20:
        tail = tail[sp + 1:]
    return tail


def _subdivide_by_tokens(text: str, target: int, overlap: int) -> list[str]:
    """Split a long text into overlapping chunks of ~target tokens.

    If the text is already <= target tokens, returns a single-element list.
    Otherwise splits on token boundaries and snaps to the nearest word
    boundary to avoid cutting tokens mid-word.
    """
    ids = _ENC.encode(text)
    if len(ids) <= target:
        return [text]

    step = max(1, target - max(0, overlap))
    pieces: list[str] = []
    pos = 0
    while pos < len(ids):
        end = min(pos + target, len(ids))
        piece_ids = ids[pos:end]
        piece = _ENC.decode(piece_ids)
        # Snap leading edge to a word boundary if we're not at the start.
        if pos > 0:
            sp = piece.find(" ")
            if 0 <= sp < 20:
                piece = piece[sp + 1:]
        # Snap trailing edge to a word boundary if not at the end.
        if end < len(ids):
            sp_r = piece.rfind(" ")
            if sp_r > len(piece) - 20 and sp_r > 0:
                piece = piece[:sp_r]
        piece = piece.strip()
        if piece:
            pieces.append(piece)
        if end == len(ids):
            break
        pos += step
    return pieces if pieces else [text]
