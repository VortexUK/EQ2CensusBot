"""Tests for census.client URL redaction + service-id scrubbing.

Phase 1 (P0) ships only the security-sensitive _redact_url tests. The
broader census/client.py HTTP-layer coverage is Phase 3.1.

Security contract: the SERVICE_ID segment of Census URLs (/s:<id>/) must
never appear in log output at INFO or above. _redact_url is the single
choke-point; these tests pin its behaviour so a refactor can't accidentally
reintroduce the leakage.
"""

from __future__ import annotations

from census.client import _redact_url


class TestRedactUrl:
    def test_redacts_service_id_in_canonical_url(self):
        """The /s:<service_id>/ segment is replaced with /s:REDACTED/."""
        url = "https://census.daybreakgames.com/s:my-secret-key/json/get/eq2/item/?id=1"
        result = _redact_url(url)
        assert result == "https://census.daybreakgames.com/s:REDACTED/json/get/eq2/item/?id=1"

    def test_redacts_service_id_with_special_chars(self):
        """Service IDs with dots, dashes, and underscores are fully removed."""
        url = "https://census.daybreakgames.com/s:key.with-dashes_and_dots/json/get/eq2/"
        result = _redact_url(url)
        assert "REDACTED" in result
        assert "key.with-dashes_and_dots" not in result

    def test_passes_through_url_without_service_id_segment(self):
        """A URL lacking the /s:<id>/ pattern is returned unchanged."""
        url = "https://example.com/no-service-id-here/"
        assert _redact_url(url) == url

    def test_redacts_only_the_service_id_path_segment(self):
        """Only the /s:<id>/ segment is scrubbed; query-string occurrences of 's:'
        are NOT mangled because the regex requires a trailing slash."""
        url = "https://census.daybreakgames.com/s:secret/json/get/eq2/item/?id=1&extra=s:not-a-key"
        result = _redact_url(url)
        assert "/s:REDACTED/" in result
        # The query-string 's:not-a-key' has no trailing slash so the regex
        # won't match it — it must be preserved verbatim.
        assert "extra=s:not-a-key" in result

    def test_output_contains_no_original_service_id(self):
        """The redacted URL must not contain any part of the real service ID."""
        url = "https://census.daybreakgames.com/s:super-secret-prod-key/json/get/eq2/character/"
        result = _redact_url(url)
        assert "super-secret-prod-key" not in result
        assert "/s:REDACTED/" in result

    def test_redacted_url_preserves_full_path_and_query(self):
        """Path and query params are intact after redaction — only the service segment changes."""
        url = "https://census.daybreakgames.com/s:key123/json/get/eq2/guild/?name=Exordium&world=Varsoon"
        result = _redact_url(url)
        assert result == "https://census.daybreakgames.com/s:REDACTED/json/get/eq2/guild/?name=Exordium&world=Varsoon"
