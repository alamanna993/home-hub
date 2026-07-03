from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://homehub:homehub@localhost:5432/homehub"
    secret_key: str = "change-me-to-a-long-random-string"
    default_admin_password: str = "homehub"
    internal_api_key: str = ""  # shared secret for bot containers; falls back to secret_key

    # LLM provider: ollama | lmstudio | openai | claude
    llm_provider: str = "ollama"

    # Ollama
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    # LM Studio (OpenAI-compatible)
    lmstudio_host: str = "http://host.docker.internal:1234"
    lmstudio_model: str = ""

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Anthropic / Claude
    anthropic_api_key: str = ""
    claude_model: str = "claude-haiku-4-5-20251001"

    class Config:
        env_file = ".env"


settings = Settings()

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
