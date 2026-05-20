import asyncio
import os

from dotenv import load_dotenv

load_dotenv()


async def run_bot() -> None:
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit("DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.")
    from bot.bot import EQ2Bot
    bot = EQ2Bot()
    async with bot:
        await bot.start(token)


async def run_web() -> None:
    import uvicorn
    from web.app import app
    port = int(os.getenv("PORT", "8000"))
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info",
        # Disable reload in production; enable locally via WEB_RELOAD=1
        reload=os.getenv("WEB_RELOAD", "0") == "1",
    )
    server = uvicorn.Server(config)
    await server.serve()


async def main() -> None:
    await asyncio.gather(
        run_bot(),
        run_web(),
    )


if __name__ == "__main__":
    asyncio.run(main())
