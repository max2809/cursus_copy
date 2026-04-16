from studybuddy.canvas.classify import classify_deadline


def test_assignment_source_returns_assignment():
    assert classify_deadline("assignment", {"name": "Problem set 1"}) == "assignment"


def test_quiz_source_returns_quiz():
    assert classify_deadline("quiz", {"title": "Midterm quiz"}) == "quiz"


def test_calendar_event_with_exam_in_title_returns_exam():
    assert classify_deadline("calendar_event", {"title": "Final exam", "description": ""}) == "exam"
    assert classify_deadline("calendar_event", {"title": "Midterm Exam", "description": ""}) == "exam"


def test_calendar_event_with_tentamen_returns_exam():
    assert classify_deadline("calendar_event", {"title": "Tentamen Algoritmes", "description": ""}) == "exam"


def test_calendar_event_without_exam_words_returns_event():
    assert classify_deadline("calendar_event", {"title": "Guest lecture", "description": ""}) == "event"


def test_unknown_source_returns_other():
    assert classify_deadline("weird", {}) == "other"
