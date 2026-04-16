EXAM_KEYWORDS = ("exam", "tentamen", "resit", "hertentamen", "final", "midterm")


def classify_deadline(source_type: str, payload: dict) -> str:
    """Return one of: assignment, quiz, exam, event, other."""
    if source_type == "assignment":
        return "assignment"
    if source_type == "quiz":
        return "quiz"
    if source_type == "calendar_event":
        title = (payload.get("title") or "").lower()
        if any(k in title for k in EXAM_KEYWORDS):
            return "exam"
        return "event"
    return "other"
