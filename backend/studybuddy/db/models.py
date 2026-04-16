import uuid
from datetime import datetime
from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary,
    String, Text, UniqueConstraint, Index, Float,
)
from sqlalchemy import Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from studybuddy.db.base import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    pat_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    pat_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    canvas_base_url: Mapped[str] = mapped_column(String, nullable=False, default="canvas.eur.nl")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MagicLinkToken(Base):
    __tablename__ = "magic_link_tokens"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    __table_args__ = (Index("ix_magic_link_tokens_token_hash", "token_hash"),)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    __table_args__ = (Index("ix_sessions_token_hash", "token_hash"),)


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    canvas_course_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str | None] = mapped_column(String, nullable=True)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "canvas_course_id", name="uq_courses_user_canvas"),)


class Deadline(Base):
    __tablename__ = "deadlines"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=True)
    canvas_source_type: Mapped[str] = mapped_column(String, nullable=False)
    canvas_source_id: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    points_possible: Mapped[float | None] = mapped_column(Float, nullable=True)
    submitted: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "canvas_source_type", "canvas_source_id", name="uq_deadlines_user_source"),
        Index("ix_deadlines_user_due", "user_id", "due_at"),
    )


class File(Base):
    __tablename__ = "files"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    canvas_file_id: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    folder_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "canvas_file_id", name="uq_files_user_canvas"),)
