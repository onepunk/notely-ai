"""
Apple Silicon transcription backend using MLX Whisper.

Uses the mlx-whisper library for GPU-accelerated Whisper inference
on Apple Silicon via the Metal Performance Shaders (MPS) framework.

Requirements:
- macOS with Apple Silicon (M1/M2/M3/M4)
- MLX framework installed
- mlx-whisper package

CPU fallback is NOT supported. If not running on Apple Silicon,
NoCompatibleGPUError is raised.
"""

import gc
import platform
import sys
import logging
from typing import Optional, Dict, Any

import numpy as np

from .base import (
    TranscriptionBackend,
    TranscriptionConfig,
    TranscriptionSegment,
    TranscriptionResult,
    DeviceInfo,
)
from .exceptions import (
    NoCompatibleGPUError,
    ModelLoadError,
    TranscriptionError,
)


logger = logging.getLogger(__name__)

# Map standard Whisper model names to mlx-community HF repo names
_MLX_MODEL_MAP = {
    "tiny": "mlx-community/whisper-tiny",
    "tiny.en": "mlx-community/whisper-tiny.en-mlx",
    "base": "mlx-community/whisper-base-mlx",
    "base.en": "mlx-community/whisper-base.en-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "small.en": "mlx-community/whisper-small.en-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "medium.en": "mlx-community/whisper-medium.en-mlx",
    "large-v2": "mlx-community/whisper-large-v2-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


class MLXWhisperBackend(TranscriptionBackend):
    """
    Apple Silicon transcription backend using MLX Whisper.

    Uses Metal GPU acceleration via the MLX framework for fast
    on-device transcription.
    """

    def __init__(self, config: Optional[TranscriptionConfig] = None):
        """
        Initialize the MLX Whisper backend.

        Args:
            config: Optional transcription configuration.

        Raises:
            NoCompatibleGPUError: If not running on macOS with Apple Silicon.
        """
        self.config = config or TranscriptionConfig()
        self._model_repo: Optional[str] = None
        self._model_name: Optional[str] = None
        self._device_info: Optional[DeviceInfo] = None

        # Verify Apple Silicon availability at init time
        self._verify_apple_silicon()

    def _verify_apple_silicon(self) -> None:
        """
        Verify running on macOS with Apple Silicon.

        Raises:
            NoCompatibleGPUError: If not on Apple Silicon.
        """
        system = platform.system()
        machine = platform.machine()

        if system != "Darwin":
            raise NoCompatibleGPUError(
                f"MLX backend requires macOS. Current OS: {system}\n"
                "This backend is designed for Apple Silicon Macs only.\n"
                "For NVIDIA GPUs, use the 'nvidia' backend instead.",
                backend_type="apple",
            )

        if machine not in ("arm64", "aarch64"):
            raise NoCompatibleGPUError(
                f"MLX backend requires Apple Silicon (arm64). Current architecture: {machine}\n"
                "This backend only works on M1/M2/M3/M4 Macs.\n"
                "Intel Macs should use the 'nvidia' backend if a compatible GPU is available.",
                backend_type="apple",
            )

        # Check if MLX is available
        try:
            import mlx.core  # noqa: F401
        except ImportError:
            raise NoCompatibleGPUError(
                "MLX framework is not installed.\n"
                "Install with: pip install mlx mlx-whisper\n"
                "MLX requires macOS 13.5+ on Apple Silicon.",
                backend_type="apple",
            )

        # Check if mlx_whisper is available
        try:
            import mlx_whisper  # noqa: F401
        except ImportError:
            raise NoCompatibleGPUError(
                "mlx-whisper is not installed.\n"
                "Install with: pip install mlx-whisper\n",
                backend_type="apple",
            )

        # Get unified memory info
        total_memory_mb = 0
        try:
            import subprocess
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                total_memory_mb = int(result.stdout.strip()) // (1024 * 1024)
        except Exception:
            pass

        self._device_info = DeviceInfo(
            backend_type="apple",
            device_name=f"Apple Silicon ({machine})",
            device_index=0,
            total_memory_mb=total_memory_mb,
            compute_type="float16",
        )

        print(f"Apple Silicon detected: {machine}", file=sys.stderr)
        logger.info(f"Apple Silicon backend initialized: {machine}")

    def _resolve_model_repo(self, model_name: str) -> str:
        """
        Resolve a standard Whisper model name to an MLX HF repo.

        Args:
            model_name: Standard model name (e.g., "small.en") or HF repo path.

        Returns:
            HuggingFace repo path for the MLX model.
        """
        # If it already looks like a HF repo path, use as-is
        if "/" in model_name:
            return model_name

        # Map standard names to MLX community repos
        if model_name in _MLX_MODEL_MAP:
            return _MLX_MODEL_MAP[model_name]

        # Try with mlx-community prefix as fallback
        return f"mlx-community/whisper-{model_name}"

    def load_model(self, model_name: str) -> None:
        """
        Load a Whisper model for MLX inference.

        MLX Whisper loads models lazily on first transcribe() call,
        but we trigger a download here to ensure the model is cached.

        Args:
            model_name: Name of the model (e.g., "base.en", "small.en").

        Raises:
            ModelLoadError: If the model fails to load.
        """
        repo = self._resolve_model_repo(model_name)

        # Skip if already loaded with the same model
        if self._model_repo == repo and self._model_name == model_name:
            logger.info(f"Model {model_name} already loaded")
            return

        # Unload previous model
        if self._model_name is not None:
            self.unload()

        print(f"Loading MLX model: {model_name} ({repo})", file=sys.stderr, flush=True)
        logger.info(f"Loading MLX model: {model_name} ({repo})")

        try:
            # Pre-download the model weights by calling load_models
            import mlx_whisper
            mlx_whisper.load_models.load_model(repo)

            self._model_repo = repo
            self._model_name = model_name

            print(f"MLX model loaded: {model_name}", file=sys.stderr, flush=True)
            logger.info(f"MLX model loaded successfully: {model_name}")

        except Exception as e:
            logger.error(f"Failed to load MLX model {model_name}: {e}")
            raise ModelLoadError(
                f"Failed to load model '{model_name}' ({repo}): {e}\n"
                "Possible causes:\n"
                "  - Invalid model name\n"
                "  - Insufficient memory\n"
                "  - Network error downloading model",
                model_name=model_name,
            ) from e

    def transcribe(
        self,
        audio: np.ndarray,
        language: Optional[str] = None,
        temperature: Optional[float] = None,
        beam_size: Optional[int] = None,
        initial_prompt: Optional[str] = None,
        vad_filter: bool = True,
        vad_parameters: Optional[Dict[str, Any]] = None,
        condition_on_previous_text: Optional[bool] = None,
        repetition_penalty: Optional[float] = None,
        no_repeat_ngram_size: Optional[int] = None,
    ) -> TranscriptionResult:
        """
        Transcribe audio using MLX Whisper on Apple Silicon.

        Args:
            audio: Float32 numpy array, 16kHz, normalized to [-1, 1].
            language: Language code (e.g., "en"). None for auto-detection.
            temperature: Sampling temperature (0.0 for greedy).
            beam_size: Beam search size.
            initial_prompt: Optional prompt to prime transcription.
            vad_filter: Whether to apply VAD filtering (handled by server).
            vad_parameters: VAD configuration dict (handled by server).
            condition_on_previous_text: Whether to condition on previous text.
            repetition_penalty: Not directly supported by mlx_whisper (ignored).
            no_repeat_ngram_size: Not directly supported by mlx_whisper (ignored).

        Returns:
            TranscriptionResult with text, segments, and detected language.

        Raises:
            TranscriptionError: If model not loaded or transcription fails.
        """
        if self._model_repo is None:
            raise TranscriptionError(
                "No model loaded. Call load_model() first."
            )

        import mlx_whisper

        # Use config defaults where not specified
        lang = language or self.config.language
        temp = temperature if temperature is not None else self.config.temperature
        cond_prev = condition_on_previous_text if condition_on_previous_text is not None else self.config.condition_on_previous_text

        try:
            # Build decode options
            decode_options: Dict[str, Any] = {}
            if lang:
                decode_options["language"] = lang
            # NOTE: mlx-whisper does not support beam search decoding.
            # Always use greedy decoding (beam_size parameter is ignored).
            if beam_size is not None and beam_size > 1:
                logger.debug("MLX Whisper: beam_size=%d ignored (beam search not supported, using greedy)", beam_size)

            result = mlx_whisper.transcribe(
                audio,
                path_or_hf_repo=self._model_repo,
                temperature=temp,
                condition_on_previous_text=cond_prev,
                initial_prompt=initial_prompt,
                word_timestamps=False,
                verbose=None,
                **decode_options,
            )
            # Ensure MLX GPU work is fully committed before returning.
            # Critical for thread safety — without this, Metal command buffers
            # may still be in-flight when the next call begins.
            try:
                import mlx.core as mx
                mx.eval()  # Force evaluation of any lazy MLX arrays
                if hasattr(mx, "metal") and hasattr(mx.metal, "synchronize"):
                    mx.metal.synchronize()
            except Exception as sync_err:
                logger.warning(f"Metal synchronize failed: {sync_err}")

            # Parse segments from mlx_whisper result
            segments = []
            text_parts = []
            detected_language = result.get("language", lang or "en")

            for seg in result.get("segments", []):
                text = seg.get("text", "").strip()
                if text:
                    segments.append(
                        TranscriptionSegment(
                            text=text,
                            start_time=seg.get("start", 0.0),
                            end_time=seg.get("end", 0.0),
                        )
                    )
                    text_parts.append(text)

            full_text = " ".join(text_parts)

            return TranscriptionResult(
                text=full_text,
                segments=segments,
                language=detected_language,
            )

        except Exception as e:
            logger.error(f"MLX transcription failed: {e}")
            raise TranscriptionError(f"Transcription failed: {e}") from e

    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        return self._model_repo is not None

    def unload(self) -> None:
        """Unload the model and free memory."""
        if self._model_repo is not None:
            logger.info(f"Unloading model: {self._model_name}")
            self._model_repo = None
            self._model_name = None

            # Clear MLX caches
            try:
                import mlx.core as mx
                mx.metal.clear_cache()
            except Exception:
                pass

            gc.collect()
            logger.info("Model unloaded")

    def get_backend_type(self) -> str:
        """Return 'apple' as the backend type."""
        return "apple"

    def get_device_info(self) -> DeviceInfo:
        """Get Apple Silicon device information."""
        if self._device_info is None:
            self._verify_apple_silicon()
        return self._device_info

    def get_loaded_model_name(self) -> Optional[str]:
        """Get the name of the currently loaded model."""
        return self._model_name

    def __del__(self):
        """Cleanup on destruction."""
        try:
            self.unload()
        except Exception:
            pass
