from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://homehub:homehub@localhost:5432/homehub"
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    secret_key: str = "change-me-to-a-long-random-string"
    default_admin_password: str = "homehub"

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
