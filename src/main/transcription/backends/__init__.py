"""
Transcription backends for GPU-accelerated Whisper inference.

This module provides a unified interface for transcription across different
GPU platforms (NVIDIA CUDA, Apple Silicon MLX).

Usage:
    from backends import create_backend

    # Auto-detect GPU platform
    backend = create_backend("auto")
    backend.load_model("small.en")
    result = backend.transcribe(audio_array)
    print(result.text)

    # Or force a specific backend
    backend = create_backend("nvidia")

Available Backends:
    - FasterWhisperBackend: NVIDIA CUDA using faster-whisper
    - MLXWhisperBackend: Apple Silicon using MLX (stub in Phase 1)
"""

from .base import (
    TranscriptionBackend,
    TranscriptionConfig,
    TranscriptionSegment,
    TranscriptionResult,
    DeviceInfo,
)
from .factory import create_backend, get_available_backends, BackendType
from .exceptions import (
    TranscriptionBackendError,
    NoCompatibleGPUError,
    ModelLoadError,
    TranscriptionError,
    BackendNotImplementedError,
)

# Concrete backends - import on demand to avoid unnecessary dependencies
# from .faster_whisper import FasterWhisperBackend
# from .mlx_whisper import MLXWhisperBackend

__all__ = [
    # Factory
    "create_backend",
    "get_available_backends",
    "BackendType",
    # Base classes and types
    "TranscriptionBackend",
    "TranscriptionConfig",
    "TranscriptionSegment",
    "TranscriptionResult",
    "DeviceInfo",
    # Exceptions
    "TranscriptionBackendError",
    "NoCompatibleGPUError",
    "ModelLoadError",
    "TranscriptionError",
    "BackendNotImplementedError",
]
