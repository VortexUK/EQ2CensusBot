"""POST /parses/ingest — ACT-plugin upload + HMAC validation + snapshot resolve.

Carved out of the original 1687-line web/routes/parses.py. HMAC validation
+ regression tests live here. The Pydantic ingest models live in models.py
so they can be type-imported without dragging the helpers along.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import time

from fastapi import BackgroundTasks, HTTPException, Request

from census.client import CensusClient
from parses import db as parses_db
from parses.models import (
    AttackType,
    Combatant,
    CombatantSnapshot,
    DamageType,
    Encounter,
    _to_bool_tf,
    _to_float,
    _to_int,
    _to_perc,
    _to_str_or_none,
    _to_ts,
)
from web.auth_deps import require_user_session_or_token
from web.cache import character_cache
from web.config import ALLOWED_SERVERS as _ALLOWED_SERVERS
from web.config import SERVICE_ID as _SERVICE_ID
from web.config import WORLD as _WORLD
from web.limiter import limiter
from web.routes.parses import router
from web.routes.parses.models import (
    IngestEncounter,
    IngestRequest,
    IngestResponse,
)

_log = logging.getLogger(__name__)

# Pre-lowered comparison set so each ingest doesn't redo the work.
# Computed at module import — env changes need a process restart, same
# as ADMIN_DISCORD_IDS. ALLOWED_SERVERS itself stays in its original
# casing for display in /auth/whoami responses.
_ALLOWED_SERVERS_LOWER: frozenset[str] = frozenset(s.lower() for s in _ALLOWED_SERVERS)

# EQ2 server names are a small known set with a predictable shape —
# letters, digits, spaces, apostrophes, hyphens. Match conservatively
# and fall back to EQ2_WORLD when the plugin sends garbage. Caps at
# 30 chars to match the Pydantic max_length on logger_server.
_VALID_WORLD_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 '_-]{0,30}$")

# EQ2 character names are letters only, max 15 characters per
# Daybreak's naming rules. Validate on ingest as defence-in-depth
# on top of the Pydantic max_length=64 cap — a hostile logger_name
# containing ':' would otherwise collide character_cache entries
# (the keys are shaped `name.lower():world.lower()` throughout the
# app). Constraining to the real EQ2 shape also keeps weird
# payloads out of Census API URLs and the parses DB.
_VALID_CHARACTER_NAME_RE = re.compile(r"^[A-Za-z]{1,15}$")


def _sanitize_world(world: str | None) -> str | None:
    """Return the world name if it matches the conservative shape we
    expect for an EQ2 server, else None so the caller falls back to
    the EQ2_WORLD env-var default. Defence-in-depth on top of the
    Pydantic max_length=64 cap — keeps obvious injection shapes
    (paths, query strings, control chars) out of Census API calls."""
    if not world:
        return None
    candidate = world.strip()
    if not candidate:
        return None
    return candidate if _VALID_WORLD_RE.match(candidate) else None


async def _resolve_uploader_guild_async(
    uploader: str,
    world: str | None = None,
) -> str | None:
    """Cache-aware guild lookup for the upload path. Order of attempts:

      1. character_cache hit on the uploader's character → return its
         guild_name (zero Census traffic).
      2. Miss → single-character Census call via get_character_guild_name
         to learn the guild name for this upload.
      3. If we learned a guild, fire-and-forget _fetch_and_cache_guild()
         to pull the full roster into character_cache so the rest of the
         raid hits step 1. Thundering-herd guard inside the helper
         dedupes concurrent prewarms for the same guild.

    ``world`` overrides the EQ2_WORLD env-var default — the plugin
    (v0.1.10+) detects the server from its log file path and stamps it
    on each upload. Empty/None → fall back to the configured default
    so older plugin versions and the local-ingest path keep working.
    Sanitised via _sanitize_world; anything that doesn't match the
    expected shape also falls back rather than feeding garbage into
    a Census API URL.

    Returns None for: uploader='local', Census error, character not found,
    or character is unguilded — callers store guild_name as NULL in all
    those cases.
    """
    if not uploader or uploader == "local":
        return None

    effective_world = _sanitize_world(world) or _WORLD
    world_lower = effective_world.lower()
    # Delimiter stays as ":" to keep cache keys compatible with the
    # rest of the app (characters.py, character.py, guild.py prewarm,
    # etc.). Collision-via-world is blocked by _sanitize_world above;
    # collision-via-name is blocked by the EQ2-name regex applied to
    # logger_name on the way in to the ingest route.
    cache_key = f"{uploader.lower()}:{world_lower}"
    cached, _ = character_cache.get_stale(cache_key)
    if cached is not None:
        return getattr(cached, "guild_name", None) or None

    # CENSUS-CLIENT-LIFECYCLE: migrate to web.lib.census_lifecycle.shared_census_client (Phase 2c.2)
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        guild_name = await client.get_character_guild_name(uploader, effective_world)
    except Exception as exc:
        _log.warning("Census guild lookup failed for %r: %s", uploader, exc)
        return None
    finally:
        await client.close()

    if not guild_name:
        return None

    # Background full-guild fetch — populates character_cache for every
    # member, so subsequent raid uploads from the same guild are
    # zero-Census. We don't await it; the encounter ingest can proceed
    # while the roster pre-warm runs.
    asyncio.create_task(_prewarm_guild_silently(guild_name))
    return guild_name


async def _prewarm_guild_silently(guild_name: str) -> None:
    """Background roster pre-warm used by _resolve_uploader_guild_async.
    Imports lazily to dodge the web.routes.guild ↔ web.routes.parses
    circular dependency, and never raises — pre-warm failure must not
    affect ingest success."""
    try:
        from web.guild_cache import _fetch_and_cache_guild  # noqa: PLC0415

        await _fetch_and_cache_guild(guild_name)
    except Exception as exc:
        _log.debug("Background guild prewarm failed for %s: %s", guild_name, exc)


async def _resolve_combatant_snapshots(
    names: list[str],
    world: str | None = None,
) -> dict[str, CombatantSnapshot]:
    """Freeze each named player's identity (level / guild / class) at ingest
    time, reusing the website's character_cache.

    Per-name strategy, in order:
      1. character_cache hit → snapshot it (zero Census traffic).
      2. Miss → one Census call (get_character_guild_name) to find the
         character's guild, then *await* a full roster fetch which caches
         every guildmate. Re-check the cache for this character.

    Because a raid is overwhelmingly one guild, the first miss warms the
    whole roster, so every subsequent name is a step-1 hit — one guild
    fetch covers the parse. Unguilded players / pugs / Census errors leave
    that name absent from the result (combatant row stores NULLs).

    Never raises — snapshot resolution is best-effort and must not block a
    valid upload.
    """
    # Same sanitisation as _resolve_uploader_guild_async — a malformed
    # logger_server can't end up in a Census URL.
    effective_world = _sanitize_world(world) or _WORLD
    world_lower = effective_world.lower()
    out: dict[str, CombatantSnapshot] = {}
    client: CensusClient | None = None
    try:
        for name in names:
            cache_key = f"{name.lower()}:{world_lower}"
            cached, _ = character_cache.get_stale(cache_key)
            if cached is None:
                if client is None:
                    # CENSUS-CLIENT-LIFECYCLE: migrate to web.lib.census_lifecycle.shared_census_client (Phase 2c.2)
                    client = CensusClient(service_id=_SERVICE_ID)
                try:
                    guild_name = await client.get_character_guild_name(name, effective_world)
                except Exception as exc:
                    _log.warning("Combatant guild lookup failed for %r: %s", name, exc)
                    guild_name = None
                if guild_name:
                    # Awaited (not fire-and-forget) so the roster is warm for
                    # the remaining names. The thundering-herd guard in
                    # _fetch_and_cache_guild dedupes against the uploader's
                    # own prewarm for the same guild.
                    await _prewarm_guild_silently(guild_name)
                    cached, _ = character_cache.get_stale(cache_key)
            # The guild-roster resolve sometimes returns a member's class/level
            # but no equipment, so the cached ilvl is None even for a real
            # player. A direct character fetch returns equipment — fill the ilvl
            # so they aren't missing it on the leaderboard. Bounded: only fires
            # for resolved players still lacking an ilvl.
            if cached is not None and getattr(cached, "cls", None) and getattr(cached, "ilvl", None) is None:
                if client is None:
                    # CENSUS-CLIENT-LIFECYCLE: migrate to web.lib.census_lifecycle.shared_census_client (Phase 2c.2)
                    client = CensusClient(service_id=_SERVICE_ID)
                try:
                    char = await client.get_character(name, effective_world)
                except Exception as exc:
                    _log.warning("Combatant ilvl backfill failed for %r: %s", name, exc)
                    char = None
                if char is not None:
                    from web.routes.character import (
                        _build_char_response,  # noqa: PLC0415 — local, avoid circular import
                    )

                    resp = _build_char_response(char)
                    character_cache.set(cache_key, resp)
                    cached = resp
            if cached is not None:
                out[name] = CombatantSnapshot(
                    level=getattr(cached, "level", None),
                    guild_name=getattr(cached, "guild_name", None),
                    cls=getattr(cached, "cls", None),
                    ilvl=getattr(cached, "ilvl", None),
                )
    finally:
        if client is not None:
            await client.close()
    return out


def _cached_snapshots(names: list[str], world: str | None = None) -> dict[str, CombatantSnapshot]:
    """Cache-only snapshot lookup for the ingest response path — NO Census
    calls, so an upload can never block/time out on Census. Whatever is already
    warm in character_cache is snapshotted now; the rest is filled in by the
    background task."""
    effective_world = _sanitize_world(world) or _WORLD
    world_lower = effective_world.lower()
    out: dict[str, CombatantSnapshot] = {}
    for name in names:
        cached, _ = character_cache.get_stale(f"{name.lower()}:{world_lower}")
        if cached is not None:
            out[name] = CombatantSnapshot(
                level=getattr(cached, "level", None),
                guild_name=getattr(cached, "guild_name", None),
                cls=getattr(cached, "cls", None),
                ilvl=getattr(cached, "ilvl", None),
            )
    return out


def _update_snapshots_sync(encounter_id: int, snapshots: dict[str, CombatantSnapshot]) -> None:
    conn = parses_db.init_db(parses_db.DB_PATH)
    try:
        parses_db.update_combatant_snapshots(conn, encounter_id, snapshots)
    finally:
        conn.close()


async def _resolve_and_update_snapshots(encounter_id: int, player_names: list[str], world: str | None) -> None:
    """Background: do the full (Census-backed) snapshot resolution OFF the
    response path, then write the results onto the combatant rows. Never
    raises — best-effort enrichment."""
    try:
        snapshots = await _resolve_combatant_snapshots(player_names, world)
        if not snapshots:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _update_snapshots_sync, encounter_id, snapshots)
    except Exception as exc:
        _log.warning("Background snapshot resolution failed for encounter %s: %s", encounter_id, exc)


# Map raw ACT row dicts to our typed dataclasses — same column-name handling
# as parses/act_reader.py. Mirrors `combatant_table.class`/`damagetype_table.
# combatant`/`attacktype_table.attacker` quirks observed against real data.


def _encounter_from_payload(p: IngestEncounter) -> Encounter | None:
    started = _to_ts(p.starttime)
    ended = _to_ts(p.endtime)
    if started is None or ended is None:
        return None
    return Encounter(
        encid=p.encid,
        title=p.title or "",
        zone=_to_str_or_none(p.zone),
        started_at=started,
        ended_at=ended,
        duration_s=_to_int(p.duration),
        total_damage=_to_int(p.damage),
        encdps=_to_float(p.encdps),
        kills=_to_int(p.kills),
        deaths=_to_int(p.deaths),
        success_level=_to_int(p.success),
    )


def _combatants_from_payload(rows: list[dict], encid: str) -> list[Combatant]:
    out: list[Combatant] = []
    for r in rows:
        name = str(r.get("name") or "").strip()
        if not name:
            continue
        out.append(
            Combatant(
                encid=encid,
                name=name,
                ally=_to_bool_tf(r.get("ally")),
                started_at=_to_ts(r.get("starttime")),
                ended_at=_to_ts(r.get("endtime")),
                duration_s=_to_int(r.get("duration")),
                damage=_to_int(r.get("damage")),
                damage_perc=_to_perc(r.get("damageperc")),
                kills=_to_int(r.get("kills")),
                healed=_to_int(r.get("healed")),
                healed_perc=_to_perc(r.get("healedperc")),
                crit_heals=_to_int(r.get("critheals")),
                heals=_to_int(r.get("heals")),
                cure_dispels=_to_int(r.get("curedispels")),
                power_drain=_to_int(r.get("powerdrain")),
                power_replenish=_to_int(r.get("powerreplenish")),
                dps=_to_float(r.get("dps")),
                encdps=_to_float(r.get("encdps")),
                enchps=_to_float(r.get("enchps")),
                hits=_to_int(r.get("hits")),
                crit_hits=_to_int(r.get("crithits")),
                blocked=_to_int(r.get("blocked")),
                misses=_to_int(r.get("misses")),
                swings=_to_int(r.get("swings")),
                heals_taken=_to_int(r.get("healstaken")),
                damage_taken=_to_int(r.get("damagetaken")),
                deaths=_to_int(r.get("deaths")),
                to_hit=_to_float(r.get("tohit")),
                crit_dam_perc=_to_perc(r.get("critdamperc")),
                crit_heal_perc=_to_perc(r.get("crithealperc")),
                crit_types=_to_str_or_none(r.get("crittypes")),
                threat_str=_to_str_or_none(r.get("threatstr")),
                threat_delta=_to_int(r.get("threatdelta")),
            )
        )
    return out


def _damage_types_from_payload(rows: list[dict], encid: str) -> list[DamageType]:
    out: list[DamageType] = []
    for r in rows:
        combatant = str(r.get("combatant") or "").strip()
        damage_type = str(r.get("type") or "").strip()
        if not combatant or not damage_type:
            continue
        out.append(
            DamageType(
                encid=encid,
                combatant_name=combatant,
                grouping_label=_to_str_or_none(r.get("grouping")),
                damage_type=damage_type,
                started_at=_to_ts(r.get("starttime")),
                ended_at=_to_ts(r.get("endtime")),
                duration_s=_to_int(r.get("duration")),
                damage=_to_int(r.get("damage")),
                encdps=_to_float(r.get("encdps")),
                char_dps=_to_float(r.get("chardps")),
                dps=_to_float(r.get("dps")),
                average=_to_float(r.get("average")),
                median=_to_int(r.get("median")),
                min_hit=_to_int(r.get("minhit")),
                max_hit=_to_int(r.get("maxhit")),
                hits=_to_int(r.get("hits")),
                crit_hits=_to_int(r.get("crithits")),
                blocked=_to_int(r.get("blocked")),
                misses=_to_int(r.get("misses")),
                swings=_to_int(r.get("swings")),
                to_hit=_to_float(r.get("tohit")),
                average_delay=_to_float(r.get("averagedelay")),
                crit_perc=_to_perc(r.get("critperc")),
                crit_types=_to_str_or_none(r.get("crittypes")),
            )
        )
    return out


def _attack_types_from_payload(rows: list[dict], encid: str) -> list[AttackType]:
    """ACT writes per-combatant rollups as type='All' across various
    swingtypes — strip those (same rule as the file-based reader)."""
    out: list[AttackType] = []
    for r in rows:
        attacker = str(r.get("attacker") or "").strip()
        attack_name = str(r.get("type") or "").strip()
        if not attacker or not attack_name or attack_name == "All":
            continue
        out.append(
            AttackType(
                encid=encid,
                combatant_name=attacker,
                victim=_to_str_or_none(r.get("victim")),
                swing_type=_to_int(r.get("swingtype")),
                attack_name=attack_name,
                started_at=_to_ts(r.get("starttime")),
                ended_at=_to_ts(r.get("endtime")),
                duration_s=_to_int(r.get("duration")),
                damage=_to_int(r.get("damage")),
                encdps=_to_float(r.get("encdps")),
                char_dps=_to_float(r.get("chardps")),
                dps=_to_float(r.get("dps")),
                average=_to_float(r.get("average")),
                median=_to_int(r.get("median")),
                min_hit=_to_int(r.get("minhit")),
                max_hit=_to_int(r.get("maxhit")),
                resist=_to_str_or_none(r.get("resist")),
                hits=_to_int(r.get("hits")),
                crit_hits=_to_int(r.get("crithits")),
                blocked=_to_int(r.get("blocked")),
                misses=_to_int(r.get("misses")),
                swings=_to_int(r.get("swings")),
                to_hit=_to_float(r.get("tohit")),
                average_delay=_to_float(r.get("averagedelay")),
                crit_perc=_to_perc(r.get("critperc")),
                crit_types=_to_str_or_none(r.get("crittypes")),
            )
        )
    return out


def _ingest_payload_sync(
    payload: IngestRequest,
    uploaded_by: str,
    guild_name: str | None,
    source_dsn: str,
    snapshots: dict[str, CombatantSnapshot] | None = None,
    world: str = "Varsoon",
) -> tuple[str, int | None, int, int, int]:
    """Write the payload into parses.db. Returns (status, encounter_id,
    n_combatants, n_damage_types, n_attack_types).

    status: 'inserted' on success, 'revived' if the encid was already
    ingested but soft-deleted (re-upload un-hides it), 'skipped' if the
    encid was already ingested and still visible — the upload is
    idempotent on retries.

    ``world`` is the authoritative server name (on the HTTP path this is the
    allowlist-gated ``sanitized_server`` derived from logger_server) and is
    stored on the encounter row and in ingest_log so the same act_encid from
    two different servers are distinct."""
    enc = _encounter_from_payload(payload.encounter)
    if enc is None:
        raise HTTPException(status_code=400, detail="Encounter starttime/endtime unparseable")
    combatants = _combatants_from_payload(payload.combatants, enc.encid)
    if not combatants:
        raise HTTPException(status_code=400, detail="No combatants in payload")
    damage_types = _damage_types_from_payload(payload.damage_types, enc.encid)
    attack_types = _attack_types_from_payload(payload.attack_types, enc.encid)

    conn = parses_db.init_db(parses_db.DB_PATH)
    try:
        # Idempotency: skip if this world+encid pair was already ingested.
        if parses_db.is_ingested(conn, enc.encid, world):
            existing = parses_db.find_encounter_by_act_encid(conn, enc.encid, world)
            # A re-upload of a soft-deleted (hidden) parse should bring it back,
            # not silently skip — un-hide it so it returns to the list.
            if existing and existing.get("hidden_at") is not None:
                parses_db.unhide_encounter(conn, existing["id"])
                return ("revived", existing["id"], 0, 0, 0)
            return ("skipped", existing["id"] if existing else None, 0, 0, 0)

        ingested_at = int(time.time())
        with conn:
            encounter_id = parses_db.insert_encounter(
                conn,
                enc,
                source_dsn=source_dsn,
                ingested_at=ingested_at,
                uploaded_by=uploaded_by,
                guild_name=guild_name,
                world=world,
            )
            name_to_id = parses_db.insert_combatants_bulk(conn, encounter_id, combatants, snapshots)
            n_dt = parses_db.insert_damage_types_bulk(conn, name_to_id, damage_types)
            n_at = parses_db.insert_attack_types_bulk(conn, name_to_id, attack_types)
            parses_db.mark_ingested(
                conn,
                enc.encid,
                encounter_id,
                source_dsn=source_dsn,
                ingested_at=ingested_at,
                world=world,
            )
        return ("inserted", encounter_id, len(combatants), n_dt, n_at)
    finally:
        conn.close()


# Header name shipped by the plugin (v0.1.8+). MUST match
# PayloadSigner.SignatureHeaderName in the EQ2LexiconACTPlugin repo —
# changing one side without the other breaks HMAC validation.
PLUGIN_SIGNATURE_HEADER = "X-Lexicon-Signature"


async def _validate_payload_signature(
    request: Request,
    user: dict,
) -> None:
    """HMAC-SHA256 validation of the upload body, keyed by the bearer
    token. Plugin v0.1.8+ ships this header on every upload.

    STRICT mode (flipped from opportunistic on 2026-05-25):
      * token-auth + header missing  → 401 (force plugin update)
      * token-auth + header present  → must verify; mismatch is 401
      * session-auth + header present → 400 (confused client)
      * session-auth + header absent → allowed (browser uploads, if any)

    The strict flip means v0.1.7 and older plugins now hit a clear 401
    telling them to update. The plugin's update-awareness banner (also
    introduced in v0.1.8) makes the upgrade path obvious in the UI.

    Threat model: see PayloadSigner.cs in the plugin repo. Short version
    — this stops payload tampering in flight; it does NOT prevent the
    legitimate token holder from signing whatever JSON they want (they
    have the key). Real integrity comes from server-side sanity checks
    on top of this.
    """
    sig_header = request.headers.get(PLUGIN_SIGNATURE_HEADER)

    # Session-cookie auth doesn't have a token-style HMAC key. Skip the
    # whole validation path for browsers, but reject explicitly if a
    # session client somehow sends the header (confused client > silent
    # accept).
    if user.get("auth_source") != "token":
        if sig_header:
            raise HTTPException(
                status_code=400,
                detail=f"{PLUGIN_SIGNATURE_HEADER} is only valid for token-authenticated requests.",
            )
        return

    # Token auth from here on — header is required.
    if not sig_header:
        raise HTTPException(
            status_code=401,
            detail=(
                f"{PLUGIN_SIGNATURE_HEADER} is required for plugin uploads. "
                "Update the EQ2 Lexicon ACT plugin to v0.1.8 or later: "
                "https://github.com/VortexUK/EQ2LexiconACTPlugin/releases/latest"
            ),
        )

    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        # Defensive — require_user_session_or_token already verified
        # bearer presence on the token path. If we reach here without
        # one, something has gone very wrong upstream.
        raise HTTPException(
            status_code=401,
            detail="Missing bearer token for signature validation.",
        )
    raw_token = auth_header[len("Bearer ") :].strip()

    # Request.body() is cached after FastAPI's body-injection consumes it
    # to build `body: IngestRequest`, so re-reading here is free.
    #
    # ASSUMPTION: no middleware between this handler and the body-injection
    # mutates or re-emits the body in a way that breaks the cache. Adding
    # such a middleware will silently break every plugin upload. The
    # regression test in tests/web/test_parses_ingest_hmac.py pins this
    # behaviour against a no-op body-reading middleware — if you add a
    # middleware that rewrites the body (gzip decode, JSON normaliser,
    # etc.), extend that test to cover the new middleware before shipping.
    body_bytes = await request.body()
    expected = hmac.new(
        raw_token.encode("utf-8"),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, sig_header.strip().lower()):
        raise HTTPException(
            status_code=401,
            detail=f"{PLUGIN_SIGNATURE_HEADER} does not match payload.",
        )


@router.post("/parses/ingest", response_model=IngestResponse, status_code=201)
@limiter.limit("60/minute")
async def ingest_parse(
    request: Request,
    body: IngestRequest,
    background: BackgroundTasks,
) -> IngestResponse:
    user = await require_user_session_or_token(request)
    await _validate_payload_signature(request, user)

    # Trust the plugin's logger_name (it reads ActGlobals.charName) and
    # use it as the uploader identifier on the encounter row. The session/
    # token user_id is what we'd surface for "who uploaded this" if/when
    # we add an uploader-by-user-id column in Phase 3+.
    uploader = body.logger_name.strip()
    if not uploader:
        raise HTTPException(status_code=400, detail="logger_name must not be empty")
    # EQ2 character names are letters only, 1-15 chars. Reject
    # anything else — keeps malformed payloads out of Census API
    # URLs, parses-DB rows, and prevents the ":"-injection cache-
    # collision path called out in the v0.1.13 audit (M4).
    if not _VALID_CHARACTER_NAME_RE.match(uploader):
        raise HTTPException(
            status_code=400,
            detail="logger_name must be 1-15 letters (the EQ2 character-name shape).",
        )

    # Server allowlist gate — strict mode.
    #
    # The plugin stamps logger_server from the active ACT log path
    # (v0.1.10+). Pre-v0.1.10 builds didn't send the field at all and
    # any plugin more than two minor versions behind the latest release
    # has been blocked client-side by the version gate, plus rejected
    # server-side by the X-Lexicon-Signature strict check since
    # 2026-05-25. So any payload that lands here without logger_server
    # is effectively a misconfigured client we want to surface, not a
    # legitimate request to silently fall back to EQ2_WORLD.
    #
    # Three rejection cases, ordered from most-actionable-for-user to
    # least:
    #   1. logger_server missing/empty   → 400, "update your plugin"
    #   2. logger_server malformed shape → 400, "logger_server is bad"
    #   3. logger_server not in allow set → 403, with the allowed list
    raw_server = (body.logger_server or "").strip()
    if not raw_server:
        raise HTTPException(
            status_code=400,
            detail="logger_server is required. Please update the EQ2 Lexicon ACT plugin to v0.1.14 or later.",
        )
    sanitized_server = _sanitize_world(raw_server)
    if sanitized_server is None:
        raise HTTPException(
            status_code=400,
            detail=f"logger_server '{raw_server}' is malformed.",
        )
    if sanitized_server.lower() not in _ALLOWED_SERVERS_LOWER:
        # Sort the allowed list so the error message renders
        # deterministically — same display order as /auth/whoami.
        raise HTTPException(
            status_code=403,
            detail=(
                f"Server '{sanitized_server}' is not on the allowed list. "
                f"Allowed: {', '.join(sorted(_ALLOWED_SERVERS))}."
            ),
        )

    # After the strict gate, sanitized_server is a guaranteed-valid,
    # allowlisted server name (Varsoon/Wuoshi) — and those ARE registry
    # worlds — so it is the authoritative `world` we persist this parse
    # under. The gate has already established a concrete world, so there is
    # no current_world() fallback to fall through to on this HTTP path.
    parse_world = sanitized_server

    # Cache-aware guild resolve: hits character_cache first; on miss does a
    # one-character Census call and pre-warms the full roster in the
    # background so the rest of the raid's uploads are zero-Census.
    # logger_server (plugin v0.1.10+) overrides EQ2_WORLD when present —
    # enables a Varsoon-configured deployment to correctly resolve a
    # Wuoshi upload, for instance. After the strict gate above the value is
    # guaranteed valid; _resolve_uploader_guild_async re-sanitises it
    # defensively and that fallback is now only reachable from the
    # local-ingest pipeline.
    guild_name = await _resolve_uploader_guild_async(uploader, body.logger_server)

    # Freeze each player ally's level/guild/class at ingest. Restricted to
    # player-like names (single-word ally, not the 'Unknown' rollup) so we
    # never burn Census calls on pets/NPCs that don't exist as characters.
    player_names = [
        name
        for r in body.combatants
        if _to_bool_tf(r.get("ally"))
        and (name := str(r.get("name") or "").strip())
        and " " not in name
        and name != "Unknown"
    ]
    # Cache-only on the response path — NEVER hit Census here, or a cold-cache
    # raid upload (up to N serial 30 s Census calls) would time the plugin out.
    # Whatever's already warm in character_cache is frozen now; the rest is
    # resolved by a background task that updates the combatant rows after the
    # response has already gone out.
    snapshots = _cached_snapshots(player_names, body.logger_server)

    loop = asyncio.get_event_loop()

    status, encounter_id, n_c, n_dt, n_at = await loop.run_in_executor(
        None,
        _ingest_payload_sync,
        body,
        uploader,
        guild_name,
        f"plugin:{user['id']}",  # source_dsn marks the auth path
        snapshots,
        parse_world,
    )

    # Schedule the full (Census-backed) resolution off the response path. For
    # freshly-inserted parses, and for revived ones (so the brought-back parse
    # re-resolves its players against the now-warmer cache). Skipped rows
    # already have their snapshots, and an empty name list has nothing to do.
    if status in ("inserted", "revived") and encounter_id is not None and player_names:
        background.add_task(_resolve_and_update_snapshots, encounter_id, player_names, body.logger_server)

    return IngestResponse(
        status=status,
        encounter_id=encounter_id,
        act_encid=body.encounter.encid,
        combatants=n_c,
        damage_types=n_dt,
        attack_types=n_at,
        guild_name=guild_name,
    )
