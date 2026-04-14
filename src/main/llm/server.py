#!/usr/bin/env python3
"""
Notely Standalone LLM Server

FastAPI server for local LLM inference in the Notely Standalone edition.
Manages model loading/unloading and provides endpoints for summary generation.

Usage:
    python server.py [--port PORT] [--host HOST]

Environment variables:
    LLM_SERVER_PORT: Server port (default: 8766)
    LLM_SERVER_HOST: Server host (default: 127.0.0.1)
    LLM_DEBUG_DIR: Directory for debug output
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from backends.llamacpp_backend import LlamaCppBackend, GenerationConfig
from chunking_pipeline import ChunkingPipeline, PipelineConfig, create_pipeline

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

class ServerState:
    """Global server state for model and pipeline management."""

    def __init__(self):
        self.backend: Optional[LlamaCppBackend] = None
        self.pipeline: Optional[ChunkingPipeline] = None
        self.model_path: Optional[str] = None
        self.model_info: Dict[str, Any] = {}
        self.load_time: Optional[float] = None
        self.generation_count: int = 0

    def is_model_loaded(self) -> bool:
        return self.backend is not None and self.backend.is_loaded()


state = ServerState()


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class LoadModelRequest(BaseModel):
    """Request to load a model."""
    model_path: str = Field(..., description="Path to the GGUF model file")
    n_gpu_layers: int = Field(-1, description="GPU layers to offload (-1 for all)")
    n_ctx: int = Field(4096, description="Context window size")
    n_threads: Optional[int] = Field(None, description="CPU threads (None for auto)")


class LoadModelResponse(BaseModel):
    """Response after loading a model."""
    status: str
    model_path: str
    load_time_seconds: float
    context_length: int


class UnloadModelResponse(BaseModel):
    """Response after unloading a model."""
    status: str


class GenerateRequest(BaseModel):
    """Request to generate a summary."""
    text: str = Field(..., description="Transcript text to analyze")
    analysis_type: str = Field("full", description="Type of analysis")
    skip_refinement: bool = Field(False, description="Skip refinement pass")
    system_prompt: Optional[str] = Field(None, description="Custom system prompt override")
    prompt_templates: Optional[Dict[str, str]] = Field(None, description="Custom prompt templates override")
    temperature_extract: Optional[float] = Field(None, description="Temperature for extraction pass")
    temperature_refine: Optional[float] = Field(None, description="Temperature for refinement pass")
    top_p: Optional[float] = Field(None, description="Top-P sampling threshold")
    max_tokens: Optional[int] = Field(None, description="Maximum completion tokens")


class GenerateResponse(BaseModel):
    """Response containing generated summary."""
    result: Dict[str, Any]
    result_is_text: bool
    analysis_type: str
    backend: str
    timestamp: float
    generation_time_seconds: float


class SimpleGenerateRequest(BaseModel):
    """Request for simple text generation (non-pipeline)."""
    prompt: str = Field(..., description="Prompt for generation")
    max_tokens: int = Field(900, description="Maximum tokens to generate")
    temperature: float = Field(0.7, description="Generation temperature")
    top_p: float = Field(0.9, description="Top-p sampling")
    stop_sequences: Optional[List[str]] = Field(None, description="Stop sequences")


class SimpleGenerateResponse(BaseModel):
    """Response for simple generation."""
    text: str
    generation_time_seconds: float


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model_loaded: bool
    model_path: Optional[str]
    context_length: Optional[int]
    generation_count: int
    uptime_seconds: float


class ModelInfoResponse(BaseModel):
    """Model information response."""
    loaded: bool
    model_path: Optional[str]
    n_gpu_layers: Optional[int]
    n_ctx: Optional[int]
    load_time_seconds: Optional[float]
    generation_count: int


class GPUStatusResponse(BaseModel):
    """GPU availability status."""
    gpu_available: bool
    detail: str


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------

startup_time: float = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager.

    Uvicorn handles SIGTERM/SIGINT natively and triggers this lifespan
    context manager's cleanup path, so no custom signal handlers are needed.
    """
    global startup_time
    startup_time = time.time()
    logger.info("LLM Server starting up")

    yield

    # Cleanup on shutdown — runs when uvicorn receives SIGTERM/SIGINT
    logger.info("LLM Server shutting down")
    if state.backend:
        state.backend.unload()
    logger.info("LLM Server shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Notely LLM Server",
    description="Local LLM inference server for Notely Standalone",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        model_loaded=state.is_model_loaded(),
        model_path=state.model_path,
        context_length=state.backend.get_context_length() if state.backend else None,
        generation_count=state.generation_count,
        uptime_seconds=time.time() - startup_time,
    )


@app.get("/model/info", response_model=ModelInfoResponse)
async def model_info():
    """Get information about the currently loaded model."""
    if not state.backend:
        return ModelInfoResponse(
            loaded=False,
            model_path=None,
            n_gpu_layers=None,
            n_ctx=None,
            load_time_seconds=None,
            generation_count=state.generation_count,
        )

    info = state.backend.get_model_info()
    return ModelInfoResponse(
        loaded=info["loaded"],
        model_path=info["model_path"],
        n_gpu_layers=info["n_gpu_layers"],
        n_ctx=info["n_ctx"],
        load_time_seconds=state.load_time,
        generation_count=state.generation_count,
    )


@app.get("/gpu-status", response_model=GPUStatusResponse)
async def gpu_status():
    """Check whether the llama-cpp-python build supports GPU offload."""
    available = LlamaCppBackend.check_gpu_available()
    if available:
        import platform
        if platform.system() == "Darwin":
            detail = "Metal backend available"
        else:
            detail = "CUDA backend available"
    else:
        detail = "No GPU backend — llama-cpp-python was built without GPU support"
    return GPUStatusResponse(gpu_available=available, detail=detail)


@app.post("/load", response_model=LoadModelResponse)
async def load_model(request: LoadModelRequest):
    """Load a model from disk."""
    logger.info(f"Loading model from {request.model_path}")

    # Validate model path
    if not os.path.exists(request.model_path):
        raise HTTPException(404, f"Model file not found: {request.model_path}")

    # Unload existing model if any
    if state.backend:
        logger.info("Unloading existing model")
        state.backend.unload()
        state.backend = None
        state.pipeline = None

    # Load new model
    start_time = time.time()
    try:
        state.backend = LlamaCppBackend(
            model_path=request.model_path,
            n_gpu_layers=request.n_gpu_layers,
            n_ctx=request.n_ctx,
            n_threads=request.n_threads,
        )

        # Create pipeline with the backend
        debug_dir = os.environ.get("LLM_DEBUG_DIR")

        config = PipelineConfig(
            context_limit=request.n_ctx,
            debug_dir=Path(debug_dir) if debug_dir else None,
        )

        state.pipeline = create_pipeline(
            backend=state.backend,
            config=config,
        )

        load_time = time.time() - start_time
        state.model_path = request.model_path
        state.load_time = load_time
        state.generation_count = 0

        logger.info(f"Model loaded in {load_time:.2f}s")

        return LoadModelResponse(
            status="loaded",
            model_path=request.model_path,
            load_time_seconds=load_time,
            context_length=state.backend.get_context_length(),
        )

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        state.backend = None
        state.pipeline = None
        raise HTTPException(500, f"Failed to load model: {str(e)}")


@app.post("/unload", response_model=UnloadModelResponse)
async def unload_model():
    """Unload the current model and free resources."""
    if state.backend:
        logger.info("Unloading model")
        state.backend.unload()
        state.backend = None
        state.pipeline = None
        state.model_path = None
        state.load_time = None
        return UnloadModelResponse(status="unloaded")
    else:
        return UnloadModelResponse(status="no_model_loaded")


@app.post("/generate", response_model=GenerateResponse)
async def generate_summary(request: GenerateRequest):
    """Generate a structured summary from transcript text."""
    if not state.pipeline:
        raise HTTPException(400, "No model loaded. Call /load first.")

    if not request.text or not request.text.strip():
        raise HTTPException(400, "Text is required")

    logger.info(f"Generating summary for {len(request.text)} chars")
    start_time = time.time()

    try:
        result = state.pipeline.process(
            text=request.text,
            analysis_type=request.analysis_type,
            skip_refinement=request.skip_refinement,
            system_prompt=request.system_prompt,
            prompt_templates=request.prompt_templates,
            temperature_extract=request.temperature_extract,
            temperature_refine=request.temperature_refine,
            top_p=request.top_p,
            max_tokens=request.max_tokens,
        )

        generation_time = time.time() - start_time
        state.generation_count += 1

        logger.info(f"Summary generated in {generation_time:.2f}s")

        return GenerateResponse(
            result=result["result"],
            result_is_text=result["result_is_text"],
            analysis_type=result["analysis_type"],
            backend=result["backend"],
            timestamp=result["timestamp"],
            generation_time_seconds=generation_time,
        )

    except Exception as e:
        logger.error(f"Generation failed: {e}")
        raise HTTPException(500, f"Generation failed: {str(e)}")


@app.post("/generate/simple", response_model=SimpleGenerateResponse)
async def generate_simple(request: SimpleGenerateRequest):
    """Simple text generation without the chunking pipeline."""
    if not state.backend:
        raise HTTPException(400, "No model loaded. Call /load first.")

    if not request.prompt or not request.prompt.strip():
        raise HTTPException(400, "Prompt is required")

    start_time = time.time()

    try:
        config = GenerationConfig(
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            stop_sequences=request.stop_sequences,
        )

        text = state.backend.generate(request.prompt, config)
        generation_time = time.time() - start_time
        state.generation_count += 1

        return SimpleGenerateResponse(
            text=text,
            generation_time_seconds=generation_time,
        )

    except Exception as e:
        logger.error(f"Simple generation failed: {e}")
        raise HTTPException(500, f"Generation failed: {str(e)}")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main():
    """Main entry point for the server."""
    parser = argparse.ArgumentParser(description="Notely LLM Server")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("LLM_SERVER_PORT", "8766")),
        help="Server port (default: 8766)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=os.environ.get("LLM_SERVER_HOST", "127.0.0.1"),
        help="Server host (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development",
    )

    args = parser.parse_args()

    logger.info(f"Starting LLM server on {args.host}:{args.port}")

    # Pass `app` object directly (not "server:app" string) for Nuitka compatibility.
    # Nuitka compiles server.py as __main__, so "server" is not importable at runtime.
    # Note: reload=True requires a string reference, so it's only used in dev mode.
    if args.reload:
        uvicorn.run(
            "server:app",
            host=args.host,
            port=args.port,
            reload=True,
            log_level="info",
        )
    else:
        uvicorn.run(
            app,
            host=args.host,
            port=args.port,
            log_level="info",
        )


if __name__ == "__main__":
    main()
