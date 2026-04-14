"""
Backend factory for creating transcription backends.

Provides auto-detection of available GPU platforms and creates
the appropriate backend instance.
"""

import platform
import sys
import logging
from typing import Optional, Literal

from .base import TranscriptionBackend, TranscriptionConfig
from .exceptions import NoCompatibleGPUError


logger = logging.getLogger(__name__)

BackendType = Literal["auto", "nvidia", "apple"]


def _detect_gpu_platform() -> str:
    """
    Detect the available GPU platform.

    Returns:
        "nvidia" if CUDA is available
        "apple" if running on Apple Silicon
        Raises NoCompatibleGPUError if no GPU available

    Raises:
        NoCompatibleGPUError: If no compatible GPU is found.
    """
    # Check for NVIDIA CUDA first (using ctranslate2 — works without torch)
    try:
        import ctranslate2

        cuda_count = ctranslate2.get_cuda_device_count()
        if cuda_count > 0:
            print(f"Auto-detected NVIDIA GPU (CUDA devices: {cuda_count})", file=sys.stderr)
            logger.info(f"Auto-detected NVIDIA GPU (CUDA devices: {cuda_count})")
            return "nvidia"
    except (ImportError, Exception) as e:
        print(f"CUDA detection via ctranslate2 failed: {e}", file=sys.stderr)
        pass  # ctranslate2 not available, check for Apple Silicon

    # Check for Apple Silicon
    system = platform.system()
    machine = platform.machine()

    if system == "Darwin" and machine in ("arm64", "aarch64"):
        try:
            import mlx.core  # noqa: F401

            print(f"Auto-detected Apple Silicon: {machine}", file=sys.stderr)
            logger.info(f"Auto-detected Apple Silicon: {machine}")
            return "apple"
        except ImportError:
            # macOS Apple Silicon but MLX not installed
            raise NoCompatibleGPUError(
                f"Apple Silicon detected ({machine}) but MLX is not installed.\n"
                "Install with: pip install mlx mlx-whisper\n"
                "\nAlternatively, if you have an NVIDIA eGPU, install PyTorch with CUDA support.",
                backend_type="apple",
            )

    # No compatible GPU found
    raise NoCompatibleGPUError(
        "No compatible GPU detected for transcription.\n"
        "\nSupported configurations:\n"
        "  - NVIDIA GPU with CUDA and cuDNN\n"
        "  - Apple Silicon Mac (M1/M2/M3) with MLX\n"
        "\nCPU transcription is not supported due to performance requirements.\n"
        "\nTroubleshooting:\n"
        "  NVIDIA: pip install torch --index-url https://download.pytorch.org/whl/cu121\n"
        "  Apple:  pip install mlx mlx-whisper (macOS 13.5+ required)",
        backend_type="unknown",
    )


def create_backend(
    backend_type: BackendType = "auto",
    config: Optional[TranscriptionConfig] = None,
) -> TranscriptionBackend:
    """
    Create a transcription backend.

    Args:
        backend_type: Type of backend to create:
            - "auto": Auto-detect available GPU platform
            - "nvidia": Force NVIDIA CUDA backend
            - "apple": Force Apple Silicon MLX backend
        config: Optional transcription configuration.

    Returns:
        TranscriptionBackend instance for the selected platform.

    Raises:
        NoCompatibleGPUError: If no compatible GPU is available.
        ValueError: If backend_type is invalid.

    Example:
        >>> backend = create_backend("auto")
        >>> backend.load_model("small.en")
        >>> result = backend.transcribe(audio_array)
        >>> print(result.text)
    """
    print(f"Creating backend: type={backend_type}", file=sys.stderr, flush=True)
    logger.info(f"Creating backend: type={backend_type}")

    # Resolve 'auto' to actual backend type
    if backend_type == "auto":
        resolved_type = _detect_gpu_platform()
    else:
        resolved_type = backend_type

    # Create the appropriate backend
    if resolved_type == "nvidia":
        from .faster_whisper import FasterWhisperBackend

        backend = FasterWhisperBackend(config)
        print(f"Backend ready: nvidia", file=sys.stderr, flush=True)
        logger.info("Created FasterWhisperBackend (NVIDIA)")
        return backend

    elif resolved_type == "apple":
        from .mlx_whisper import MLXWhisperBackend

        backend = MLXWhisperBackend(config)
        print(f"Backend ready: apple", file=sys.stderr)
        logger.info("Created MLXWhisperBackend (Apple Silicon)")
        return backend

    else:
        raise ValueError(
            f"Invalid backend_type: {backend_type}. "
            f"Valid options: 'auto', 'nvidia', 'apple'"
        )


def get_available_backends() -> dict:
    """
    Check which backends are available on this system.

    Returns:
        Dictionary with backend availability and details:
        {
            "nvidia": {"available": bool, "reason": str, "device": str|None},
            "apple": {"available": bool, "reason": str, "device": str|None},
        }
    """
    result = {
        "nvidia": {"available": False, "reason": "", "device": None},
        "apple": {"available": False, "reason": "", "device": None},
    }

    # Check NVIDIA (using ctranslate2 — works without torch)
    try:
        import ctranslate2

        cuda_count = ctranslate2.get_cuda_device_count()
        if cuda_count > 0:
            result["nvidia"]["available"] = True
            result["nvidia"]["device"] = f"CUDA ({cuda_count} device(s))"
            result["nvidia"]["reason"] = "CUDA available via ctranslate2"
        else:
            result["nvidia"]["reason"] = "No CUDA devices found"
    except ImportError:
        result["nvidia"]["reason"] = "ctranslate2 not installed"

    # Check Apple Silicon
    system = platform.system()
    machine = platform.machine()

    if system == "Darwin" and machine in ("arm64", "aarch64"):
        try:
            import mlx.core  # noqa: F401

            result["apple"]["available"] = True
            result["apple"]["device"] = f"Apple Silicon ({machine})"
            result["apple"]["reason"] = "MLX available on Apple Silicon"
        except ImportError:
            result["apple"]["reason"] = "Apple Silicon detected but MLX not installed"
    else:
        result["apple"]["reason"] = f"Not Apple Silicon (system={system}, machine={machine})"

    return result
