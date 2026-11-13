import secrets
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    jwt_secret: str = ""
    jwt_exp_minutes: int = 60 * 12
    invite_exp_hours: int = 72
    reset_exp_hours: int = 2
    cors_origins: str = (
        "http://localhost:4178,http://127.0.0.1:4178,"
        "http://localhost:8080,http://127.0.0.1:8080"
    )
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True
    app_base_url: str = ""
    cookie_secure: bool = False
    upload_max_bytes: int = 5 * 1024 * 1024
    testing: bool = False
    static_dir: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required")
    settings.database_url = normalize_database_url(settings.database_url)
    if not settings.jwt_secret:
        # Ephemeral secret: sessions end when the process restarts.
        settings.jwt_secret = secrets.token_urlsafe(32)
    return settings
