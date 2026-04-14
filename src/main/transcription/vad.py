"""
Silero-VAD integration for voice activity detection.

Uses the official silero-vad Python API for reliable speech detection.
Provides per-chunk speech detection and audio filtering capabilities.
"""

import logging
import sys
from typing import List, Tuple, Optional
from dataclasses import dataclass
import numpy as np

logger = logging.getLogger(__name__)

# Audio constants
SAMPLE_RATE = 16000
CHUNK_SIZE_MS = 32  # Silero works with 32ms chunks at 16kHz
SAMPLES_PER_CHUNK = int(SAMPLE_RATE * CHUNK_SIZE_MS / 1000)  # 512 samples


@dataclass
class SpeechSegment:
    """Detected speech segment with timing."""
    start_ms: float
    end_ms: float

    @property
    def duration_ms(self) -> float:
        return self.end_ms - self.start_ms


class SileroVAD:
    """
    Voice Activity Detection using Silero-VAD.

    Uses the official silero-vad Python API for reliable speech detection.
    Optimized for real-time chunk processing in streaming transcription.
    """

    def __init__(
        self,
        threshold: float = 0.5,
        min_speech_duration_ms: int = 250,
        min_silence_duration_ms: int = 100,
        speech_pad_ms: int = 30,
    ):
        """
        Initialize Silero-VAD.

        Args:
            threshold: Speech probability threshold (0-1). Higher = more selective.
            min_speech_duration_ms: Minimum speech segment length to report.
            min_silence_duration_ms: Minimum silence to split segments.
            speech_pad_ms: Padding added before/after speech segments.
        """
        self.threshold = threshold
        self.min_speech_duration_ms = min_speech_duration_ms
        self.min_silence_duration_ms = min_silence_duration_ms
        self.speech_pad_ms = speech_pad_ms

        self._model = None
        self._is_loaded = False

        self._load_model()

    def _load_model(self) -> None:
        """Load Silero-VAD model using official API."""
        try:
            from silero_vad import load_silero_vad
            import torch
        except ImportError as e:
            logger.error("silero-vad or torch not installed")
            raise ImportError(
                "silero-vad and torch are required for VAD. "
                "Install with: pip install silero-vad torch"
            ) from e

        try:
            self._model = load_silero_vad()
            self._is_loaded = True

            logger.info("Silero-VAD model loaded successfully")
            print("Silero-VAD model loaded successfully", file=sys.stderr)

        except Exception as e:
            logger.error(f"Failed to load Silero-VAD: {e}")
            print(f"ERROR: Failed to load Silero-VAD: {e}", file=sys.stderr)
            raise

    def is_loaded(self) -> bool:
        """Check if the VAD model is loaded."""
        return self._is_loaded

    def is_speech(self, audio_chunk: np.ndarray) -> Tuple[bool, float]:
        """
        Check if audio chunk contains speech.

        Args:
            audio_chunk: Float32 audio array, should be ~512 samples (32ms at 16kHz).
                         Values should be normalized to [-1, 1].

        Returns:
            Tuple of (is_speech, probability).

        Raises:
            RuntimeError: If model not loaded.
        """
        if self._model is None:
            raise RuntimeError("VAD model not loaded")

        import torch

        # Ensure correct dtype
        if audio_chunk.dtype != np.float32:
            audio_chunk = audio_chunk.astype(np.float32)

        # Ensure chunk is right size (512 samples = 32ms at 16kHz)
        expected_size = SAMPLES_PER_CHUNK
        if len(audio_chunk) != expected_size:
            if len(audio_chunk) < expected_size:
                # Pad with zeros
                audio_chunk = np.pad(audio_chunk, (0, expected_size - len(audio_chunk)))
            else:
                # Take first chunk's worth
                audio_chunk = audio_chunk[:expected_size]

        # Convert to torch tensor
        audio_tensor = torch.from_numpy(audio_chunk)

        try:
            # Run inference
            probability = self._model(audio_tensor, SAMPLE_RATE).item()
        except Exception as e:
            logger.error(f"VAD inference error: {e}")
            # On error, assume speech to avoid dropping audio
            return True, 1.0

        is_speech = probability >= self.threshold

        return is_speech, probability

    def get_speech_timestamps(
        self,
        audio: np.ndarray,
        return_seconds: bool = False
    ) -> List[SpeechSegment]:
        """
        Get timestamps of speech segments in audio.

        Processes the entire audio array and returns detected speech regions.

        Args:
            audio: Complete audio array (float32, 16kHz).
            return_seconds: If True, return times in seconds instead of ms.

        Returns:
            List of SpeechSegment with start/end times.
        """
        if self._model is None:
            raise RuntimeError("VAD model not loaded")

        import torch
        from silero_vad import get_speech_timestamps as silero_get_timestamps

        # Ensure correct dtype
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        # Convert to torch tensor
        audio_tensor = torch.from_numpy(audio)

        # Use official silero-vad function
        timestamps = silero_get_timestamps(
            audio_tensor,
            self._model,
            sampling_rate=SAMPLE_RATE,
            threshold=self.threshold,
            min_speech_duration_ms=self.min_speech_duration_ms,
            min_silence_duration_ms=self.min_silence_duration_ms,
            speech_pad_ms=self.speech_pad_ms,
        )

        # Convert to SpeechSegment objects
        segments = []
        for ts in timestamps:
            start_ms = ts['start'] / SAMPLE_RATE * 1000
            end_ms = ts['end'] / SAMPLE_RATE * 1000
            segments.append(SpeechSegment(start_ms=start_ms, end_ms=end_ms))

        if return_seconds:
            for seg in segments:
                seg.start_ms /= 1000
                seg.end_ms /= 1000

        return segments

    def filter_audio(self, audio: np.ndarray) -> Tuple[np.ndarray, List[SpeechSegment]]:
        """
        Filter audio to keep only speech segments.

        Args:
            audio: Complete audio array (float32, 16kHz).

        Returns:
            Tuple of (filtered_audio, segments).
        """
        segments = self.get_speech_timestamps(audio)

        if not segments:
            logger.debug("VAD: No speech detected in audio")
            return np.array([], dtype=np.float32), []

        # Extract speech segments and concatenate
        filtered_parts = []

        for seg in segments:
            start_sample = int(seg.start_ms * SAMPLE_RATE / 1000)
            end_sample = int(seg.end_ms * SAMPLE_RATE / 1000)
            # Clamp to audio bounds
            start_sample = max(0, start_sample)
            end_sample = min(len(audio), end_sample)
            filtered_parts.append(audio[start_sample:end_sample])

        if not filtered_parts:
            return np.array([], dtype=np.float32), segments

        filtered_audio = np.concatenate(filtered_parts)

        # Log reduction stats
        original_duration = len(audio) / SAMPLE_RATE
        filtered_duration = len(filtered_audio) / SAMPLE_RATE
        reduction = (1 - filtered_duration / original_duration) * 100 if original_duration > 0 else 0

        logger.debug(
            f"VAD: {original_duration:.1f}s -> {filtered_duration:.1f}s "
            f"({reduction:.0f}% reduction, {len(segments)} segments)"
        )

        return filtered_audio, segments

    def reset(self) -> None:
        """
        Reset VAD state for a new audio stream.

        Call this when starting a new transcription session.
        Note: The PyTorch model handles state internally.
        """
        if self._model is not None:
            self._model.reset_states()
