from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from web.app import create_app

_SECRET = "test-secret-fixed"


@pytest.fixture
def app():
    return create_app(session_secret=_SECRET)


@pytest.mark.asyncio
async def test_me_unauthenticated(app):
    """No session → 401."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_callback_then_me(app):
    """OAuth callback sets session; /api/auth/me then returns the user."""
    fake_user = {
        "id": "123456789",
        "username": "testuser",
        "global_name": "Test User",
        "avatar": None,
    }

    mock_token = MagicMock()
    mock_token.status_code = 200
    mock_token.json.return_value = {"access_token": "fake-token"}

    mock_user = MagicMock()
    mock_user.status_code = 200
    mock_user.json.return_value = fake_user

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(return_value=mock_token)
    mock_http.get = AsyncMock(return_value=mock_user)

    with patch("web.routes.auth.httpx.AsyncClient") as MockHttpx:
        MockHttpx.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockHttpx.return_value.__aexit__ = AsyncMock(return_value=False)

        # Use follow_redirects=True so the callback redirect lands back on /
        # but we only care that the session cookie gets set
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False
        ) as client:
            cb = await client.get("/api/auth/callback?code=fake")
            assert cb.status_code in (302, 307)
            session_cookie = cb.cookies.get("session")
            assert session_cookie is not None, "callback must set a session cookie"

            me = await client.get("/api/auth/me")
            assert me.status_code == 200
            data = me.json()
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
