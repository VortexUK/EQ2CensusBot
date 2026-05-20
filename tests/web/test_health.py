import pytest
from httpx import AsyncClient, ASGITransport

from web.app import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.mark.asyncio
async def test_health_returns_ok(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.asyncio
async def test_health_response_shape(app):
    """Ensure the response always contains exactly the fields we expect."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/health")

    assert set(response.json().keys()) == {"status", "version"}


@pytest.mark.asyncio
async def test_openapi_schema_available(app):
    """OpenAPI schema must be accessible so the API is self-documenting."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/openapi.json")

    assert response.status_code == 200
    assert "paths" in response.json()
