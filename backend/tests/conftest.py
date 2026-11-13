import os

import pytest

test_url = os.environ.get("TEST_DATABASE_URL")
if not test_url:
    raise RuntimeError("Set TEST_DATABASE_URL to a dedicated Postgres database before running tests.")

os.environ["DATABASE_URL"] = test_url
os.environ["JWT_SECRET"] = "x" * 48
os.environ["TESTING"] = "true"
os.environ["COOKIE_SECURE"] = "false"

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

HDR = {"X-Harbor-Request": "1"}


@pytest.fixture(scope="session", autouse=True)
def schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def clean_rows():
    yield
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        yield test_client


def auth(client, email="ada@harbor.example", password="harbor123", name="Ada Loren"):
    response = client.post(
        "/api/auth/setup",
        json={"name": name, "email": email, "password": password},
        headers=HDR,
    )
    assert response.status_code == 200, response.text
    return response.json()
