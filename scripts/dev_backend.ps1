Set-Location E:\git\EQ2Lexicon
# --reload-dir: watch only code dirs so writes to data/ (SQLite WAL files,
#   downloaded icons, etc.) don't churn the watcher.
# --timeout-graceful-shutdown 2: background tasks (prewarm cache,
#   census health poll loop) aren't tracked for cancellation, so uvicorn
#   waits forever on shutdown without this. 2s graceful then force-kill →
#   reload cycle completes in seconds instead of hanging.
uv run uvicorn web.app:app --port 8000 --reload `
  --reload-dir web --reload-dir census --reload-dir parses --reload-dir bot `
  --timeout-graceful-shutdown 2
