import json
from base64 import b64encode

import itsdangerous
import pytest
from httpx import AsyncClient, ASGITransport

from web.app import create_app

_SECRET = "dev-secret-change-in-production"


@pytest.fixture
def app():
    return create_app()


def _make_session_cookie(data: dict) -> str:
    """Create a valid signed session cookie the same way Starlette does."""
    payload = b64encode(json.dumps(data).encode()).decode()
    signer = itsdangerous.TimestampSigner(_SECRET)
    return signer.sign(payload).decode()


@pytest.mark.asyncio
async def test_me_unauthenticated(app):
    """No session → 401."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_authenticated(app):
    """Valid session cookie → returns user data."""
    session_data = {
        "user": {
            "id": "123456789",
            "username": "testuser",
            "global_name": "Test User",
            "avatar": None,
        }
    }
    cookie = _make_session_cookie(session_data)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("session", cookie)
        response = await client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "123456789"
    assert data["username"] == "testuser"


@pytest.mark.asyncio
async def test_logout(app):
    """Logout always returns ok."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.asyncio
async def test_login_redirects_to_discord(app):
    """Login endpoint should redirect to discord.com."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False
    ) as client:
        response = await client.get("/api/auth/login")
    assert response.status_code in (302, 307)
    assert "discord.com" in response.headers["location"]
