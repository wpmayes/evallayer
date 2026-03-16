from contextlib import asynccontextmanager
from dotenv import load_dotenv
import os
load_dotenv(override=False)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import suites, runs, inference


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="EvalLayer API",
    description="Backend for EvalLayer LLM evaluation framework",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://evallayer.netlify.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(suites.router, prefix="/suites", tags=["Suites"])
app.include_router(runs.router, prefix="/runs", tags=["Runs"])
app.include_router(inference.router, prefix="/inference", tags=["Inference"])