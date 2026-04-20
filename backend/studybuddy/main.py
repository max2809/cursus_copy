import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from studybuddy.config import get_settings

logger = logging.getLogger("studybuddy.debug")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


def create_app() -> FastAPI:
    from studybuddy.auth.routes import router as auth_router
    from studybuddy.api.onboarding import router as onboarding_router
    from studybuddy.api.deadlines import router as deadlines_router
    from studybuddy.api.sync_route import router as sync_router
    from studybuddy.api.courses import router as courses_router
    from studybuddy.api.materials import router as materials_router
    from studybuddy.api.chat_sessions import router as chat_sessions_router
    from studybuddy.api.chat_messages import router as chat_messages_router

    settings = get_settings()
    app = FastAPI(title="Cursus", version="0.1.0", lifespan=lifespan)
    origins = [o.strip() for o in settings.frontend_origin.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(onboarding_router)
    app.include_router(deadlines_router)
    app.include_router(sync_router)
    app.include_router(courses_router)
    app.include_router(materials_router)
    app.include_router(chat_sessions_router)
    app.include_router(chat_messages_router)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.exception_handler(RequestValidationError)
    async def log_422(request: Request, exc: RequestValidationError):
        logger.error("422 on %s %s | ct=%s | errors=%s",
                     request.method, request.url.path,
                     request.headers.get("content-type"), exc.errors())
        # Use FastAPI's jsonable_encoder so bytes values in the error payload
        # don't blow up json.dumps.
        from fastapi.encoders import jsonable_encoder
        return JSONResponse({"detail": jsonable_encoder(exc.errors())}, status_code=422)

    return app


app = create_app()
