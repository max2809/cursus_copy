from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from studybuddy.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


def create_app() -> FastAPI:
    from studybuddy.auth.routes import router as auth_router
    from studybuddy.api.onboarding import router as onboarding_router
    from studybuddy.api.deadlines import router as deadlines_router
    from studybuddy.api.sync_route import router as sync_router
    from studybuddy.api.materials import router as materials_router
    from studybuddy.api.chat_sessions import router as chat_sessions_router
    from studybuddy.api.chat_messages import router as chat_messages_router

    settings = get_settings()
    app = FastAPI(title="Study Buddy", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(onboarding_router)
    app.include_router(deadlines_router)
    app.include_router(sync_router)
    app.include_router(materials_router)
    app.include_router(chat_sessions_router)
    app.include_router(chat_messages_router)

    @app.get("/health")
    async def health():
        return {"ok": True}

    return app


app = create_app()
