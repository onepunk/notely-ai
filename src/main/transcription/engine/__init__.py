"""
Transcription engine module - faster-whisper implementation

DEPRECATED: This module is deprecated in favor of the new backends package.

The new backends package (src/main/transcription/backends/) provides:
- Unified interface for multiple GPU platforms (NVIDIA CUDA, Apple Silicon MLX)
- No CPU fallback (GPU required for real-time performance)
- Cleaner factory pattern for backend creation

Migration:
    # Old (deprecated):
    from engine import FasterWhisperEngine
    engine = FasterWhisperEngine()
    engine.load_model("small.en")
    result = engine.transcribe(audio)

    # New (recommended):
    from backends import create_backend
    backend = create_backend("auto")  # or "nvidia" / "apple"
    backend.load_model("small.en")
    result = backend.transcribe(audio)

This module is kept for reference and backward compatibility with existing code
that hasn't migrated yet. New code should use the backends package.
"""

import warnings

# Emit deprecation warning on import
warnings.warn(
    "The 'engine' module is deprecated. Use 'backends' module instead. "
    "See module docstring for migration guide.",
    DeprecationWarning,
    stacklevel=2,
)

from .faster_whisper_engine import FasterWhisperEngine
from .types import TranscriptionConfig, TranscriptionResult
from .metrics import track_latency, LatencyTracker

__all__ = [
    "FasterWhisperEngine",
    "TranscriptionConfig",
    "TranscriptionResult",
    "track_latency",
    "LatencyTracker",
]
