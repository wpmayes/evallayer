"""
Database initialisation and session management.
Uses SQLite locally; swap DATABASE_URL in .env for PostgreSQL in production.
"""
from sqlmodel import SQLModel, create_engine, Session
from app.models.schema import Suite, TestCase, Run, Result
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./evallayer.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def init_db():
    """Create all tables on startup if they don't exist."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """FastAPI dependency — yields a DB session per request."""
    with Session(engine) as session:
        yield session
