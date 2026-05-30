Set-Location E:\git\EQ2Lexicon
# --reload-dir: watch only code dirs so writes to data/ (SQLite WAL files,
#   downloaded icons, etc.) don't churn the watcher.
# BE-045: --timeout-graceful-shutdown 2 removed — Phase 2a.13's lifespan
#   context manager now tracks and cancels all background tasks cleanly.
uv run uvicorn web.app:app --port 8000 --reload `
  --reload-dir web --reload-dir census --reload-dir parses --reload-dir bot
