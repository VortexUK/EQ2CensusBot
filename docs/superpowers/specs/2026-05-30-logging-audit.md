# Backend Logging Audit — 2026-05-30

## Executive summary
- Total findings: **74**
- By severity: **P0 = 13**, **P1 = 33**, **P2 = 28**
- By category:
  - Missing security/audit log: 16 (admin actions, auth events, token mint/revoke, role grant/revoke, claim approvals, parse deletes, OAuth failures, HMAC mismatches)
  - Wrong level / level discipline: 8
  - Missing context (world / user_id / request_id): 7
  - Log floods / per-request noise: 5
  - Unused loggers: 7
  - Centralised infra gap: 5 (no request_id, no JSON option, hardcoded log level, no migrations log, no startup config log)
  - Polish / consistency / message style: 26
- Estimated total effort: **~21 hours** (mostly small; ~3 hr for centralised infra)
- Top three structural problems:
  1. **No audit trail.** Every privileged action — admin claim approve/reject, claim delete, kick, role grant/revoke, server settings edit, role-request approve/reject, parse delete/bulk-delete, raid strategy edit, item-watch add/remove, token mint/revoke, OAuth login/logout — is logged at **zero**. Forensics after an incident is impossible from logs alone.
  2. **No request_id propagation.** `web/app.py` has a `_MetricsMiddleware` but no request-id stamp on the contextvar. The CR/LF scrubber `web/lib/log_safety.py:scrub` only masks newlines; the structured-ness comes from line shape alone.
  3. **HMAC mismatches are 401 with no log entry.** A real attack on `/api/parses/ingest` (token-replay or body-tamper) raises an HTTPException without writing a security event. The plugin gets a clear error; the operator sees only a 401 in access logs with no payload diagnostics.

## Findings

### P0 — Secrets / PII leaks / silent security swallows

#### LOG-001: HMAC signature mismatch is silently 401'd with no security event
**Location:** `web/routes/parses/ingest.py:642-646`
**Effort:** small

`_validate_payload_signature` raises a 401 when the HMAC body signature doesn't match. This is the canonical "someone tampered with the payload or replayed it from a hostile network" path, and it produces zero log output beyond the bare HTTP status. An attacker probing for endpoints that don't validate the signature, or a hijacked token holder testing how much they can get away with, would never surface here.

```python
642    if not hmac.compare_digest(expected, sig_header.strip().lower()):
643        raise HTTPException(
644            status_code=401,
645            detail=f"{PLUGIN_SIGNATURE_HEADER} does not match payload.",
646        )
```

**Fix:** Add `_log.warning("[parses-ingest] HMAC signature mismatch for token_id=%s user_id=%s", user.get("token_id"), user["id"])` before the raise. Do NOT log the bearer token, the computed expected HMAC, or the header value itself (would let a future log leak pivot to forgery). Apply the same to the "header missing" 401 at line 604.

---

#### LOG-002: Failed Discord OAuth exchange has no log line
**Location:** `web/routes/auth.py:117-127`
**Effort:** small

Both the token exchange and the user-info fetch can fail. The route raises 400 and the user sees a redirect, but the operator gets nothing — neither the upstream HTTP status, nor the Discord response body (which contains the actionable error like `invalid_grant`, `invalid_client`, `redirect_uri_mismatch`). Diagnosing an OAuth config break (e.g. a rotated client secret on the Discord side) currently requires reproducing it locally with print statements.

```python
117        if token_resp.status_code != 200:
118            raise HTTPException(status_code=400, detail="Failed to exchange OAuth code")
119        access_token = token_resp.json()["access_token"]
120
121        user_resp = await client.get(
122            f"{_DISCORD_API}/users/@me",
123            headers={"Authorization": f"Bearer {access_token}"},
124        )
125        if user_resp.status_code != 200:
126            raise HTTPException(status_code=400, detail="Failed to fetch Discord user")
127        user = user_resp.json()
```

**Fix:** Log at WARNING with the HTTP status and the upstream error code (parse it out of `token_resp.text` if non-200): `_log.warning("[auth] OAuth token exchange failed: HTTP %s — %s", token_resp.status_code, token_resp.text[:200])`. Crucially, never log `access_token`, `code`, or `DISCORD_CLIENT_SECRET`.

---

#### LOG-003: Successful Discord OAuth login has no audit log
**Location:** `web/routes/auth.py:129-150`
**Effort:** small

Every successful login is silent. A compromised session or a user reporting "someone is logged in as me" cannot be cross-referenced against a login timestamp from logs. Same problem for `/auth/logout` — no log line.

```python
129    request.session["user"] = {
130        "id": user["id"],
131        "username": user["username"],
132        "global_name": user.get("global_name"),
133        "avatar": user.get("avatar"),
134    }
135
136    # Persist / update user record in our DB.
137    # Admin IDs are always force-approved — protects against DB wipe lockout.
138    access_status = await upsert_user(
...
150    return _post_login_redirect(return_host, target)
```

**Fix:** `_log.info("[auth] Login: user_id=%s username=%s access_status=%s", user["id"], _scrub(user["username"]), access_status)` after the upsert. Add `_log.info("[auth] Logout: user_id=%s", user["id"])` in `/auth/logout`. Discord IDs at INFO are fine — they're not PII in the GDPR sense (no email/IP) and the audit value far outweighs the rotation cost.

---

#### LOG-004: API token mint/revoke have no audit log
**Location:** `web/routes/auth_tokens.py:71-89`
**Effort:** small

A user minting a long-lived bearer token (used by the ACT plugin to write to `/parses/ingest` on behalf of the user) is exactly the kind of event that should appear in logs — token creation, name, and the truncated prefix are useful for "who created this token?" diagnostics. Token revoke is the cleanup signal that needs to be visible if the user reports the token was leaked. **Currently the entire route module has no logger at all.**

```python
71    @router.post("/auth/tokens", response_model=TokenMintResponse, status_code=201)
72    @limiter.limit("10/minute")
73    async def mint_token(request: Request, body: TokenMintRequest) -> TokenMintResponse:
74        user = _require_user(request)
75        name = body.name.strip()
76        if not name:
77            raise HTTPException(status_code=400, detail="Token name must not be empty.")
78        raw, row = await users_db.mint_api_token(user["id"], name)
79        return TokenMintResponse(token=raw, row=TokenRow(**row))
80
81
82    @router.delete("/auth/tokens/{token_id}", status_code=204)
83    @limiter.limit("30/minute")
84    async def revoke_token(request: Request, token_id: int) -> None:
85        user = _require_user(request)
86        ok = await users_db.revoke_api_token(user["id"], token_id)
```

**Fix:** Add `_log = logging.getLogger(__name__)`. Then:
- After mint: `_log.info("[auth-tokens] Token minted: user_id=%s token_id=%s name=%s prefix=%s", user["id"], row["id"], _scrub(name), row["token_prefix"])`. NEVER log `raw`.
- After revoke (`if ok`): `_log.info("[auth-tokens] Token revoked: user_id=%s token_id=%s", user["id"], token_id)`.

---

#### LOG-005: Admin claim approve / reject / delete have no audit log
**Location:** `web/routes/admin.py:133-178`
**Effort:** small

Approve, reject, delete-single, delete-all-for-user — all four mutating routes call out to `web/db/claims.py` and return cleanly with zero log output. The DB layer is also silent. Admin abuse of the approve path (granting a guild member a claim they shouldn't have) is invisible to anyone but other admins reading the UI.

```python
137    result = await review_claim(claim_id, "approved", admin["id"])
...
164    result = await review_claim(claim_id, "rejected", admin["id"], note=body.note)
...
175    count = await delete_claims_for_user(discord_id)
```

**Fix:** In each route, log at INFO after the mutating call succeeds. Suggested shape:
- approve: `_log.info("[admin] Claim approved: claim_id=%s character=%s discord_id=%s by=%s", claim_id, _scrub(result["character_name"]), result["discord_id"], admin["id"])`
- reject: include the note (truncated)
- delete: include the discord_id that owned it

---

#### LOG-006: Admin role grant / revoke have no audit log
**Location:** `web/routes/admin.py:199-237`
**Effort:** small

Granting `contributor` (which carries `edit_content`) or `supporter` to a Discord user is a privilege change. Same for revoke. With no log, an admin who maliciously grants contributor to themselves and then revokes it leaves no trail.

```python
199    @router.post("/admin/users/{discord_id}/roles/{role}", status_code=200)
200    async def grant_user_role(discord_id: str, role: str, request: Request) -> dict:
...
209        inserted = await grant_role(discord_id, role, admin["id"])
...
221    @router.delete("/admin/users/{discord_id}/roles/{role}", status_code=200)
222    async def revoke_user_role(discord_id: str, role: str, request: Request) -> dict:
...
230        removed = await revoke_role(discord_id, role)
```

**Fix:** Log at INFO after each grant/revoke success (use `inserted`/`removed` for the conditional — idempotent re-grant shouldn't double-log):
```python
if inserted:
    _log.info("[admin] Role granted: role=%s to user_id=%s by=%s", role, discord_id, admin["id"])
```

---

#### LOG-007: Admin role-request approve / reject have no audit log
**Location:** `web/routes/admin.py:270-316`
**Effort:** small

Same shape as LOG-006 — `review_and_grant_role` and `review_role_request` are mutating and silent. The role request system was specifically designed to produce an audit trail in the DB row, but no log mirror exists for searchability.

```python
293    reviewed = await review_and_grant_role(request_id, "approved", admin["id"], body.note)
...
313    reviewed = await review_role_request(request_id, "rejected", admin["id"], body.note)
```

**Fix:** Add `_log.info("[admin] Role request approved: request_id=%s role=%s user_id=%s by=%s", request_id, reviewed["role"], reviewed["discord_id"], admin["id"])` and equivalent for reject.

---

#### LOG-008: `kick_user` admin action has no audit log
**Location:** `web/routes/admin.py:436-450`
**Effort:** small

Kick denies access AND deletes every claim. The single most destructive admin action; no log. The `delete_claims_for_user(discord_id)` return value tells you how many claims were nuked, but only the response body sees that.

```python
436    @router.post("/admin/users/{discord_id}/kick", status_code=200)
437    async def kick_user(discord_id: str, request: Request) -> dict:
...
446        if not await set_user_access(discord_id, "denied"):
447            raise HTTPException(status_code=404, detail="User not found")
448        count = await delete_claims_for_user(discord_id)
449        invalidate_user_claim_cache_all_worlds(discord_id)
450        return {"ok": True, "claims_deleted": count}
```

**Fix:** `_log.warning("[admin] User kicked: user_id=%s by=%s claims_deleted=%d", discord_id, admin["id"], count)`. WARNING (not INFO) because this is a destructive action you want highlighted in log filters.

---

#### LOG-009: Server-settings updates have no audit log
**Location:** `web/routes/admin.py:373-421`
**Effort:** small

Editing `max_level`, `current_xpac`, `launch_dt`, `is_default` for a server is a config change that the rest of the codebase reads from in-memory state (`server_context.load_registry()`). A bad edit silently changes the published API responses for everyone on that subdomain. No log → no idea when the AA cap got wrong.

```python
405    upsert_server_settings_sync(
406        world,
407        max_level=body.max_level,
408        current_xpac=body.current_xpac,
409        launch_dt=body.launch_dt,
410    )
...
414    if body.is_default is True:
415        set_default_server_sync(world)
416    server_context.load_registry()
```

**Fix:** `_log.info("[admin] Server settings updated: world=%s max_level=%s xpac=%s launch_dt=%s is_default=%s by=%s", world, body.max_level, body.current_xpac, body.launch_dt, body.is_default, admin["id"])` right before `load_registry()`.

---

#### LOG-010: Parse delete (single / batch / bulk) has no audit log
**Location:** `web/routes/parses/delete.py:139-228`
**Effort:** small

The whole module declares `_log` but never calls it. Three delete routes — one-by-one, comma-separated batch, and filter-driven bulk — all return silently. Hard purge (`purge=true`) erases the row entirely; that absolutely needs an INFO/WARNING log so you can recover from a buggy admin click.

```python
139    @router.delete("/parses/{encounter_id}", response_model=DeleteParsesResponse)
...
170        removed = await run_sync(_delete_sync)
171        return DeleteParsesResponse(deleted=1 if removed else 0)
...
174    @router.delete("/parses", response_model=DeleteParsesResponse)
...
227        n = await run_sync(_delete_sync)
228        return DeleteParsesResponse(deleted=n)
```

**Fix:** Log after each successful delete. Include `purge` flag and the encounter title for grep:
```python
_log.warning(
    "[parses-delete] %s encounter_id=%s title=%s by=%s",
    "PURGED" if purge else "soft-deleted",
    encounter_id,
    _scrub(enc["title"]),
    user["id"],
)
```
For bulk: log the count and the filter (guild + zone + date) so a wrong-filter accident is reconstructable.

---

#### LOG-011: Raid-strategy edits and zone-overview edits have no audit log
**Location:** `web/routes/raid_strategies.py` (entire file)
**Effort:** small

The whole route module has zero logging. Editor-gated PUT routes mutate the curated raid strategy markdown and the per-zone overview; the revision rows in `raids_db` are the audit trail at the DB level, but nothing in the logs lets you grep "who edited Zek mob 3 last Tuesday" without opening a SQLite browser.

**Fix:** Add `_log = logging.getLogger(__name__)`. In each PUT route after the upsert succeeds: `_log.info("[raid-strategy] Strategy edited: zone=%s encounter=%s position=%s by=%s len=%d", zone, encounter_name, position, user["id"], len(body.markdown))`. Same for zone overview PUT.

---

#### LOG-012: Item-watch add / remove have no audit log
**Location:** `web/routes/item_watch.py:111-212`
**Effort:** small

Item watches are officer-only operations that mark a character as being tracked for a specific item (used for loot discipline). Add/remove are silent. An officer abusing the system (deleting another officer's watch entry to cover for a loot violation) leaves no trace.

```python
182        row = await add_item_watch(...)
...
210        if not await remove_item_watch(watch_id, guild_name, world=current_world()):
211            raise HTTPException(status_code=404, detail="Watch entry not found")
```

**Fix:** `_log.info("[item-watch] Added: guild=%s character=%s item=%s by=%s", guild_name, canon_name, item_name, user["id"])` and equivalent for remove.

---

#### LOG-013: Failed auth attempts on token paths get no security log
**Location:** `web/auth_deps.py:108-115`
**Effort:** small

`lookup_api_token` returning None → 401 "Invalid or revoked token" — no log. A brute-force probe for valid tokens (the prefix is exposed via `/auth/tokens`; the suffix is what's secret) would produce a stream of 401s with no security event to alert on.

```python
108    row = await users_db.lookup_api_token(raw_token)
109    if row is None:
110        raise HTTPException(status_code=401, detail="Invalid or revoked token")
111    if row.get("access_status") not in ("approved", None):
112        raise HTTPException(status_code=403, detail="Account not approved")
```

**Fix:** Log at WARNING when an invalid token is presented. Don't log `raw_token`; do log a hash of it (first 8 hex chars of sha256) plus the source IP so you can grep for "same hash from many IPs" or "many hashes from one IP". Same for the 403 — non-approved account presenting a token is worth knowing about.

---

### P1 — Wrong level / missing context / noisy

#### LOG-014: `_log.info` on every cache hard-expiry → flood
**Location:** `web/cache.py:106`
**Effort:** small

Every cache key that exceeds `max_age` (1 hr) is logged at INFO. With ~500 character keys + ~200 claim keys + an unbounded number of guild derived keys, a process running for many hours sees a continuous trickle of these. Useful at DEBUG, not INFO.

```python
103        if self._max_age is not None and age > self._max_age:
104            del self._store[key]
105            self._update_size()
106            _log.info("[Cache] EXPIRED %s (%.1f min old)", key, age / 60)
107            self._inc_miss()
108            return None, False
```

**Fix:** Downgrade to DEBUG: `_log.debug(...)`. The `CACHE_MISSES` Prometheus counter already covers this at a label-grouped level.

---

#### LOG-015: `_log.info` on every cache delete → flood
**Location:** `web/cache.py:151`
**Effort:** small

Same problem — `cache.delete()` is called from many admin paths and the claim-cache invalidate loop. INFO-level is too loud.

```python
149    def delete(self, key: str) -> None:
150        self._store.pop(key, None)
151        _log.info("[Cache] DEL   %s", key)
152        self._update_size()
```

**Fix:** Downgrade to DEBUG. If you want admin actions visible in logs, put the INFO entry at the admin route (LOG-005, LOG-008), not at the cache layer.

---

#### LOG-016: Census API completion log is per-item-call INFO → flood
**Location:** `census/client.py:945`
**Effort:** small

`_fetch` logs `"[Census] returned=N items"` at INFO on every successful item lookup. Items are looked up on the cache-miss path of the items endpoint, which happens regularly. The `CENSUS_REQUESTS` counter already tracks this.

```python
942    async def _fetch(self, params: dict) -> dict | None:
943        data = await self._census_get("item/", params, timeout_s=10)
944        if data is not None:
945            _log.info("[Census] returned=%s items", data.get("returned"))
946        return data
```

**Fix:** Downgrade to DEBUG. INFO at this point is meaningless without a query identifier.

---

#### LOG-017: `parses/ingest.py` watcher per-tick INFO log is noisy
**Location:** `parses/ingest.py:212-214`
**Effort:** small

`watch()` is the legacy CLI ingest watcher; on every poll tick it INFO-logs the `IngestStats` summary. For long-running watches, this is per-5-second output. Fine for a CLI tool running locally, less fine if anyone ever wires this into a daemon.

```python
210    try:
211        while True:
212            stats = ingest_once(act_db_path, parses_db_path, source_dsn, uploaded_by)
213            if stats.encounters_new or stats.errors:
214                _log.info("Tick: %s", stats)
215            time.sleep(interval_s)
```

This actually only logs when there's data, so it's not strictly a flood — but the message format ("Tick: IngestStats(...)") is ugly. Keep INFO but make it a clean one-liner.

**Fix:** `_log.info("Ingest tick: new=%d errors=%d", stats.encounters_new, stats.errors)`.

---

#### LOG-018: HMAC validation "header missing" 401 has no log
**Location:** `web/routes/parses/ingest.py:604-612`
**Effort:** small

Companion to LOG-001 — when the plugin sends an upload without the `X-Lexicon-Signature` header (old plugin, hostile client) the server 401s with a "please update plugin" message and silently. Operators can't tell from logs whether they're seeing a wave of old-plugin users or active probing.

```python
604    if not sig_header:
605        raise HTTPException(
606            status_code=401,
607            detail=(
608                f"{PLUGIN_SIGNATURE_HEADER} is required for plugin uploads. "
...
612        )
```

**Fix:** `_log.info("[parses-ingest] Token upload missing HMAC header (likely outdated plugin): token_id=%s user_id=%s", user.get("token_id"), user["id"])` before the raise. INFO not WARNING — it's a common benign case.

---

#### LOG-019: Census-down 503 paths don't log
**Location:** `web/routes/character/views.py:489-502`, `web/routes/claim.py:222-235`, `web/routes/aa.py:271-285`
**Effort:** small

When `census_health.is_down()` short-circuits a request to a 503, the user sees the message but the log is silent. This makes "users are getting 503s" hard to attribute — is Census actually down, or has the local health check stuck in `down`?

```python
489    if census_health.is_down():
490        raise HTTPException(
491            status_code=503,
492            detail=f"'{name}' not cached yet and Census is unavailable. Try again shortly.",
493        )
```

**Fix:** `_log.debug("[character] Skipping live fetch — census_health=down (name=%s)", name)`. DEBUG, not INFO — there'll be one per request during an outage. The state change itself is already logged via `census_events.publish` and Prometheus.

---

#### LOG-020: Background guild prewarm failure is DEBUG → too quiet
**Location:** `web/routes/parses/ingest.py:148-149`
**Effort:** small

A prewarm failure means subsequent parse uploads from the same guild will hammer Census serially instead of using the cache. That's a degradation worth seeing at WARNING for a single repeated guild.

```python
144    try:
145        from web.guild_cache import _fetch_and_cache_guild  # noqa: PLC0415
146
147        await _fetch_and_cache_guild(guild_name)
148    except Exception as exc:
149        _log.debug("Background guild prewarm failed for %s: %s", guild_name, exc)
```

**Fix:** Upgrade to WARNING.

---

#### LOG-021: Background guild backfill "Census still unavailable" is DEBUG → useless
**Location:** `web/routes/parses/ingest.py:266-268`
**Effort:** small

When a guild backfill bails because Census is still down, you want a paper trail at INFO so you know which encounters are still pending guild attribution. DEBUG hides it.

```python
266    if isinstance(result, _CensusUnavailable) or result is None:
267        _log.debug(
268            "Background guild backfill for encounter %s: Census still unavailable or unguilded", encounter_id
269        )
270        return
```

**Fix:** Separate the two branches and log differently — `INFO` for "Census still down, will retry on next opportunity" and DEBUG for "no guild (unguilded)".

---

#### LOG-022: `census_store` migration swallow is DEBUG with truncated SQL → confusing
**Location:** `census/census_store.py:96-97`
**Effort:** small

Truncating the SQL statement to 60 chars when something goes wrong is wrong-shaped — `OperationalError` in this context usually means the column already exists, but if it's a real syntax error you want the whole statement.

```python
93    for stmt in _MIGRATIONS:
94        try:
95            conn.execute(stmt)
96        except sqlite3.OperationalError as exc:
97            _log.debug("[census_store] migration swallowed: %s (%s)", stmt[:60], exc)
```

**Fix:** Log full `stmt`; bump to INFO since this is a (rare) migration event:
```python
_log.info("[census_store] migration skipped (likely already applied): %s — %s", stmt, exc)
```

---

#### LOG-023: Background spell-effect parse failure logs without character context
**Location:** `web/routes/aa.py:331-333`
**Effort:** small

The log line gives the spell CRC but not the context — what character was viewing it. Diagnosing "user X sees no effects on AA Y" needs the character or at least the request URL.

```python
326    if row:
327        matched_tier = row.get("tier")
328        if row.get("effects"):
329            try:
330                effects = json.loads(row.get("effects", "[]"))
331            except Exception as exc:
332                _log.warning("[aa] Failed to parse effects JSON for crc=%s: %s", spellcrc, exc)
```

**Fix:** Include the requested tier too: `_log.warning("[aa] Failed to parse effects JSON for crc=%s tier=%s: %s", spellcrc, tier, exc)`. A request_id (see LOG-066) would cover this for free.

---

#### LOG-024: `_DBCollector` errors close the conn but log only the table-level error
**Location:** `web/metrics.py:192-194`, `:206-208`, `:220-222`
**Effort:** small

Three near-identical blocks log `_log.error("[metrics] users.db collector error: %s", exc)` etc. and call `_close_conn`. Real errors here would be useful at ERROR with a stack trace (`exc_info=True`) — they indicate the COUNT query failed, which is rare and structural.

```python
192            except Exception as exc:
193                _log.error("[metrics] users.db collector error: %s", exc)
194                self._close_conn("users")
```

**Fix:** `_log.exception("[metrics] users.db collector error")` — `.exception` adds the traceback automatically. Same for the other two.

---

#### LOG-025: `_log.error` on the recurring `[Cache] Background AA refresh failed` → wrong level
**Location:** `web/routes/aa.py:228-229`
**Effort:** small

A background AA refresh failing on Census timeout is operationally routine — it's the whole reason `census_refresh` has throttling and skip-when-down logic. ERROR is reserved for "something is wrong that needs investigation"; this is WARNING at most.

```python
226            aa_cache.set(cache_key, result)
227    except Exception as exc:
228        _log.error("[Cache] Background AA refresh failed for %s: %s", name, exc)
```

**Fix:** Downgrade to WARNING.

---

#### LOG-026: `_log.error` for `_fetch_and_cache_guild` failure → wrong level
**Location:** `web/guild_cache.py:379-380`
**Effort:** small

Same shape as LOG-025 — guild fetch failure is recoverable, downstream callers handle None. WARNING.

```python
377    try:
378        return await task
379    except Exception as exc:
380        _log.error("[Cache] Guild fetch failed for %s: %s", guild_name, exc)
381        return None
```

**Fix:** Downgrade to WARNING.

---

#### LOG-027: `_log.error` for guild live-fetch failure → wrong level
**Location:** `web/routes/guild.py:247`, `:299`
**Effort:** small

Two identical lines in `get_guild_info` and `get_guild`. Same logic — recoverable, frontend handles the 503. WARNING.

```python
246    try:
247        await _persist_and_publish_guild(guild_name)
248    except Exception as exc:
249        _log.error("[guild] Live fetch failed for %s: %s", _scrub(guild_name), exc)
```

**Fix:** Downgrade to WARNING.

---

#### LOG-028: Census error on guild lookup uses ERROR + bare logger.error → wrong level
**Location:** `census/client.py:679-680`
**Effort:** small

When a character guild lookup fails, ERROR fires and the exception is re-raised. The caller has its own warning handler at the next level up. So in practice every legitimate Census flake produces ERROR+WARNING for the same event.

```python
678        except Exception as exc:
679            _log.error("[Census] API error fetching guild for %r: %s: %r", character_name, type(exc).__name__, exc)
680            raise  # re-raise so callers can detect the failure
```

**Fix:** Downgrade to WARNING (or DEBUG — the caller already warns).

---

#### LOG-029: Item-watch background check is per-watch log on EVERY check → noisy
**Location:** `web/routes/item_watch.py:74-81`
**Effort:** small

`_check_all_watches` iterates every watch entry for a guild on every guild fetch. A failure logs WARNING per watch — for a guild with 50 watches and a transient blip, you get 50 WARNINGS at once.

```python
77    for w in watches:
78        try:
79            await _check_watch(w)
80        except Exception as exc:
81            _log.warning("[item_watch] Check failed for watch_id=%s: %s", w.get("id"), exc)
```

**Fix:** Collect failures into a list, log once at the end: `_log.warning("[item_watch] %d/%d watch checks failed for guild=%s (first: %s)", len(failures), len(watches), guild_name, failures[0])`. Or downgrade to DEBUG.

---

#### LOG-030: `_log.warning("[Claims] Guild fetch failed for: %s", failed_names)` — list dump
**Location:** `web/routes/claim.py:111`
**Effort:** small

Dumping a Python list with default `str()` to a log line is hard to grep. For 1-2 names it's fine; for 10+ it's a big single-line monster.

```python
109        if failed_names:
110            any_failed = True
111            _log.warning("[Claims] Guild fetch failed for: %s — result will not be cached", failed_names)
```

**Fix:** Join explicitly + cap: `_log.warning("[Claims] Guild fetch failed for %d names (first: %s) — result will not be cached", len(failed_names), failed_names[0])`.

---

#### LOG-031: Background claim refresh logs DOUBLE-scrubs the exception
**Location:** `web/routes/claim.py:143-148`
**Effort:** small

`_safe_for_log(exc)` calls `str(exc)` on an exception; that's almost certainly fine, but `scrub` is for user-supplied values, not for Python internal types. The intent is muddled.

```python
142    except Exception as exc:
143        _log.error(
144            "[Cache] Background claim refresh failed for %s on %s: %s",
145            _safe_for_log(discord_id),
146            _safe_for_log(world),
147            _safe_for_log(exc),
148        )
```

**Fix:** Use `_log.exception(...)` instead — gets the traceback for free, and lose the scrub-of-exception which is meaningless.

---

#### LOG-032: `[startup] Pre-warming character cache for N character(s) on world…` at INFO during pre-warm
**Location:** `web/routes/character/views.py:376`
**Effort:** small

Fine at startup, but no closing "complete" log per-world — only the aggregate at line 418. For a slow Census, a stuck pre-warm leaves the operator wondering which world is still going. Add a per-world "complete" line at INFO.

```python
376        _log.info("[startup] Pre-warming character cache for %d character(s) on %s...", len(names), world)
...
389                    _log.warning("[startup] Pre-warm failed for %s (%s): %s", name, world, exc)
```

**Fix:** After `await asyncio.gather(...)`, log `_log.info("[startup] Pre-warming complete for %s (%d character(s))", world, len(names))`.

---

#### LOG-033: Inner per-character pre-warm WARNING is one-per-character → flood on Census outage
**Location:** `web/routes/character/views.py:388-389`
**Effort:** small

If Census is down at startup, every claimed character (~hundreds across both worlds) will log a warning. Each is the same exception.

```python
387                except Exception as exc:
388                    _log.warning("[startup] Pre-warm failed for %s (%s): %s", name, world, exc)
```

**Fix:** Catch + count at the outer level. Within `_prewarm_for_world`, accumulate failures and log once:
```python
failures: list[str] = []
...
if failures:
    _log.warning("[startup] Pre-warm failed for %d character(s) on %s (first: %s — %s)",
                 len(failures), world, failures[0][0], failures[0][1])
```

---

#### LOG-034: Census refresh failures log with `_scrub(name)` but exception isn't scrubbed
**Location:** `web/census_refresh.py:78`, `:115`
**Effort:** small

The exception string can contain user-supplied values (the URL the character name was injected into, an error message echoed back). For consistency, either scrub the whole tail or use `_log.exception` for the traceback (which `scrub` wouldn't apply to anyway).

```python
77    except Exception as exc:
78        _log.warning("[census-refresh] character %s failed: %s", _scrub(name), exc)
```

**Fix:** Use `_log.exception("[census-refresh] character %s failed", _scrub(name))`. Same for the guild variant at line 115.

---

#### LOG-035: `_log` declared but never used in 7+ modules
**Location:** `web/routes/parses/list.py:45`, `web/routes/character/spells.py:29`, `web/routes/character/upgrades.py:36`, `web/routes/admin.py:40`, `web/routes/auth.py:16`, `bot/cogs/aacheck.py:17`
**Effort:** small

Modules declare `_log = logging.getLogger(__name__)` then never call it. Dead code; misleading to anyone scanning for log sites. The fix is to either delete the line or actually log something (most of these are P0 audit-trail finds — pair the log addition with the removal).

**Fix:** Cross-reference with the LOG-002..LOG-012 fixes — most of those route modules need a log call added; once they have it, the dead-`_log` finding goes away. For genuinely-unused ones (e.g. `parses/list.py` is read-only — no audit-relevant action), delete the line.

---

#### LOG-036: `auth_deps.py` logs ADMIN_DISCORD_IDS-not-set on import with the root logger
**Location:** `web/auth_deps.py:71-74`
**Effort:** small

It's the right warning to surface, but `logging.getLogger(__name__).warning(...)` runs at module import. If the import order means logging isn't fully configured (it is, in this app, because `main.py` configures it before any imports), this could be lost. Also, on every test that imports auth_deps with no env set, the line floods.

```python
71    if not ADMIN_IDS:
72        logging.getLogger(__name__).warning(
73            "ADMIN_DISCORD_IDS is not set — admin-only endpoints will return 403 for every caller."
74        )
```

**Fix:** Move to a deferred path (the first call to `require_admin`, gated by a "warned-once" flag), or stay at module level but add `if not os.getenv("PYTEST_CURRENT_TEST")` to suppress in tests.

---

#### LOG-037: `census_health.poll_loop` exception catch swallows + logs at WARNING
**Location:** `web/census_health.py:99-104`
**Effort:** small

This is the dedicated "never let the poll loop die" catch. WARNING is right; but it should be `_log.exception(...)` so the traceback is present — a recurring exception here would be a real bug to debug.

```python
98    while True:
99        try:
100            await refresh_health()
101        except Exception as exc:  # pragma: no cover - defensive
102            _log.warning("[census-health] probe error: %s", exc)
103        await asyncio.sleep(_POLL_INTERVAL)
```

**Fix:** `_log.exception("[census-health] probe error")`.

---

#### LOG-038: Census health DEBUG-level probe failure → loses the most useful diagnostic
**Location:** `web/census_health.py:78`
**Effort:** small

A failed probe is INFO-worthy — that's the input to the health state change. DEBUG hides it; if Census is misbehaving and the probe is returning false but state hasn't flipped, the diagnostic is invisible.

```python
75        return _body_looks_healthy(body)
76    except Exception as exc:
77        _log.debug("[census-health] Probe failed: %s", exc)
78        return False
```

**Fix:** Upgrade to INFO. Probe runs every 5 minutes; cost is negligible.

---

#### LOG-039: `census_lifecycle.aclose_all` close-error is WARNING → fine, but should be `exception`
**Location:** `web/lib/census_lifecycle.py:85-87`
**Effort:** small

```python
83        try:
84            await client.close()
85        except Exception as exc:
86            _log.warning("[census-lifecycle] Error closing CensusClient for loop %d: %s", key, exc)
```

**Fix:** `_log.exception("[census-lifecycle] Error closing CensusClient for loop %d", key)`.

---

#### LOG-040: `[startup] item_stats backfill error` is ERROR but no exc_info
**Location:** `web/app.py:123-124`
**Effort:** small

```python
122    except Exception as exc:
123        _log.error("[startup] item_stats init/backfill error: %s", exc)
```

**Fix:** `_log.exception("[startup] item_stats init/backfill error")`.

---

#### LOG-041: Self-heal cache write skip at DEBUG without name context
**Location:** `web/routes/character/views.py:482`
**Effort:** small

`_log.debug("[character] self-heal cache write skipped: %s", exc)` — name is in scope (`resp.name`), should be included for grep.

```python
480            except Exception as exc:
481                _log.debug("[character] self-heal cache write skipped: %s", exc)
```

**Fix:** Add `name`: `_log.debug("[character] self-heal cache write skipped for %s: %s", name, exc)`.

---

#### LOG-042: Recipes/items secondary_comps JSON parse warning has no character/page context
**Location:** `web/routes/recipes.py:161-162`, `census/db.py:777-778`, `census/recipes_db.py:423-424`
**Effort:** small

Three places log JSON parse failures for stored data. All include `row["id"]` / `item_id` but no `request_id` — diagnosing "user got a 500 on recipe X" needs the request mapped back to the parse-fail row.

Once LOG-066 (request_id) lands, these become natively trackable; today they're orphan diagnostic lines.

**Fix:** Wait for LOG-066, then add `extra={"request_id": …}` (or a `_scrub`-shaped helper).

---

#### LOG-043: Cache hit/miss DEBUG logs at every step → log volume in DEBUG mode
**Location:** `web/cache.py:83`, `:110`, `:118`, `:123`, `:145`
**Effort:** medium

Five DEBUG sites in TTLCache. With `LOG_LEVEL=DEBUG` enabled (the project pattern), every cache operation emits a line. The cache is hit on every request; for a busy minute that's hundreds of lines.

```python
83        _log.debug("[Cache] HIT   %s", key)
...
110        _log.debug("[Cache] %s %s", "STALE" if is_stale else "HIT  ", key)
...
118        _log.debug("[Cache] SET   %s", key)
...
123            _log.debug("[Cache] EVICT (maxsize) %s", oldest_key)
...
145            _log.debug("[Cache] SWEEP removed %d expired entries from %s", len(expired), self._name)
```

The intent (debug troubleshooting) is right; the implementation defeats the purpose. Consider a separate `eq2.cache` logger that can be enabled independently.

**Fix:** Move these to a named logger `_log = logging.getLogger("eq2.cache")` so they can be toggled to DEBUG independently of the rest of the app.

---

#### LOG-044: Background snapshot resolution failure → no encounter title context
**Location:** `web/routes/parses/ingest.py:289-290`
**Effort:** small

The encounter id is logged but not the title — debugging a specific bad upload needs both.

```python
288    except Exception as exc:
289        _log.warning("Background snapshot resolution failed for encounter %s: %s", encounter_id, exc)
```

**Fix:** Pass the title down: `_log.warning("Background snapshot resolution failed for encounter %s (%s): %s", encounter_id, _scrub(enc_title), exc)`. The encounter title is the `body.encounter.title`.

---

#### LOG-045: Character cache pre-warm error uses ERROR for a recoverable startup condition
**Location:** `web/routes/character/views.py:393-394`, `:412-413`
**Effort:** small

Pre-warm failures don't break the app — characters just resolve on first hit. ERROR is too loud.

```python
393    except Exception as exc:
394        _log.error("[startup] Character cache pre-warm error for %s: %s", world, exc)
...
412    except Exception as exc:
413        _log.error("[startup] Could not load server registry for pre-warm: %s", exc)
```

**Fix:** Downgrade to WARNING.

---

#### LOG-046: `parses/ingest.py:180` uses `_log.exception` correctly but with redundant `: %s` placeholder
**Location:** `parses/ingest.py:180`
**Effort:** small

`exception` already appends the traceback; the explicit `: %s % exc` duplicates it.

```python
178            except Exception as exc:
179                errors += 1
180                _log.exception("Failed to ingest encounter %s: %s", encid, exc)
```

**Fix:** `_log.exception("Failed to ingest encounter %s", encid)` — exc gets logged via the traceback.

---

### P2 — Polish

#### LOG-047: No request_id contextvar → log lines aren't correlatable
**Location:** N/A (codebase-wide)
**Effort:** medium

A middleware that stamps `request_id = secrets.token_hex(8)` on a contextvar at request start, and a `logging.Filter` that injects it into every record, would make cross-line tracing trivial. Without it, a 503 + a "Census fetch failed" in the same request are not joinable from logs alone.

**Fix:** Add `web/lib/request_id.py` with a contextvar + Filter; wire into `_MetricsMiddleware` (or a sibling middleware) and into `logging.basicConfig` format. Add `[req=%s]` to the existing format string.

---

#### LOG-048: No JSON log format option
**Location:** `main.py:13-18`
**Effort:** small

Railway parses JSON natively (it's the difference between "search-grep" and "structured-query"). Today's format is human-readable text — that's friendlier for stdout but loses the ability to filter by field. A `LOG_FORMAT=json` env switch would be a cheap win.

```python
13    logging.basicConfig(
14        level=logging.INFO,
15        format="%(asctime)s.%(msecs)03d  %(levelname)-8s  %(message)s",
16        datefmt="%Y-%m-%d %H:%M:%S",
17        force=True,
18    )
```

**Fix:** Branch on `os.getenv("LOG_FORMAT", "text").lower()`. Use `python-json-logger` or roll a tiny custom Formatter.

---

#### LOG-049: Log level hardcoded to INFO
**Location:** `main.py:14`
**Effort:** small

Should be env-driven so `LOG_LEVEL=DEBUG` can crank verbosity for one debug session without a code change.

**Fix:** `level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)`.

---

#### LOG-050: No migration-ran log in `web/db/migrations.py`
**Location:** `web/db/migrations.py:24-160`
**Effort:** small

`apply_migrations` runs a sequence of guarded ALTERs and seeds. On a fresh prod boot or a column-add deploy, you can't tell from logs which migration steps actually fired. Memory `[[test-migrations-against-old-db-shape]]` shows the operator has been burned by this in the past.

**Fix:** Log INFO when an ALTER actually runs (inside the `if "X" not in cols` branch): `_log.info("[migrations] users.access_status column added")`. Don't log the IF-NOT-EXISTS index creates (too noisy); do log the seeds when a row was newly inserted (use the `rowcount` from `executemany`).

---

#### LOG-051: No "logging configured" startup line
**Location:** `main.py`
**Effort:** small

A single INFO at startup that records the log level, format, and process role (bot/web/both) helps future debugging.

**Fix:** After basicConfig: `logging.getLogger("eq2.startup").info("Logging configured: level=%s format=%s", level_name, format_name)`.

---

#### LOG-052: Inconsistent logger prefix conventions
**Location:** codebase-wide
**Effort:** medium

Mix of `[Cache]`, `[Census]`, `[DB]`, `[census-refresh]`, `[census-health]`, `[startup]`, `[item-watch]`, etc. Brackets/case/hyphen-vs-underscore vary. Once we structured-log via `extra=`, prefix becomes redundant; until then, pick one style.

**Fix:** Canonicalise on `[lowercase-with-hyphens]` (matches the loadbalancer-friendly convention). Update prefixes in-place. Document the convention in CONTRIBUTING.md.

---

#### LOG-053: `_log.debug("[Census] HTTP %s url=%s", resp.status, _redact_url(str(resp.url)))` — redundant DEBUG pair
**Location:** `census/client.py:141`, `:144` (and `:671`, `:674`)
**Effort:** small

Two DEBUG lines per call (one before, one after). With debug logging on, that's 2× the volume. Either keep just the END one (logs status), or fold them into a single multi-arg line.

**Fix:** Drop the pre-request DEBUG; keep the response one which already has the URL.

---

#### LOG-054: `_log.debug("item query=%r params=%s", name, self.bot.census._build_params(name))` calls private function
**Location:** `bot/cogs/items.py:28`
**Effort:** small

The bot cog reaches into `_build_params` (private) just to log it. Either expose a public log helper on CensusClient, or just log `name` — `_build_params` is deterministic from `name`.

**Fix:** Simplify: `_log.debug("item query=%r", name)`.

---

#### LOG-055: `_log.debug("item result=%s", "found: " + item_data.name if item_data else "not found")` operator precedence pitfall
**Location:** `bot/cogs/items.py:30`
**Effort:** small

Python's `if`/`else` ternary binds at higher precedence than `+`, so this *happens* to work but is hard to read. Use an f-string for the message arg (the `_log.debug` is gate-checked so f-string eval is fine, but the whole project uses %-style).

**Fix:**
```python
result_str = f"found: {item_data.name}" if item_data else "not found"
_log.debug("item result=%s", result_str)
```

---

#### LOG-056: `_log.warning("ACT export DB not present at %s; nothing to ingest.", act_db_path)` is INFO-shaped
**Location:** `parses/ingest.py:97`
**Effort:** small

In the CLI watcher this is "you haven't set up ACT yet" — normal. Should be INFO.

**Fix:** Downgrade to INFO.

---

#### LOG-057: `_log.info("Uploader %s → guild %s", uploader, guild_name)` per-CLI-ingest line is fine but unscrubbed
**Location:** `parses/ingest.py:105`, `:107`, `:243`, `:250`, `:257`
**Effort:** small

Uploader name comes from env var or DB — not strictly user-controlled in the CLI case, but a consistency pass would scrub it.

**Fix:** Apply `_scrub` to uploader / guild_name in log lines, or document that this CLI path doesn't need it.

---

#### LOG-058: `_log.warning` on cache pre-warm failure logs character name twice
**Location:** `web/guild_cache.py:317`
**Effort:** small

```python
316            except Exception as exc:
317                _log.warning("[guild_cache] Pre-warm failed for %s: %s", ov.name, exc)
```

Pre-warm runs per character; on a Pydantic shape error every member logs. Accumulate.

**Fix:** Collect + log once: `_log.warning("[guild_cache] %d pre-warm failures (first: %s — %s)", len(fails), fails[0].name, fails_exc[0])`.

---

#### LOG-059: `image/aa_tree.py` tree-index load failure includes only filename
**Location:** `image/aa_tree.py:185`
**Effort:** small

```python
184                except Exception as exc:
185                    _log.warning("[aa_tree] Failed to load tree index %s: %s", path.name, exc)
```

Filename is fine; should be `exc_info=True` because this points at a broken JSON file that needs investigating.

**Fix:** `_log.warning("[aa_tree] Failed to load tree index %s: %s", path.name, exc, exc_info=True)` — or `_log.exception(...)`.

---

#### LOG-060: `swallow()` defaults to DEBUG → real metric increments errors invisible
**Location:** `web/lib/silent_swallow.py:30`
**Effort:** small

The five `with swallow("metrics"):` blocks in `web/cache.py` are arguably the most-trafficked sites in the app. A metrics-library version bump that breaks `CACHE_HITS.labels(...)` would silently fail under DEBUG-only logging, masking a real prod problem.

**Fix:** Add an explicit `level=logging.WARNING` to category="metrics" sites, or split the swallow categories — keep "metrics" at DEBUG (genuinely best-effort) but encourage WARNING for new categories.

---

#### LOG-061: HMAC validation skipped-for-session-auth path emits no log
**Location:** `web/routes/parses/ingest.py:595-601`
**Effort:** small

The session-auth-with-no-header branch is the silent-pass case. Browsers shouldn't be hitting this route, so an INFO/DEBUG noting "browser uploading via session" is operationally helpful.

```python
595    if user.get("auth_source") != "token":
596        if sig_header:
597            raise HTTPException(
598                status_code=400,
599                detail=f"{PLUGIN_SIGNATURE_HEADER} is only valid for token-authenticated requests.",
600            )
601        return
```

**Fix:** Add `_log.debug("[parses-ingest] Session-auth upload (no HMAC validation) user_id=%s", user["id"])` before the return.

---

#### LOG-062: Census-down branch in `claim.py` doesn't log
**Location:** `web/routes/claim.py:224-227`, `:232-236`
**Effort:** small

Same family as LOG-019.

```python
224    if census_health.is_down():
225        raise HTTPException(
226            status_code=503,
227            detail="Census is unavailable. Cannot verify character existence — try again shortly.",
228        )
229    try:
230        async with shared_census_client() as client:
231            char = await client.get_character(name, current_world())
232    except Exception:
233        raise HTTPException(
234            status_code=503,
235            detail="Census is unavailable. Cannot verify character existence — try again shortly.",
236        )
```

**Fix:** Log at DEBUG with character + user. The bare `except Exception:` should at least capture the type — `except Exception as exc: _log.warning("[claim] Census fetch failed: %s", exc)` before re-raising.

---

#### LOG-063: `census/client.py:_redact_url` only redacts the SERVICE_ID — doesn't redact `displayname=` from query string
**Location:** `census/client.py:36-44`
**Effort:** medium

Query parameters are logged at DEBUG only (`_log.debug("... params=%s", params)`), but if the URL is logged elsewhere with the full querystring, character names appear. Cheap defence — add a redact pass for `displayname=...`.

```python
36    def _redact_url(url: str) -> str:
37        """Return the URL with the SERVICE_ID segment redacted."""
38        ...
44        return _SERVICE_ID_RE.sub("/s:REDACTED/", url)
```

**Fix:** Probably not worth fixing — DEBUG-only and character names aren't really sensitive on Census (they're public-by-design). Document the boundary in the comment.

---

#### LOG-064: Bot cog `bot/cogs/aacheck.py` declares `_log` but never uses it
**Location:** `bot/cogs/aacheck.py:17`
**Effort:** small

(Subset of LOG-035 but worth specifically calling out — would benefit from an INFO line on each `/aacheck` invocation to mirror the audit value of `/items` etc.)

**Fix:** Either delete `_log = ...` or add a per-invocation debug/info line.

---

#### LOG-065: `bot/bot.py` "Slash commands synced." INFO is once-per-startup → fine, but format is bland
**Location:** `bot/bot.py:37`
**Effort:** small

Minor: include the guild ids and command count for forensics.

```python
37        _log.info("Slash commands synced.")
```

**Fix:** `_log.info("Slash commands synced to %d guild(s)", len(DISCORD_SYNC_GUILD_IDS))`.

---

#### LOG-066: `recipes` route uses `_log.warning` for parse-fail but `_log` isn't used for actual route-level events
**Location:** `web/routes/recipes.py`
**Effort:** small

This is a sub-case of LOG-035: the module logs JSON parse failures but the recipe lookup itself doesn't trace anything. Recipes is a read-only public endpoint so the bar is low; consider adding a DEBUG for "recipe %s not found".

**Fix:** Optional — DEBUG line on the not-found branch.

---

#### LOG-067: `census/client.py` `_log.warning("[DB] Failed to cache item %s: %s", ...)` is below `_log.exception` for real failures
**Location:** `census/client.py:204-205`
**Effort:** small

Cache-write failure of a Census-fetched item indicates items.db is broken — important to know.

```python
203            _log.debug("[DB] Cached item %s (%s)", raw.get("id"), raw.get("displayname"))
204        except Exception as exc:
205            _log.warning("[DB] Failed to cache item %s: %s", raw.get("id"), exc)
```

**Fix:** Upgrade to `_log.exception("[DB] Failed to cache item %s", raw.get("id"))`.

---

#### LOG-068: census-health `_log.warning("[census-health] non-JSON 200 response: %r", text[:200])` lacks the URL/status
**Location:** `web/census_health.py:74`
**Effort:** small

`%r` on a string truncated to 200 chars is fine; should also include the probe URL so anyone debugging knows which collection misbehaved.

**Fix:** `_log.warning("[census-health] non-JSON 200 from %s: %r", _PROBE_URL, text[:200])` — but `_PROBE_URL` has the SERVICE_ID embedded. Use `_redact_url` from `census/client.py`.

---

#### LOG-069: No log when `WEB_CONCURRENCY` raises at startup
**Location:** `web/app.py:242-249`
**Effort:** small

The lifespan raises a RuntimeError if `WEB_CONCURRENCY != 1`. The exception propagates and uvicorn surfaces it — fine — but a clean INFO before the raise would help operators understand the single-worker constraint at-a-glance.

**Fix:** `_log.info("[startup] WEB_CONCURRENCY=%d (must be 1 for in-process SSE + LRU)", _workers)` after the value is read.

---

#### LOG-070: Discord bot has no `discord.py` log level config → defaults can be noisy
**Location:** `bot/bot.py` + `main.py`
**Effort:** small

`discord.py` registers `discord.client`, `discord.gateway`, etc. loggers — all default to WARNING. Worth verifying we're not double-logging or losing useful HTTP-error context.

**Fix:** Add an explicit `logging.getLogger("discord").setLevel(logging.WARNING)` in `main.py` so a future `discord.py` default-level change doesn't silently flood logs.

---

#### LOG-071: `tests/parses/test_db.py` reads stdout when the helper logs → fragile
**Location:** N/A (tests don't currently capture; verified via grep)
**Effort:** small

Tests don't use `caplog` — they rely on the test runner's own capture. Fine today; if anyone ever adds an `_log.info` to a hot test path the tests will start flooding pytest output.

**Fix:** Add `[tool.pytest.ini_options] log_level = "WARNING"` to `pytest.ini` so test runs default to quieter logs.

---

#### LOG-072: Cache `[Cache] EVICT (maxsize)` DEBUG → useful as INFO at most, sample-rate-able
**Location:** `web/cache.py:123`
**Effort:** small

Evictions happen when the cache is at capacity — that's an operational signal worth INFO (and a Prometheus counter, which exists). Currently DEBUG.

```python
121        if key not in self._store and len(self._store) >= self._maxsize:
122            oldest_key = next(iter(self._store))
123            del self._store[key]
124            _log.debug("[Cache] EVICT (maxsize) %s", oldest_key)
```

**Fix:** Keep DEBUG — Prometheus covers this. The DEBUG log is fine for low-volume troubleshooting.

---

#### LOG-073: census `_log.debug("[Census] GET %s params=%s", _redact_url(url), params)` includes `params` dict
**Location:** `census/client.py:141`, `:671`
**Effort:** small

`params` contains the character or guild name being looked up. DEBUG, so probably fine; but be aware that turning on DEBUG in prod surfaces user-supplied names. The CR/LF scrub applies but the names themselves are sensitive-ish in a guild-tool context. Document the boundary.

**Fix:** Optional — document; no behavioural change.

---

#### LOG-074: Scripts/dev `_order_check.py` etc. print Census URLs containing SERVICE_ID
**Location:** `scripts/dev/_order_check.py:15-17`, `scripts/dev/_debug_character.py:20`, `scripts/dev/_check_db.py`, etc.
**Effort:** small

Dev-only scripts (`scripts/dev/`) print URLs that include `SERVICE_ID` to stdout. Local dev only; unlikely to leak. But if anyone copy-pastes from a CI run, the ID could end up somewhere it shouldn't.

```python
10    url = f"https://census.daybreakgames.com/s:{SERVICE_ID}/get/eq2/item?c:start={start}&c:limit=5&c:sort=id:ASC"
...
15        print(f"c:start={start} (sorted by id ASC):")
```

**Fix:** Optional — reuse `_redact_url` in dev scripts too, or comment that these are dev-only. Low priority.

---

## Cross-cutting recommendations

### A) Add a request_id contextvar + logging filter (P1, medium effort)

The single largest win in this audit. Three small files:
1. `web/lib/request_id.py` — contextvar + `logging.Filter` that injects `record.request_id`.
2. Hook into the existing `_MetricsMiddleware` (or a new sibling middleware that runs *before* it) to stamp `request_id = secrets.token_hex(8)` on the contextvar at request start.
3. Update `main.py`'s log format to include `[req=%(request_id)s]` and attach the filter.

Once this lands, all the "missing context" findings (LOG-023, LOG-041, LOG-042) get free coverage, and the audit-trail INFOs (LOG-001..LOG-013) become correlatable per-request.

### B) Build a `web/lib/audit.py` helper (P0/P1, small effort)

A dedicated helper for the audit-trail INFOs would let routes write `audit("claim_approved", claim_id=..., by=admin["id"])` instead of hand-rolling each `_log.info(...)` line. Three benefits:
- Forces a stable schema for log-aggregator dashboards.
- Centralises the scrub + redact rules.
- Makes the "I'll add audit logging" P0 sweep mechanical: just call `audit(...)` in each mutating route.

Suggested API:
```python
def audit(event: str, **fields: object) -> None:
    """Write an INFO log line in stable key=value shape for audit-trail events."""
    parts = " ".join(f"{k}={_scrub(v)}" for k, v in fields.items())
    logging.getLogger("eq2.audit").info("[audit] %s %s", event, parts)
```

### C) Centralise log config in `web/app.py` startup, not `main.py` module-level (P2, medium effort)

`main.py`'s `logging.basicConfig` runs at module import — fine when `main.py` is the entrypoint, less fine in tests (where pytest sets up its own logging). Move the bulk into a `configure_logging()` helper called from `create_app()` and from `bot.py`'s setup hook. Add the env-driven level + format from LOG-048 / LOG-049 there.

### D) The HMAC mismatch path (LOG-001) deserves a per-token rate-limit counter

Beyond logging it, a `failed_hmac_total{token_id}` Counter (label cardinality bounded by active tokens) would let alerts fire on "token X is producing N failures/min". The plugin should never produce a single failure under normal operation.

### E) The migrations module needs INFO logs (LOG-050)

When `apply_migrations` runs an actual ALTER (not the IF-NOT-EXISTS index creates), an INFO line documents the schema bump for the deployment. Pair with the existing memory `[[test-migrations-against-old-db-shape]]` — the operator has been burned by this before.

### F) The `swallow()` helper undersells the "intentional silent failure" use case (LOG-060)

Defaulting to DEBUG was a Phase 2a deliberate choice (`silent_swallow.py:30`) — but in practice the `metrics` swallows ARE the right place to keep DEBUG. Other categories that might appear later (a future "cache-write-best-effort" swallow, say) should default WARNING. Recommend either:
- Bump the default `level=` to WARNING and explicitly opt into DEBUG for metrics.
- Or rename `swallow` to make the level required, no default.

### G) Discord-bot logger naming inconsistency

`discord.py` registers its own loggers; the bot cogs use `__name__` which resolves to `bot.cogs.X`. That's fine, but Discord's internal loggers are noisy by default. Bind them to WARNING explicitly (LOG-070) so a future discord.py upgrade doesn't unexpectedly turn the bot into a chatterbox.

---

## What was deliberately NOT flagged

- **Per-request `_log.debug` HIT/MISS in cache.py** — they're DEBUG by design and the Prometheus counter is the production-grade equivalent. LOG-043 suggests a separate logger name, but the current state is acceptable.
- **`bot/cogs/items.py` query DEBUG** — query name is user-supplied but logged at DEBUG only; the SCM-level decision in BE-007 already redacts SERVICE_ID. No further action needed.
- **`download_items.py` / `download_spells.py` / `download_recipes.py` print(...) usage** — CLI tools, intentional. The pattern is fine for scripts; they print URLs with SERVICE_ID but only locally.
- **Phase 2c.7 swallow() conversions** — spot-checked the `swallow("metrics")` sites in `web/cache.py`; they're correctly best-effort. No "real error swallowed silently" case found among them.
- **`web/lib/log_safety.py:scrub` itself** — only strips CR/LF (CWE-117 defence). That's narrow; arguably it should also strip ANSI escape sequences (CWE-117 expanded). Left out because no findings depend on it.

---

## Effort summary

| Bucket | Count | Effort each | Total |
|---|---|---|---|
| Add `_log.info` audit-trail line in mutating route (LOG-001..LOG-013) | 13 | 10 min | ~2.2 hr |
| Downgrade level / fix exc_info / fix flood (LOG-014..LOG-046) | 33 | 10 min | ~5.5 hr |
| P2 polish — message wording, prefix consistency, unused `_log` removal | 26 | 8 min | ~3.5 hr |
| Cross-cutting: request_id middleware + Filter (rec. A) | 1 | 1.5 hr | 1.5 hr |
| Cross-cutting: `web/lib/audit.py` helper (rec. B) | 1 | 1 hr | 1 hr |
| Cross-cutting: env-driven log config + JSON option (rec. C, LOG-048..LOG-051) | 1 | 1.5 hr | 1.5 hr |
| **Total** | **74** | | **~15 hr** |

Three sessions of ~5 hours each: P0 sweep (audit-trail), P1 sweep (level fixes + context), P2 polish + cross-cutting infra.
