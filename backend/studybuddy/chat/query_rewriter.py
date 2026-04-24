"""Rewrite a follow-up question into a standalone search query.

Why: retrieval embeds the user's latest turn alone, so pronouns like
"quiz me on that" embed to nothing useful and the vector search misses
the material the conversation was actually about. We run a cheap Haiku
call that looks at the last few turns and produces a self-contained
query used *only* for embedding/retrieval. The original user text still
goes to Claude unchanged.

The rewriter is best-effort: empty history, the rewriter call failing,
or an empty output all degrade gracefully back to the original query.
"""
from __future__ import annotations
import logging
from typing import Any

logger = logging.getLogger(__name__)


_SYSTEM = (
    "You rewrite the user's latest message into a standalone search query "
    "for a vector database of their course materials.\n"
    "Rules:\n"
    "- Resolve pronouns (that, it, this, the topic) using the conversation.\n"
    "- Keep lecture, course, and topic names that were mentioned earlier.\n"
    "- If the latest message is already specific and standalone, return it unchanged.\n"
    "- Output ONLY the rewritten query. No preamble, no quotes, no explanation."
)

_MAX_HISTORY_TURNS = 4
_MAX_TOKENS = 120


async def rewrite_query(
    *,
    claude_client: Any,
    model: str,
    history: list[dict],
    user_text: str,
) -> str:
    """Return a standalone query for retrieval. Falls back to user_text on any failure."""
    if not history:
        return user_text

    recent = history[-_MAX_HISTORY_TURNS:]
    convo = "\n".join(
        f"{turn['role'].upper()}: {turn['content']}" for turn in recent
    )
    prompt = (
        f"Conversation so far:\n{convo}\n\n"
        f"Latest message: {user_text}\n\n"
        "Standalone search query:"
    )
    try:
        resp = await claude_client.messages.create(
            model=model,
            max_tokens=_MAX_TOKENS,
            system=_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        rewritten = _extract_text(resp).strip().strip('"').strip()
        if not rewritten:
            return user_text
        return rewritten
    except Exception as e:  # noqa: BLE001 — degrade, never block the chat
        logger.warning("query rewrite failed: %s: %s", type(e).__name__, e)
        return user_text


def _extract_text(resp: Any) -> str:
    """Pull the text out of an Anthropic messages.create response.

    Real SDK: resp.content is a list of content blocks with .text on text blocks.
    Fake client used in tests: resp.content may already be a string.
    """
    content = getattr(resp, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            text = getattr(block, "text", None)
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts)
    return ""
