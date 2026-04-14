"""
Abstract base class for transcription backends.

This module defines the interface that all transcription backends must implement,
along with common dataclasses for configuration and results.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import uuid


@dataclass
class TranscriptionConfig:
    """
    Configuration for transcription backend.

    This is the Python-side config that mirrors relevant fields from
    the TypeScript TranscriptionConfig in src/common/config.ts.
    """

    model_name: str = "base.en"
    language: str = "en"
    temperature: float = 0.0
    beam_size: int = 5

    # Hallucination prevention (inference-level)
    condition_on_previous_text: bool = False
    repetition_penalty: float = 1.0
    no_repeat_ngram_size: int = 0

    # VAD (Voice Activity Detection) configuration
    vad_enabled: bool = True
    vad_threshold: float = 0.5
    vad_min_speech_duration_ms: int = 250
    vad_min_silence_duration_ms: int = 500
    vad_speech_pad_ms: int = 400

    def get_vad_parameters(self) -> Optional[Dict[str, Any]]:
        """Get VAD parameters dict for faster-whisper."""
        if not self.vad_enabled:
            return None

        return {
            "threshold": self.vad_threshold,
            "min_speech_duration_ms": self.vad_min_speech_duration_ms,
            "min_silence_duration_ms": self.vad_min_silence_duration_ms,
            "speech_pad_ms": self.vad_speech_pad_ms,
        }


@dataclass
class TranscriptionSegment:
    """A single transcription segment with timestamps."""

    text: str
    start_time: float  # Start time in seconds
    end_time: float  # End time in seconds
    segment_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "text": self.text,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "segmentId": self.segment_id,
        }


@dataclass
class TranscriptionResult:
    """Result from a transcription operation."""

    text: str
    segments: List[TranscriptionSegment]
    language: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "text": self.text,
            "segments": [seg.to_dict() for seg in self.segments],
            "language": self.language,
        }


@dataclass
class DeviceInfo:
    """Information about the GPU device being used."""

    backend_type: str  # "nvidia" or "apple"
    device_name: str  # e.g., "NVIDIA GeForce RTX 3090" or "Apple M1 Max"
    device_index: int = 0
    total_memory_mb: int = 0
    compute_type: str = "float16"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "backendType": self.backend_type,
            "deviceName": self.device_name,
            "deviceIndex": self.device_index,
            "totalMemoryMb": self.total_memory_mb,
            "computeType": self.compute_type,
        }


class TranscriptionBackend(ABC):
    """
    Abstract base class for transcription backends.

    All backends must implement GPU-accelerated transcription.
    CPU fallback is NOT supported due to performance requirements.
    """

    @abstractmethod
    def load_model(self, model_name: str) -> None:
        """
        Load a Whisper model onto the GPU.

        Args:
            model_name: Name of the model to load (e.g., "base.en", "small.en", "medium.en").

        Raises:
            NoCompatibleGPUError: If no compatible GPU is available.
            ModelLoadError: If the model fails to load.
        """
        pass

    @abstractmethod
    def transcribe(
        self,
        audio: "np.ndarray",
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
        Transcribe audio to text.

        Args:
            audio: Float32 numpy array normalized to [-1, 1], 16kHz sample rate.
            language: Language code (e.g., "en"). None for auto-detection.
            temperature: Sampling temperature (0.0 for greedy).
            beam_size: Beam search size.
            initial_prompt: Optional context to prime the model.
            vad_filter: Whether to apply Voice Activity Detection.
            vad_parameters: VAD configuration dict.
            condition_on_previous_text: Whether to condition on previous segment text.
            repetition_penalty: Penalty for repeated tokens during beam search.
            no_repeat_ngram_size: Prevent n-grams of this size from repeating.

        Returns:
            TranscriptionResult with text, segments, and detected language.

        Raises:
            TranscriptionError: If transcription fails.
        """
        pass

    @abstractmethod
    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        pass

    @abstractmethod
    def unload(self) -> None:
        """
        Unload the current model and free GPU memory.

        Should call gc.collect() and clear GPU cache (e.g., torch.cuda.empty_cache()).
        """
        pass

    @abstractmethod
    def get_backend_type(self) -> str:
        """
        Get the backend type identifier.

        Returns:
            "nvidia" for CUDA/faster-whisper or "apple" for MLX.
        """
        pass

    @abstractmethod
    def get_device_info(self) -> DeviceInfo:
        """
        Get information about the GPU device.

        Returns:
            DeviceInfo with device name, memory, compute type, etc.
        """
        pass

    def get_loaded_model_name(self) -> Optional[str]:
        """
        Get the name of the currently loaded model.

        Returns:
            Model name if loaded, None otherwise.
        """
        return None
