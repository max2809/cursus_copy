import asyncio
import typer
from studybuddy.cli.commands import invite_email
from studybuddy.db.base import AsyncSessionLocal


app = typer.Typer(help="Cursus admin CLI")


@app.command()
def invite(email: str):
    """Add an email to the allowlist so they can request a magic link."""
    async def _run():
        async with AsyncSessionLocal() as db:
            await invite_email(db, email)
            await db.commit()
    asyncio.run(_run())
    typer.echo(f"Invited: {email}")


if __name__ == "__main__":
    app()
