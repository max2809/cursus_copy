"""Prompt assembly for per-course RAG chat.

Context blocks are numbered [1]..[N] matching the reranked top-K chunks.
The assistant is instructed to emit citations in the same [N] form, and
we parse them post-hoc into structured citation rows.
"""
from __future__ import annotations
from datetime import date
from typing import Iterable
from studybuddy.db.models import Chunk


_SYSTEM_TEMPLATE = (
    "You are a study assistant for {course_name} at {canvas_base_url}.\n"
    "You have access to course materials (lecture slides, readings, assignment "
    "briefs, and anything the user has uploaded).\n\n"
    "{temporal_context}"
    "Rules:\n"
    "- Answer using ONLY the provided context blocks below. If the context "
    "does not contain the answer, say so plainly — do not invent facts or draw "
    "on outside knowledge.\n"
    "- Cite inline using [1], [2], ... matching the numbered context blocks. "
    "Place citations immediately after the claim they support.\n"
    "- Keep answers concise and structured (short paragraphs, bullet lists "
    "when useful).\n"
    "- Respond in the same language as the user's question when possible; "
    "course materials may be in English or Dutch.\n"
    "- When the user says \"last lecture\", \"this week\", \"yesterday\" etc., "
    "interpret them relative to today's date given above — pick the most recently "
    "scheduled lecture that's already passed."
)


def build_system_prompt(
    *,
    course_name: str,
    canvas_base_url: str,
    today: date | None = None,
    course_start_date: date | None = None,
) -> str:
    lines: list[str] = []
    if today is not None:
        lines.append(f"Today's date: {today.isoformat()} ({today.strftime('%A')}).")
        # We intentionally don't compute a "week number" from course_start_date —
        # Canvas returns the academic-year/term start, not the specific block's
        # start, so any week count is misleading. Claude should infer the current
        # week from dates in the indexed syllabus/module content instead.
    temporal = ("\n".join(lines) + "\n\n") if lines else ""
    return _SYSTEM_TEMPLATE.format(
        course_name=course_name,
        canvas_base_url=canvas_base_url,
        temporal_context=temporal,
    )


def build_context_block(chunks: Iterable[Chunk]) -> str:
    chunks = list(chunks)
    if not chunks:
        return ""
    parts: list[str] = []
    for i, c in enumerate(chunks, start=1):
        header_bits: list[str] = []
        if c.heading_path:
            header_bits.append(c.heading_path)
        if c.page_hint is not None:
            header_bits.append(f"p.{c.page_hint}")
        header = ", ".join(header_bits) if header_bits else "source"
        parts.append(f"[{i}] {header}:\n{c.content_text.strip()}")
    return "\n\n".join(parts)


_MAX_HISTORY_TURNS = 10


def build_messages(
    *,
    history: list[dict],
    user_query: str,
    context_block: str,
) -> list[dict]:
    trimmed = history[-_MAX_HISTORY_TURNS:] if len(history) > _MAX_HISTORY_TURNS else list(history)
    current = (f"{context_block}\n\n---\n\nQuestion: {user_query}"
               if context_block else f"Question: {user_query}")
    return [*trimmed, {"role": "user", "content": current}]
