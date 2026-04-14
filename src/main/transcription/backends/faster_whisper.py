"""
NVIDIA CUDA transcription backend using faster-whisper.

This backend uses the faster-whisper library with CTranslate2 for
GPU-accelerated Whisper inference on NVIDIA GPUs.

Requirements:
- NVIDIA GPU with CUDA support
- cuDNN installed and configured
- faster-whisper package

CPU fallback is NOT supported. If no CUDA device is available,
NoCompatibleGPUError is raised.
"""

import gc
import os
import sys
import logging
from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np

from .base import (
    TranscriptionBackend,
    TranscriptionConfig,
    TranscriptionSegment,
    TranscriptionResult,
    DeviceInfo,
)
from .exceptions import NoCompatibleGPUError, ModelLoadError, TranscriptionError


logger = logging.getLogger(__name__)


class FasterWhisperBackend(TranscriptionBackend):
    """
    NVIDIA CUDA transcription backend using faster-whisper.

    Uses float16 compute type for optimal GPU performance.
    Does NOT fall back to CPU - raises NoCompatibleGPUError if CUDA unavailable.
    """

    def __init__(self, config: Optional[TranscriptionConfig] = None):
        """
        Initialize the faster-whisper backend.

        Args:
            config: Optional transcription configuration.

        Raises:
            NoCompatibleGPUError: If CUDA or cuDNN is not available.
        """
        self.config = config or TranscriptionConfig()
        self._model = None
        self._model_name: Optional[str] = None
        self._device_info: Optional[DeviceInfo] = None

        # Verify CUDA availability at init time
        self._verify_cuda()

    _nvidia_libs_loaded = False

    @classmethod
    def _ensure_nvidia_libs(cls) -> None:
        """
        Pre-load pip-installed NVIDIA shared libraries so CTranslate2 can
        find them at transcription time.

        pip packages like ``nvidia-cudnn-cu12`` install ``.so`` files under
        ``site-packages/nvidia/<pkg>/lib/`` but never add those directories
        to ``LD_LIBRARY_PATH``.  Setting the env var at runtime does NOT
        help because glibc caches it on the first ``dlopen()`` call (which
        happens long before this code runs, e.g. when importing torch).

        Instead, we explicitly load the libraries via ``ctypes.CDLL`` with
        ``RTLD_GLOBAL`` so they are visible to all subsequent ``dlopen()``
        calls made by CTranslate2.
        """
        if cls._nvidia_libs_loaded:
            return

        try:
            import nvidia
            nvidia_base = Path(nvidia.__path__[0])
        except (ImportError, IndexError, Exception):
            return

        import ctypes

        # Libraries CTranslate2 needs, in dependency order.
        # Each entry is (package_dir, glob pattern).
        lib_specs = [
            ("cublas", "libcublas.so*"),
            ("cublas", "libcublasLt.so*"),
            ("cuda_runtime", "libcudart.so*"),
            ("cudnn", "libcudnn.so*"),
            ("cudnn", "libcudnn_ops.so*"),
            ("cudnn", "libcudnn_cnn.so*"),
            ("cudnn", "libcudnn_adv.so*"),
            ("cudnn", "libcudnn_graph.so*"),
            ("cudnn", "libcudnn_engines_precompiled.so*"),
            ("cudnn", "libcudnn_engines_runtime_compiled.so*"),
            ("cudnn", "libcudnn_heuristic.so*"),
        ]

        loaded = 0
        for pkg, pattern in lib_specs:
            lib_dir = nvidia_base / pkg / "lib"
            if not lib_dir.is_dir():
                continue
            for so_file in sorted(lib_dir.glob(pattern)):
                try:
                    ctypes.CDLL(str(so_file), mode=ctypes.RTLD_GLOBAL)
                    loaded += 1
                    break  # first match per pattern is enough
                except OSError:
                    continue  # try next match

        if loaded:
            print(f"Pre-loaded {loaded} NVIDIA shared libraries from pip packages", file=sys.stderr)
            logger.info(f"Pre-loaded {loaded} NVIDIA shared libraries")

        cls._nvidia_libs_loaded = True

    def _verify_cuda(self) -> None:
        """
        Verify CUDA is available using ctranslate2 (does not require torch).

        Raises:
            NoCompatibleGPUError: If CUDA is not available.
        """
        # Pre-load pip-installed NVIDIA .so files (cuDNN, cuBLAS, etc.)
        # before CTranslate2 tries to dlopen() them.
        self._ensure_nvidia_libs()

        try:
            import ctranslate2
        except ImportError:
            raise NoCompatibleGPUError(
                "ctranslate2 is not installed. Install with: pip install ctranslate2",
                backend_type="nvidia",
            )

        cuda_count = ctranslate2.get_cuda_device_count()
        if cuda_count == 0:
            raise NoCompatibleGPUError(
                "No CUDA devices found. This backend requires an NVIDIA GPU with CUDA support.\n"
                "Troubleshooting:\n"
                "  1. Verify NVIDIA GPU is installed: nvidia-smi\n"
                "  2. Install CUDA Toolkit: https://developer.nvidia.com/cuda-downloads\n"
                "\nCPU transcription is not supported due to performance requirements.",
                backend_type="nvidia",
            )

        # Populate device info (use torch for details if available, otherwise basic info)
        device_name = f"CUDA device"
        total_memory = 0
        try:
            import torch
            if hasattr(torch, 'cuda') and torch.cuda.is_available():
                device_name = torch.cuda.get_device_name(0)
                total_memory = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
        except (ImportError, AttributeError, Exception):
            pass  # torch not available in compiled binary — use basic info

        self._device_info = DeviceInfo(
            backend_type="nvidia",
            device_name=device_name,
            device_index=0,
            total_memory_mb=total_memory,
            compute_type="float16",
        )

        print(f"CUDA backend initialized: {device_name} ({cuda_count} device(s))", file=sys.stderr, flush=True)
        logger.info(f"CUDA backend initialized: {device_name} ({cuda_count} device(s))")

    def load_model(self, model_name: str) -> None:
        """
        Load a Whisper model onto the CUDA device.

        Args:
            model_name: Name of the model (e.g., "base.en", "small.en").

        Raises:
            ModelLoadError: If the model fails to load.
        """
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise ModelLoadError(
                "faster-whisper is not installed. Install with: pip install faster-whisper",
                model_name=model_name,
            )

        # Unload existing model if different
        if self._model is not None and self._model_name != model_name:
            self.unload()

        # Skip if already loaded
        if self._model is not None and self._model_name == model_name:
            logger.info(f"Model {model_name} already loaded")
            return

        print(f"Loading model: {model_name}", file=sys.stderr, flush=True)
        print(f"  Device: cuda, Compute type: float16", file=sys.stderr, flush=True)
        logger.info(f"Loading model: {model_name} (cuda, float16)")

        try:
            self._model = WhisperModel(
                model_name,
                device="cuda",
                compute_type="float16",
            )
            self._model_name = model_name

            print(f"Model loaded: {model_name}", file=sys.stderr, flush=True)
            logger.info(f"Model loaded successfully: {model_name}")

        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            raise ModelLoadError(
                f"Failed to load model '{model_name}': {e}\n"
                "Possible causes:\n"
                "  - Invalid model name\n"
                "  - Insufficient GPU memory\n"
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
        Transcribe audio using faster-whisper on CUDA.

        Args:
            audio: Float32 numpy array, 16kHz, normalized to [-1, 1].
            language: Language code (default: config.language).
            temperature: Sampling temperature (default: config.temperature).
            beam_size: Beam search size (default: config.beam_size).
            initial_prompt: Optional prompt to prime transcription.
            vad_filter: Whether to apply VAD filtering.
            vad_parameters: VAD configuration dict.

        Returns:
            TranscriptionResult with text, segments, and language.

        Raises:
            TranscriptionError: If model not loaded or transcription fails.
        """
        if self._model is None:
            raise TranscriptionError(
                "No model loaded. Call load_model() first."
            )

        # Use config defaults where not specified
        lang = language or self.config.language
        temp = temperature if temperature is not None else self.config.temperature
        beam = beam_size if beam_size is not None else self.config.beam_size
        vad_params = vad_parameters or self.config.get_vad_parameters()
        cond_prev = condition_on_previous_text if condition_on_previous_text is not None else self.config.condition_on_previous_text
        rep_penalty = repetition_penalty if repetition_penalty is not None else self.config.repetition_penalty
        no_repeat_ng = no_repeat_ngram_size if no_repeat_ngram_size is not None else self.config.no_repeat_ngram_size

        try:
            # Call faster-whisper transcribe
            segments_gen, info = self._model.transcribe(
                audio,
                language=lang,
                temperature=temp,
                beam_size=beam,
                initial_prompt=initial_prompt,
                vad_filter=vad_filter,
                vad_parameters=vad_params,
                condition_on_previous_text=cond_prev,
                repetition_penalty=rep_penalty,
                no_repeat_ngram_size=no_repeat_ng,
            )

            # Collect segments
            segments = []
            text_parts = []

            for seg in segments_gen:
                text = seg.text.strip()
                if text:
                    segments.append(
                        TranscriptionSegment(
                            text=text,
                            start_time=seg.start,
                            end_time=seg.end,
                        )
                    )
                    text_parts.append(text)

            full_text = " ".join(text_parts)

            return TranscriptionResult(
                text=full_text,
                segments=segments,
                language=info.language,
            )

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise TranscriptionError(f"Transcription failed: {e}") from e

    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        return self._model is not None

    def unload(self) -> None:
        """Unload the model and free GPU memory."""
        if self._model is not None:
            logger.info(f"Unloading model: {self._model_name}")
            print(f"Unloading model: {self._model_name}", file=sys.stderr)

            del self._model
            self._model = None
            self._model_name = None

            # Force garbage collection
            gc.collect()

            # Clear CUDA cache (best-effort, torch may not be available)
            try:
                import torch
                if hasattr(torch, 'cuda') and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    logger.info("Cleared CUDA cache")
            except (ImportError, AttributeError, Exception):
                pass

            logger.info("Model unloaded")

    def get_backend_type(self) -> str:
        """Return 'nvidia' as the backend type."""
        return "nvidia"

    def get_device_info(self) -> DeviceInfo:
        """Get CUDA device information."""
        if self._device_info is None:
            # Re-verify CUDA to populate device info
            self._verify_cuda()
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
