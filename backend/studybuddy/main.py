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

    @app.get("/health")
    async def health():
        return {"ok": True}

    return app


app = create_app()
