import pytest
from studybuddy.chat.query_rewriter import rewrite_query


class _Resp:
    def __init__(self, text: str):
        class _Block:
            def __init__(self, t): self.text = t
        self.content = [_Block(text)]


class FakeClaude:
    def __init__(self, text: str = "", *, raise_exc: Exception | None = None, capture=None):
        self._text = text
        self._raise = raise_exc
        self._capture = capture  # optional list; we append the prompt that was sent

        class _Messages:
            async def create(inner_self, **kwargs):  # noqa: ARG002
                if self._capture is not None:
                    self._capture.append(kwargs)
                if self._raise is not None:
                    raise self._raise
                return _Resp(self._text)

        self.messages = _Messages()


@pytest.mark.asyncio
async def test_rewrite_returns_original_when_history_empty():
    claude = FakeClaude(text="should not be used")
    out = await rewrite_query(
        claude_client=claude,
        model="claude-haiku",
        history=[],
        user_text="What is Big-O?",
    )
    assert out == "What is Big-O?"


@pytest.mark.asyncio
async def test_rewrite_resolves_pronoun_with_history():
    capture: list = []
    claude = FakeClaude(
        text="Quiz me on Lecture 5: Supply Chain Optimization",
        capture=capture,
    )
    out = await rewrite_query(
        claude_client=claude,
        model="claude-haiku",
        history=[
            {"role": "user", "content": "Explain lecture 5 on supply chain optimization"},
            {"role": "assistant", "content": "Supply chain optimization aims to..."},
        ],
        user_text="quiz me on that",
    )
    assert out == "Quiz me on Lecture 5: Supply Chain Optimization"
    assert capture, "rewriter should have called Claude"
    # The prompt should include both the history and the latest message.
    prompt_text = capture[0]["messages"][0]["content"]
    assert "supply chain optimization" in prompt_text.lower()
    assert "quiz me on that" in prompt_text.lower()


@pytest.mark.asyncio
async def test_rewrite_falls_back_on_claude_error():
    claude = FakeClaude(raise_exc=RuntimeError("boom"))
    out = await rewrite_query(
        claude_client=claude,
        model="claude-haiku",
        history=[{"role": "user", "content": "prior"}],
        user_text="original question",
    )
    assert out == "original question"


@pytest.mark.asyncio
async def test_rewrite_falls_back_on_empty_output():
    claude = FakeClaude(text="   ")
    out = await rewrite_query(
        claude_client=claude,
        model="claude-haiku",
        history=[{"role": "user", "content": "prior"}],
        user_text="original question",
    )
    assert out == "original question"


@pytest.mark.asyncio
async def test_rewrite_strips_wrapping_quotes():
    claude = FakeClaude(text='"Lecture 5: Supply Chain"')
    out = await rewrite_query(
        claude_client=claude,
        model="claude-haiku",
        history=[{"role": "user", "content": "prior"}],
        user_text="quiz me on that",
    )
    assert out == "Lecture 5: Supply Chain"
