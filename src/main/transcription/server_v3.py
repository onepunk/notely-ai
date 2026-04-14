"""
Improved FastAPI transcription server (V3)

Key improvements over V2:
1. Full audio transcription - no complex window merging
2. Simple delta encoding - send changes based on text comparison
3. Cleaner state management - simpler tracking
4. Better VAD integration - let VAD handle segmentation
5. Timestamp-based audio tracking - not position heuristics

This provides MS Teams-like streaming transcription quality.
"""

import asyncio
import json
import os
import platform
import signal
import sys
import uuid
import base64
import re
import shutil
import time
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Tuple, Deque, Optional
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect, WebSocketState

from backends import (
    create_backend,
    TranscriptionBackend,
    NoCompatibleGPUError,
)
from utils import pcm_to_float32, compute_rms
from sliding_window import (
    find_stable_prefix,
    estimate_text_duration_ms,
    should_force_commit,
    get_context_prompt,
)

# Optional VAD import - graceful fallback if not available
try:
    from vad import SileroVAD
    VAD_AVAILABLE = True
except ImportError:
    SileroVAD = None
    VAD_AVAILABLE = False
    print("WARNING: Silero-VAD not available. Install with: pip install silero-vad onnxruntime", file=sys.stderr)


# Hallucination blocklist (loaded once at startup)
_hallucination_blocklist: Dict[str, set] = {}


def _load_hallucination_blocklist() -> Dict[str, set]:
    """Load hallucination phrase blocklist from static JSON file."""
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS  # PyInstaller bundle
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_path, 'data', 'hallucination_blocklist.json')
    if not os.path.exists(json_path):
        print(f"WARNING: Hallucination blocklist not found at {json_path}", file=sys.stderr)
        return {}
    with open(json_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    result = {lang: set(phrases) for lang, phrases in raw.items()}
    total_phrases = sum(len(s) for s in result.values())
    print(f"Loaded hallucination blocklist: {len(result)} languages, {total_phrases} phrases", file=sys.stderr)
    return result


_hallucination_blocklist = _load_hallucination_blocklist()

_IS_APPLE_SILICON = (platform.system() == "Darwin" and platform.machine() == "arm64")


@dataclass
class CommittedSegment:
    """A segment of text that has been confirmed stable via LocalAgreement."""
    text: str
    start_ms: float
    end_ms: float
    committed_at: float  # timestamp when committed

    def to_dict(self) -> dict:
        return {
            'text': self.text,
            'start_ms': self.start_ms,
            'end_ms': self.end_ms,
            'committed_at': self.committed_at,
        }


app = FastAPI()


# Background model pre-loading: starts after the server is listening so the
# health-check endpoint is available immediately.  A threading.Lock inside
# get_or_load_backend prevents double-loading if a WebSocket arrives while
# the preload is still running.
_backend_lock = __import__('threading').Lock()
_transcribe_lock = asyncio.Lock()

# Single-thread executor for ALL MLX/backend operations.
# Metal command buffers are thread-associated — using the default
# ThreadPoolExecutor (multiple workers) causes races where different
# threads interact with the same Metal device, leading to SIGABRT/SIGSEGV
# with assertions like "encodeSignalEvent:value: with uncommitted encoder".
# Pinning all GPU work to one thread eliminates the race.
_mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-gpu")


def _sigterm_handler(signum, frame):
    """Unload all backends on SIGTERM to avoid Metal GPU crashes on macOS."""
    for key, backend in list(backends.items()):
        try:
            backend.unload()
        except Exception:
            pass
    _mlx_executor.shutdown(wait=False)
    sys.exit(0)

signal.signal(signal.SIGTERM, _sigterm_handler)


@app.on_event("startup")
async def _preload_default_model():
    """Schedule model pre-loading as a background task so the server can
    accept health-check requests while the model is being loaded."""

    async def _do_preload():
        default_model = os.environ.get("NOTELY_DEFAULT_MODEL", "small.en")
        default_backend = os.environ.get("NOTELY_DEFAULT_BACKEND", "auto")

        print(f"[PRELOAD] Starting preload: model='{default_model}', backend='{default_backend}'",
              file=sys.stderr, flush=True)
        print(f"[PRELOAD] NOTELY_DEFAULT_MODEL env = {os.environ.get('NOTELY_DEFAULT_MODEL', '<not set>')}",
              file=sys.stderr, flush=True)
        print(f"[PRELOAD] Model cached check: {_check_model_cached(default_model)}",
              file=sys.stderr, flush=True)
        try:
            await asyncio.get_running_loop().run_in_executor(
                _mlx_executor,
                lambda: get_or_load_backend(default_model, default_backend),
            )
            print(f"[PRELOAD] Model '{default_model}' pre-loaded and ready",
                  file=sys.stderr, flush=True)
        except Exception as e:
            import traceback
            print(f"[PRELOAD] FAILED to pre-load model: {type(e).__name__}: {e}",
                  file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)

    print("[PRELOAD] Creating preload task", file=sys.stderr, flush=True)
    asyncio.create_task(_do_preload())


def normalize_text(text: str) -> str:
    """Normalize text - collapse whitespace and strip"""
    return ' '.join(text.split()).strip()


def find_common_prefix_length(a: str, b: str) -> int:
    """Find the length of common prefix between two strings"""
    min_len = min(len(a), len(b))
    for i in range(min_len):
        if a[i] != b[i]:
            return i
    return min_len


def detect_word_repetition(text: str, threshold: int = 4) -> tuple[bool, str]:
    """
    Detect and remove repeated consecutive words within text.
    E.g., "American American American" -> "American"

    Args:
        text: Input text
        threshold: Minimum number of consecutive repetitions to detect

    Returns:
        (has_repetition, cleaned_text)
    """
    words = text.split()
    if len(words) < threshold:
        return False, text

    cleaned_words = []
    i = 0
    has_repetition = False

    while i < len(words):
        current_word = words[i].lower().strip('.,!?;:')
        repeat_count = 1

        # Count consecutive repetitions of the same word
        j = i + 1
        while j < len(words):
            next_word = words[j].lower().strip('.,!?;:')
            if next_word == current_word:
                repeat_count += 1
                j += 1
            else:
                break

        if repeat_count >= threshold:
            # Found repetition - keep only one instance
            has_repetition = True
            cleaned_words.append(words[i])
            i = j  # Skip to after the repetitions
            print(f"[HALLUCINATION] Detected word repetition: '{current_word}' x{repeat_count}", file=sys.stderr)
        else:
            # No significant repetition, keep all words
            for k in range(i, j):
                cleaned_words.append(words[k])
            i = j

    cleaned_text = ' '.join(cleaned_words)
    return has_repetition, cleaned_text


def is_hallucination(text: str, language: Optional[str] = None) -> bool:
    """
    Detect common Whisper hallucinations.
    Returns True if the text appears to be a hallucination.

    NOTE: Be careful not to filter out real conversational speech!
    Words like "like", "you know", "I mean" are common and valid.

    Args:
        text: The transcribed text to check.
        language: ISO language code for blocklist lookup (e.g., "en", "fr").
    """
    text_lower = text.lower().strip()

    # Common hallucination patterns - SPECIFIC to YouTube/podcast prompts
    hallucination_patterns = [
        # Subscription/channel prompts - require full phrases, not just words
        r'subscribe (to|and|now)',
        r'(hit|click|smash).{0,20}(like|subscribe|bell|notification)',
        r'(like|subscribe).{0,15}(button|channel)',
        r'leave a (like|comment)',
        r'don\'?t forget to (like|subscribe)',
        # Thanks messages (only standalone, not mid-sentence)
        r'^(thank you|thanks)( for watching| for listening)?\.?$',
        # Music indicators (when VAD triggers on noise)
        r'^\[?music\]?$',
        # Empty-ish responses
        r'^(\.+|\s*|you|i|the|a)$',
        # Repetitive single words at start/end (4+ consecutive same words)
        r'^(\w+)(\s+\1){3,}$',
        # Repetitive words anywhere (4+ consecutive same words - increased from 3)
        r'\b(\w+)(\s+\1){3,}\b',
    ]

    for pattern in hallucination_patterns:
        if re.search(pattern, text_lower):
            return True

    # Very short text with low information content
    words = text_lower.split()
    if len(words) <= 2 and len(text_lower) < 10:
        return True

    # Check for excessive word repetition (more than 60% of words are the same)
    # Increased threshold from 50% to 60% to avoid filtering real speech
    if len(words) > 6:  # Increased minimum words to avoid filtering short phrases
        word_counts = {}
        for w in words:
            w_clean = w.strip('.,!?;:').lower()
            if len(w_clean) > 2:  # Skip short words (increased from 1 to 2)
                word_counts[w_clean] = word_counts.get(w_clean, 0) + 1
        if word_counts:
            max_count = max(word_counts.values())
            if max_count > len(words) * 0.6:
                return True

    # Check against hallucination blocklist (exact match)
    if _hallucination_blocklist:
        # Check language-specific blocklist
        if language and language in _hallucination_blocklist:
            if text_lower in _hallucination_blocklist[language]:
                return True
        # Always check English as fallback — Whisper outputs English
        # hallucinations regardless of the configured language
        if language != 'en' and 'en' in _hallucination_blocklist:
            if text_lower in _hallucination_blocklist['en']:
                return True

    return False


def detect_phrase_repetition(text: str, min_ngram: int = 5) -> tuple[bool, str]:
    """
    Detect when a phrase from earlier in the text is repeated at the end.
    This catches hallucinations like "...catch a giant marlin. The film is made
    possible by the American author Ernest Hemingway" where the last part
    repeats an earlier phrase.

    Args:
        text: Input text
        min_ngram: Minimum number of words for phrase match

    Returns:
        (has_repetition, cleaned_text)
    """
    words = text.split()
    if len(words) < min_ngram * 2:
        return False, text

    # Look at the last portion of the text (last 30% or so)
    check_start = max(min_ngram, int(len(words) * 0.7))

    # Search for repeated phrases at the end
    best_match_pos = -1
    best_match_len = 0

    for i in range(check_start, len(words) - min_ngram + 1):
        # Get the phrase from position i to the end
        end_phrase = ' '.join(w.lower().strip('.,!?;:') for w in words[i:])

        # Look for this phrase in the first 70% of the text
        for j in range(0, check_start - min_ngram):
            # Check if there's a match starting at position j
            match_len = 0
            for k in range(min(len(words) - i, check_start - j)):
                word1 = words[j + k].lower().strip('.,!?;:')
                word2 = words[i + k].lower().strip('.,!?;:')
                if word1 == word2:
                    match_len += 1
                else:
                    break

            if match_len >= min_ngram and match_len > best_match_len:
                best_match_pos = i
                best_match_len = match_len

    if best_match_pos > 0 and best_match_len >= min_ngram:
        # Found a repeated phrase at the end - truncate
        # Go back a few words to find a sentence boundary
        cut_pos = best_match_pos
        for look_back in range(min(10, cut_pos)):
            idx = cut_pos - look_back - 1
            if idx >= 0 and words[idx].rstrip().endswith(('.', '!', '?')):
                cut_pos = idx + 1
                break

        cleaned_words = words[:cut_pos]
        cleaned_text = ' '.join(cleaned_words)
        print(f"[HALLUCINATION] Detected phrase repetition at word {best_match_pos}, " +
              f"match len={best_match_len}, truncating to {cut_pos} words", file=sys.stderr)
        return True, cleaned_text

    return False, text


def detect_ngram_repetition(text: str, min_ngram: int = 3, max_ngram: int = 10, min_repeats: int = 2) -> tuple[bool, str]:
    """
    Detect when a multi-word phrase repeats consecutively.
    E.g., "We are working on the design phase We are working on the design phase"

    Args:
        text: Input text
        min_ngram: Minimum phrase length in words
        max_ngram: Maximum phrase length in words
        min_repeats: Minimum consecutive repetitions to detect

    Returns:
        (has_repetition, cleaned_text)
    """
    words = text.split()
    if len(words) < min_ngram * min_repeats:
        return False, text

    best_start = -1
    best_ngram = 0
    best_repeats = 0
    best_end = -1

    # Check larger patterns first (greedy match)
    for ngram_size in range(min(max_ngram, len(words) // min_repeats), min_ngram - 1, -1):
        i = 0
        while i <= len(words) - ngram_size * min_repeats:
            pattern = [w.lower().strip('.,!?;:') for w in words[i:i + ngram_size]]
            repeat_count = 1
            j = i + ngram_size

            while j + ngram_size <= len(words):
                candidate = [w.lower().strip('.,!?;:') for w in words[j:j + ngram_size]]
                if candidate == pattern:
                    repeat_count += 1
                    j += ngram_size
                else:
                    break

            if repeat_count >= min_repeats and repeat_count > best_repeats:
                best_start = i
                best_ngram = ngram_size
                best_repeats = repeat_count
                best_end = j

            i += 1

        # If we found a match at this ngram size, use it (largest first)
        if best_start >= 0:
            break

    if best_start >= 0:
        # Keep first occurrence, remove subsequent repeats
        cleaned_words = words[:best_start + best_ngram] + words[best_end:]
        cleaned_text = ' '.join(cleaned_words)
        print(
            f"[HALLUCINATION] N-gram repetition: {best_ngram}-gram repeated "
            f"{best_repeats}x at word {best_start}",
            file=sys.stderr
        )
        return True, cleaned_text

    return False, text


def detect_repetition(text: str) -> tuple[bool, str]:
    """
    Detect and remove repetitive phrases in transcription.
    Returns (has_repetition, cleaned_text)
    """
    sentences = re.split(r'(?<=[.!?])\s+', text)
    if len(sentences) < 2:
        return False, text

    # Count sentence occurrences
    sentence_counts = {}
    for sent in sentences:
        sent_lower = sent.lower().strip()
        if len(sent_lower) > 10:  # Only count substantial sentences
            sentence_counts[sent_lower] = sentence_counts.get(sent_lower, 0) + 1

    # Check for repeated sentences
    has_repetition = any(count > 1 for count in sentence_counts.values())

    if not has_repetition:
        return False, text

    # Remove duplicate sentences, keeping first occurrence
    seen = set()
    unique_sentences = []
    for sent in sentences:
        sent_lower = sent.lower().strip()
        if sent_lower not in seen or len(sent_lower) <= 10:
            unique_sentences.append(sent)
            seen.add(sent_lower)

    cleaned = ' '.join(unique_sentences)
    return True, cleaned


def count_unique_words(text: str) -> int:
    """Count unique content words in text"""
    words = re.findall(r'\b[a-z]{3,}\b', text.lower())
    return len(set(words))


def _normalize_for_agreement(text: str) -> str:
    """Strip punctuation and normalize case for LocalAgreement comparison."""
    return re.sub(r'[^\w\s]', '', text.lower()).strip()


def _deduplicate_window_against_committed(committed: str, window_text: str) -> str:
    """
    Remove any overlap between the tail of committed text and the head of window text.

    When the sliding window overlaps with already-committed audio, whisper may
    re-transcribe words that are already in committed_text. This finds the
    longest word-level overlap and returns only the new (non-overlapping) portion
    of window_text. Uses fuzzy matching to handle minor whisper variations.
    """
    if not committed or not window_text:
        return window_text

    committed_words = committed.strip().split()
    window_words = window_text.strip().split()

    if not committed_words or not window_words:
        return window_text

    # Normalize for comparison (lowercase, strip punctuation)
    def norm(w):
        return re.sub(r'[^\w]', '', w.lower())

    def fuzzy_eq(a, b):
        """Check if two words match after normalization."""
        return norm(a) == norm(b)

    norm_committed = [norm(w) for w in committed_words]
    norm_window = [norm(w) for w in window_words]

    # Find the longest overlap: tail of committed matches head of window (fuzzy)
    best_overlap = 0
    max_check = min(len(norm_committed), len(norm_window))
    for overlap_len in range(1, max_check + 1):
        tail = norm_committed[-overlap_len:]
        head = norm_window[:overlap_len]
        if all(fuzzy_eq(t, h) for t, h in zip(tail, head)):
            best_overlap = overlap_len

    if best_overlap > 0:
        remaining_words = window_words[best_overlap:]
        return ' '.join(remaining_words)
    return window_text


def clean_text(text: str) -> str:
    """
    Clean transcribed text - fix common issues and remove artifacts.
    """
    text = normalize_text(text)

    # Strip Whisper hallucination artifacts: runs of repeated special characters
    # These appear when Whisper hallucinates during silence
    text = re.sub(r'_{3,}', '', text)       # Underscore runs (3+)
    text = re.sub(r'-{5,}', '', text)       # Dash runs (5+, avoids em-dash --)
    text = re.sub(r'\.{4,}', '', text)      # Dot runs (4+, preserves ellipsis ...)
    text = re.sub(r'={3,}', '', text)       # Equals runs (3+)
    text = re.sub(r'\s{2,}', ' ', text)     # Collapse resulting double spaces

    # Remove leading/trailing punctuation artifacts
    text = re.sub(r'^[.,!?;:\s]+', '', text)
    text = re.sub(r'[.,!?;:\s]+$', '', text)

    # Fix double punctuation
    text = re.sub(r'([.!?])\1+', r'\1', text)

    # Fix spacing around punctuation
    text = re.sub(r'\s+([.,!?;:])', r'\1', text)
    text = re.sub(r'([.,!?;:])([A-Za-z])', r'\1 \2', text)

    return normalize_text(text)


@dataclass
class TranscriptionSegment:
    """A single transcription segment with timestamps"""
    text: str
    start_time: float  # Start time in seconds
    end_time: float    # End time in seconds
    segment_id: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class TranscriptionSession:
    """
    Manages a single transcription session with simplified state tracking.

    Key design: Transcribe ALL accumulated audio each time, then compute
    delta from previous transcription. This is simpler and more accurate
    than trying to merge overlapping windows.

    VAD Integration: Optionally filters audio chunks through Silero-VAD
    before accumulation, reducing processing costs by filtering silence.
    """
    session_id: str
    websocket: WebSocket
    config: dict
    backend: TranscriptionBackend

    # Audio accumulation - timestamped chunks for sliding window
    audio_chunks: Deque[Tuple[bytes, float]] = field(default_factory=deque)  # (chunk, timestamp_ms)
    speech_chunks: Deque[Tuple[bytes, float]] = field(default_factory=deque)  # VAD-filtered with timestamps
    # Complete audio buffer for the final batch pass (never trimmed).
    # The sliding window trims audio_chunks as text is committed, but the
    # final pass needs ALL audio to produce a clean batch transcription.
    all_audio_bytes: bytearray = field(default_factory=bytearray)
    total_audio_duration_ms: float = 0.0
    speech_audio_duration_ms: float = 0.0  # Duration of speech-only audio

    # Committed text (stable, won't change) - for sliding window
    committed_segments: List[CommittedSegment] = field(default_factory=list)
    committed_text: str = ""
    committed_duration_ms: float = 0.0

    # LocalAgreement tracking - for sliding window stability
    agreement_count: int = 0
    pending_stable_text: str = ""
    pending_stable_since: float = 0.0

    # Transcription state - simple previous/current comparison
    last_transcription: str = ""
    best_transcription: str = ""  # Best (longest valid) transcription seen
    last_sent_text: str = ""  # What was actually sent to client (for delta encoding)
    sequence: int = 0

    # Segment timestamps from Whisper
    last_segments: List[TranscriptionSegment] = field(default_factory=list)

    # Control flags
    is_transcribing: bool = False
    needs_rerun: bool = False
    active_transcribe: Optional[asyncio.Task] = field(default=None, repr=False)
    stop_requested: bool = False
    silence_count: int = 0  # Consecutive silence periods
    last_transcribe_audio_len: int = 0  # Audio length at last transcription

    # Minimum audio for transcription (in bytes)
    min_audio_bytes: int = 16000 * 2 * 2  # 2 seconds at 16kHz PCM16

    # VAD state (initialized in __post_init__)
    _vad: object = field(default=None, repr=False)
    _vad_enabled: bool = field(default=False, repr=False)
    _use_prefilter_vad: bool = field(default=False, repr=False)  # Use pre-filter VAD vs Whisper's VAD
    vad_stats: dict = field(default_factory=lambda: {
        'total_chunks': 0,
        'speech_chunks': 0,
        'silence_chunks': 0,
    })

    # Sliding Window config (initialized in __post_init__)
    use_sliding_window: bool = field(default=True, repr=False)
    window_size_ms: float = field(default=30000.0, repr=False)
    window_overlap_ms: float = field(default=5000.0, repr=False)
    min_stable_iterations: int = field(default=2, repr=False)
    commit_delay_ms: float = field(default=1500.0, repr=False)
    max_pending_audio_ms: float = field(default=45000.0, repr=False)
    context_prompt_max_chars: int = field(default=500, repr=False)

    # Language detection state
    detected_language: Optional[str] = field(default=None, repr=False)
    language_confidence: float = field(default=0.0, repr=False)
    language_detection_done: bool = field(default=False, repr=False)
    language_detection_audio_ms: float = field(default=5000.0, repr=False)  # Min audio for detection

    def __post_init__(self):
        """Initialize VAD and sliding window config."""
        self._init_vad()
        self._init_sliding_window()

    def _init_sliding_window(self):
        """Initialize sliding window configuration from config dict."""
        self.use_sliding_window = self.config.get('useSlidingWindow', True)
        self.window_size_ms = float(self.config.get('windowSizeMs', 30000))
        self.window_overlap_ms = float(self.config.get('windowOverlapMs', 5000))
        self.min_stable_iterations = int(self.config.get('minStableIterations', 2))
        self.commit_delay_ms = float(self.config.get('commitDelayMs', 1500))
        self.max_pending_audio_ms = float(self.config.get('maxPendingAudioMs', 45000))
        self.context_prompt_max_chars = int(self.config.get('contextPromptMaxChars', 500))

        if self.use_sliding_window:
            print(
                f"Sliding window enabled: "
                f"window={self.window_size_ms}ms, "
                f"overlap={self.window_overlap_ms}ms, "
                f"minStable={self.min_stable_iterations}, "
                f"commitDelay={self.commit_delay_ms}ms",
                file=sys.stderr
            )

    def _init_vad(self):
        """Initialize Silero-VAD for pre-filtering."""
        # Check if pre-filter VAD is enabled (separate from Whisper's internal VAD)
        self._use_prefilter_vad = self.config.get('usePrefilterVad', False)

        if not self._use_prefilter_vad:
            print(f"Pre-filter VAD disabled (using Whisper's internal VAD)", file=sys.stderr)
            return

        if not VAD_AVAILABLE:
            print("Pre-filter VAD requested but silero-vad not available", file=sys.stderr)
            return

        try:
            self._vad = SileroVAD(
                threshold=self.config.get('prefilterVadThreshold', 0.5),
                min_speech_duration_ms=self.config.get('prefilterVadMinSpeechMs', 250),
                min_silence_duration_ms=self.config.get('prefilterVadMinSilenceMs', 100),
                speech_pad_ms=self.config.get('prefilterVadSpeechPadMs', 30),
            )
            self._vad_enabled = True
            print(f"Pre-filter VAD enabled: threshold={self.config.get('prefilterVadThreshold', 0.5)}", file=sys.stderr)
        except Exception as e:
            print(f"Failed to initialize pre-filter VAD: {e}", file=sys.stderr)
            self._vad_enabled = False

    def add_chunk(self, chunk: bytes) -> bool:
        """
        Add audio chunk to buffer, optionally filtering through VAD.

        Args:
            chunk: PCM16 audio bytes at 16kHz

        Returns:
            True if chunk contains speech (or VAD disabled), False if silence
        """
        import numpy as np

        # Calculate chunk duration and timestamp
        chunk_duration_ms = (len(chunk) / 2) / 16.0  # PCM16 at 16kHz
        timestamp_ms = self.total_audio_duration_ms

        # Always track total audio with timestamp
        self.audio_chunks.append((chunk, timestamp_ms))
        self.all_audio_bytes.extend(chunk)  # Never trimmed — used for final batch pass
        self.total_audio_duration_ms += chunk_duration_ms
        self.vad_stats['total_chunks'] += 1

        # If pre-filter VAD not enabled, treat all chunks as speech
        if not self._vad_enabled or self._vad is None:
            self.speech_chunks.append((chunk, timestamp_ms))
            self.speech_audio_duration_ms += chunk_duration_ms
            self.vad_stats['speech_chunks'] += 1
            return True

        # Convert PCM16 to float32 for VAD
        audio_array = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

        # Run VAD
        is_speech, probability = self._vad.is_speech(audio_array)

        if is_speech:
            self.speech_chunks.append((chunk, timestamp_ms))
            self.speech_audio_duration_ms += chunk_duration_ms
            self.vad_stats['speech_chunks'] += 1
            # Debug logging (can be verbose, consider reducing frequency)
            if self.vad_stats['total_chunks'] % 50 == 0:  # Log every 50 chunks
                print(f"VAD: speech (p={probability:.2f}), total={self.vad_stats['total_chunks']}, speech={self.vad_stats['speech_chunks']}", file=sys.stderr)
            return True
        else:
            self.vad_stats['silence_chunks'] += 1
            return False

    def get_vad_reduction(self) -> float:
        """Get percentage of audio filtered by VAD."""
        total = self.vad_stats['total_chunks']
        if total == 0:
            return 0.0
        speech = self.vad_stats['speech_chunks']
        return (1 - speech / total) * 100

    def log_session_stats(self):
        """Log session statistics including VAD effectiveness."""
        reduction = self.get_vad_reduction()
        print(
            f"Session {self.session_id} stats: "
            f"total_duration={self.total_audio_duration_ms:.0f}ms, "
            f"speech_duration={self.speech_audio_duration_ms:.0f}ms, "
            f"VAD_reduction={reduction:.1f}%, "
            f"total_chunks={self.vad_stats['total_chunks']}, "
            f"speech_chunks={self.vad_stats['speech_chunks']}, "
            f"silence_chunks={self.vad_stats['silence_chunks']}",
            file=sys.stderr
        )

    def get_total_audio_bytes(self) -> int:
        """Get total audio bytes accumulated (all chunks)."""
        return sum(len(chunk) for chunk, _ in self.audio_chunks)

    def get_speech_audio_bytes(self) -> int:
        """Get speech-only audio bytes (VAD-filtered)."""
        return sum(len(chunk) for chunk, _ in self.speech_chunks)

    def get_audio_for_transcription(self) -> List[bytes]:
        """
        Get the audio chunks to use for transcription.

        Returns speech_chunks if pre-filter VAD is enabled and has filtered audio,
        otherwise returns all audio_chunks.
        """
        if self._vad_enabled and self.speech_chunks:
            return [chunk for chunk, _ in self.speech_chunks]
        return [chunk for chunk, _ in self.audio_chunks]

    def get_window_audio(self) -> bytes:
        """
        Get audio within the sliding window for transcription.

        Returns concatenated audio bytes from chunks within window_size_ms
        of the current position, adjusted for committed duration.
        """
        if not self.audio_chunks:
            return b''

        # Use speech chunks if VAD enabled
        chunks = self.speech_chunks if self._vad_enabled and self.speech_chunks else self.audio_chunks

        # Calculate cutoff: only include audio after committed portion, within window
        effective_start = self.committed_duration_ms
        cutoff_ms = max(effective_start, self.total_audio_duration_ms - self.window_size_ms)

        window_bytes = []
        for chunk, timestamp_ms in chunks:
            if timestamp_ms >= cutoff_ms:
                window_bytes.append(chunk)

        return b''.join(window_bytes)

    def trim_buffer(self, keep_after_ms: float) -> int:
        """
        Remove audio chunks older than keep_after_ms to free memory.

        Args:
            keep_after_ms: Keep chunks with timestamp >= this value

        Returns:
            Number of chunks removed
        """
        removed = 0

        # Trim audio_chunks
        while self.audio_chunks:
            chunk, timestamp_ms = self.audio_chunks[0]
            if timestamp_ms < keep_after_ms:
                self.audio_chunks.popleft()
                removed += 1
            else:
                break

        # Trim speech_chunks
        while self.speech_chunks:
            chunk, timestamp_ms = self.speech_chunks[0]
            if timestamp_ms < keep_after_ms:
                self.speech_chunks.popleft()
            else:
                break

        return removed

    def has_new_audio(self, min_new_bytes: int = 3200) -> bool:
        """Check if there's enough new audio since last transcription."""
        # Use speech chunks if VAD enabled, otherwise all chunks
        if self._vad_enabled:
            current_len = self.get_speech_audio_bytes()
        else:
            current_len = self.get_total_audio_bytes()
        return (current_len - self.last_transcribe_audio_len) >= min_new_bytes

    def mark_transcribed(self):
        """Mark current audio position as transcribed."""
        # Track based on what we actually transcribed
        if self._vad_enabled:
            self.last_transcribe_audio_len = self.get_speech_audio_bytes()
        else:
            self.last_transcribe_audio_len = self.get_total_audio_bytes()

    async def send_message(self, message: dict):
        """Send message to client via WebSocket"""
        try:
            if self.websocket.client_state == WebSocketState.CONNECTED:
                await self.websocket.send_json(message)
        except Exception as e:
            print(f"ERROR sending message: {e}", file=sys.stderr)

    def get_effective_language(self) -> Optional[str]:
        """
        Get the effective language for transcription.

        Returns:
            - The detected language if auto-detect was successful
            - The configured language if not 'auto'
            - None if 'auto' and detection not yet done (triggers detection)
        """
        config_language = self.config.get('language', 'en')

        # If language is explicitly set (not auto), use it
        if config_language != 'auto':
            return config_language

        # If auto-detect and we have a detected language, use it
        if self.detected_language:
            return self.detected_language

        # Auto-detect requested but not done yet
        return None

    def is_auto_detect_enabled(self) -> bool:
        """Check if auto-detect language is enabled."""
        return self.config.get('language', 'en') == 'auto'

    def needs_language_detection(self) -> bool:
        """Check if we need to perform language detection."""
        return (
            self.is_auto_detect_enabled() and
            not self.language_detection_done and
            self.total_audio_duration_ms >= self.language_detection_audio_ms
        )


# Global state
sessions: Dict[str, TranscriptionSession] = {}
backends: Dict[str, TranscriptionBackend] = {}



def get_or_load_backend(
    model_name: str,
    backend_type: str = "auto",
) -> TranscriptionBackend:
    """
    Get cached backend or create new one and load model.

    Thread-safe: uses _backend_lock to prevent double-loading when
    the startup preload and a WebSocket connection race.

    Args:
        model_name: Name of the model to load (e.g., "small.en").
        backend_type: Backend type ("auto", "nvidia", "apple").

    Returns:
        TranscriptionBackend with the model loaded.

    Raises:
        NoCompatibleGPUError: If no compatible GPU is available.
    """
    cache_key = f"{model_name}_{backend_type}"

    # Fast path: already loaded (no lock needed for reads)
    if cache_key in backends:
        print(f"[BACKEND] Cache hit for '{cache_key}'", file=sys.stderr, flush=True)
        return backends[cache_key]

    print(f"[BACKEND] Cache miss for '{cache_key}', loading...", file=sys.stderr, flush=True)

    with _backend_lock:
        # Re-check under lock (another thread may have loaded it)
        if cache_key in backends:
            print(f"[BACKEND] Cache hit under lock for '{cache_key}'", file=sys.stderr, flush=True)
            return backends[cache_key]

        # Unload any existing backends before loading new model
        for old_key, old_backend in list(backends.items()):
            print(f"[BACKEND] Unloading previous model: {old_key}", file=sys.stderr, flush=True)
            try:
                old_backend.unload()
            except Exception as e:
                print(f"[BACKEND] WARNING: failed to unload {old_key}: {e}", file=sys.stderr)
        backends.clear()

        # Pass model name directly — faster-whisper resolves HuggingFace cache natively
        print(f"[BACKEND] Creating backend: type={backend_type}, model={model_name}", file=sys.stderr, flush=True)

        backend = create_backend(backend_type)
        backend.load_model(model_name)

        backends[cache_key] = backend
        print(f"[BACKEND] Ready: {backend.get_backend_type()}, model={model_name}", file=sys.stderr, flush=True)

    return backends[cache_key]


def commit_segment(
    session: TranscriptionSession,
    stable_text: str,
    segments: List,
) -> None:
    """
    Commit stable text and trim the audio buffer.

    This is called when LocalAgreement confirms text is stable
    (same prefix appears in multiple consecutive transcriptions).

    Args:
        session: Current transcription session
        stable_text: Text confirmed stable via LocalAgreement
        segments: Transcription segments for timing estimation
    """
    if not stable_text:
        return

    # Deduplicate: if stable_text overlaps with the tail of committed_text,
    # only commit the non-overlapping portion to avoid duplicated phrases.
    if session.committed_text:
        deduped = _deduplicate_window_against_committed(session.committed_text, stable_text)
        if deduped != stable_text:
            print(
                f"  Dedup commit: '{stable_text[:40]}...' -> '{deduped[:40]}...'",
                file=sys.stderr
            )
            stable_text = deduped
        if not stable_text:
            return

    # Estimate duration of committed text
    duration_ms = estimate_text_duration_ms(stable_text, segments)

    # Safety: cap duration against actual pending audio to prevent
    # hallucinated text from inflating committed_duration_ms beyond
    # real audio, which would cause trim_buffer to discard unprocessed audio.
    max_pending_ms = session.total_audio_duration_ms - session.committed_duration_ms
    if max_pending_ms > 0 and duration_ms > max_pending_ms:
        print(
            f"  Duration capped: {duration_ms:.0f}ms -> {max_pending_ms:.0f}ms "
            f"(actual pending audio)",
            file=sys.stderr
        )
        duration_ms = max_pending_ms

    # Create committed segment
    committed = CommittedSegment(
        text=stable_text,
        start_ms=session.committed_duration_ms,
        end_ms=session.committed_duration_ms + duration_ms,
        committed_at=time.time()
    )

    session.committed_segments.append(committed)

    # Append to committed text (with space if needed)
    if session.committed_text and not session.committed_text.endswith(' '):
        session.committed_text += ' '
    session.committed_text += stable_text

    session.committed_duration_ms += duration_ms

    # Trim buffer, keeping overlap for context
    keep_after_ms = session.committed_duration_ms - session.window_overlap_ms
    removed = session.trim_buffer(keep_after_ms)

    # Reset LocalAgreement tracking
    session.agreement_count = 0
    session.pending_stable_text = ""
    session.pending_stable_since = 0.0

    print(
        f"COMMITTED: {len(stable_text)} chars, "
        f"duration={duration_ms:.0f}ms, "
        f"buffer_trimmed={removed} chunks, "
        f"total_committed={len(session.committed_text)} chars",
        file=sys.stderr
    )


async def transcribe_session(session: TranscriptionSession, is_final: bool = False) -> bool:
    """
    Transcribe session audio with optional sliding window mode.

    When sliding window is enabled:
    1. Only transcribe recent audio within the window
    2. Use LocalAgreement to find stable text
    3. Commit stable text and trim the buffer
    4. Force commit if buffer gets too large

    When sliding window is disabled:
    1. Transcribe all accumulated audio
    2. Compare to previous transcription
    3. Send delta (what changed)
    """
    MIN_AUDIO_FOR_TRANSCRIPTION_MS = 500
    MIN_AUDIO_FOR_PROMPT_MS = 5000

    # Get audio based on mode
    if is_final and session.use_sliding_window:
        # Final pass: transcribe ALL accumulated audio (batch mode).
        # The sliding window may have missed words due to timing-dependent
        # LocalAgreement resets. Batch mode gets 0% WER on this audio,
        # so using it for the final pass recovers any missed words.
        # Use all_audio_bytes (never trimmed) to ensure no audio is lost.
        audio_chunks = [bytes(session.all_audio_bytes)]
        audio_bytes = len(session.all_audio_bytes)
        print(f"  Final pass: using ALL audio ({audio_bytes} bytes, {audio_bytes/32000:.1f}s) instead of window", file=sys.stderr)
    elif session.use_sliding_window:
        # Sliding window mode: only transcribe recent window
        audio_bytes_raw = session.get_window_audio()
        if not audio_bytes_raw:
            return False
        audio_chunks = [audio_bytes_raw]  # Already concatenated
        audio_bytes = len(audio_bytes_raw)
    else:
        # Legacy mode: transcribe all audio
        audio_chunks = session.get_audio_for_transcription()
        audio_bytes = sum(len(c) for c in audio_chunks)

    # Skip if not enough audio yet (unless final)
    if not is_final and audio_bytes < session.min_audio_bytes:
        return False

    # Skip if no new audio (unless final) - only for legacy mode
    if not session.use_sliding_window and not is_final and not session.has_new_audio():
        return False

    # Check audio level
    rms = compute_rms(audio_chunks)
    min_rms = session.config.get('minWindowRms', 0.0002)

    if rms < min_rms:
        session.silence_count += 1
        if not is_final and session.silence_count < 5:
            return False
    else:
        session.silence_count = 0

    # Convert to float32
    audio = pcm_to_float32(audio_chunks)

    # Calculate duration based on what we're transcribing
    if session._vad_enabled:
        duration_ms = session.speech_audio_duration_ms
        total_ms = session.total_audio_duration_ms
        reduction = session.get_vad_reduction()
        print(f"TRANSCRIBE: Processing {duration_ms:.0f}ms speech (from {total_ms:.0f}ms total, {reduction:.0f}% VAD reduction) (final={is_final})", file=sys.stderr)
    else:
        duration_ms = session.total_audio_duration_ms
        print(f"TRANSCRIBE: Processing {duration_ms:.0f}ms of audio (final={is_final})", file=sys.stderr)

    # Get config
    beam_size = session.config.get('beamSize', 2)
    temperature = session.config.get('temperature', 0.1)

    # Hallucination prevention parameters
    condition_on_previous_text = session.config.get('conditionOnPreviousText', False)
    repetition_penalty = session.config.get('repetitionPenalty', 1.0)
    no_repeat_ngram_size = session.config.get('noRepeatNgramSize', 0)

    # Handle language detection for auto-detect mode
    language = session.get_effective_language()

    # Perform language detection if needed (auto-detect enabled and enough audio)
    if session.needs_language_detection():
        print(f"LANGUAGE DETECTION: Starting detection from {session.total_audio_duration_ms:.0f}ms audio", file=sys.stderr)
        try:
            # Run transcription with language=None to trigger Whisper's auto-detect
            detect_result = await asyncio.get_running_loop().run_in_executor(
                _mlx_executor,
                lambda: session.backend.transcribe(
                    audio,
                    language=None,  # Triggers auto-detection
                    temperature=0.0,
                    beam_size=1,  # Fast detection
                    vad_filter=True,
                    vad_parameters={'threshold': 0.3, 'min_speech_duration_ms': 100},
                )
            )

            # Extract detected language from result
            detected_lang = getattr(detect_result, 'language', None)
            detected_prob = getattr(detect_result, 'language_probability', 0.0)

            if detected_lang:
                session.detected_language = detected_lang
                session.language_confidence = detected_prob
                session.language_detection_done = True
                language = detected_lang

                print(f"LANGUAGE DETECTED: {detected_lang} (confidence={detected_prob:.2f})", file=sys.stderr)

                # Send languageDetected event to client
                await session.send_message({
                    'type': 'languageDetected',
                    'language': detected_lang,
                    'confidence': detected_prob,
                })
            else:
                # Detection failed, fallback to English
                print(f"LANGUAGE DETECTION: Failed to detect, defaulting to 'en'", file=sys.stderr)
                session.detected_language = 'en'
                session.language_confidence = 0.0
                session.language_detection_done = True
                language = 'en'

        except Exception as e:
            print(f"LANGUAGE DETECTION ERROR: {e}, defaulting to 'en'", file=sys.stderr)
            session.detected_language = 'en'
            session.language_confidence = 0.0
            session.language_detection_done = True
            language = 'en'

    # If still no language (auto-detect not done yet), use None to let Whisper detect
    if language is None:
        language = None  # Will trigger detection in Whisper

    # Higher beam size for final for better accuracy
    if is_final:
        beam_size = max(beam_size, session.config.get('refinementBeamSize', 5))
        temperature = session.config.get('refinementTemperature', 0.0)

    # VAD parameters - let VAD handle segmentation
    vad_enabled = session.config.get('vadEnabled', True)
    vad_params = None
    if vad_enabled:
        vad_params = {
            'threshold': session.config.get('vadThreshold', 0.25),
            'min_speech_duration_ms': session.config.get('vadMinSpeechDurationMs', 150),
            'min_silence_duration_ms': session.config.get('vadMinSilenceDurationMs', 400),
            'speech_pad_ms': session.config.get('vadSpeechPadMs', 350),
        }

    # Get context prompt for sliding window mode
    # Skip context prompt on final pass — we're re-transcribing all audio
    # from scratch in batch mode, so no context is needed.
    initial_prompt = None
    if session.use_sliding_window and session.committed_text and not is_final:
        audio_duration_ms = audio_bytes / 16  # 16 bytes per ms at 16kHz mono PCM16
        if audio_duration_ms > MIN_AUDIO_FOR_PROMPT_MS or is_final:
            initial_prompt = get_context_prompt(
                session.committed_text,
                session.context_prompt_max_chars
            )
            if initial_prompt:
                print(f"  Using context prompt: '{initial_prompt[:50]}{'...' if len(initial_prompt) > 50 else ''}'", file=sys.stderr)

    try:
        # Transcribe audio using backend abstraction
        result = await asyncio.get_running_loop().run_in_executor(
            _mlx_executor,
            lambda: session.backend.transcribe(
                audio,
                language=language,
                temperature=temperature,
                beam_size=beam_size,
                vad_filter=vad_enabled,
                vad_parameters=vad_params,
                initial_prompt=initial_prompt,
                condition_on_previous_text=condition_on_previous_text,
                repetition_penalty=repetition_penalty,
                no_repeat_ngram_size=no_repeat_ngram_size,
            )
        )

        # Store segments with timestamps from backend result
        session.last_segments = [
            TranscriptionSegment(
                text=seg.text,
                start_time=seg.start_time,
                end_time=seg.end_time,
            )
            for seg in result.segments
        ]

        # Get full transcription from backend result
        new_text = clean_text(result.text)

        print(f"  Raw segments: {len(result.segments)}", file=sys.stderr)
        print(f"  New text ({len(new_text)} chars): {new_text[:100]}{'...' if len(new_text) > 100 else ''}", file=sys.stderr)

        # Skip hallucinations (but not during final — we still need to send committed text)
        if is_hallucination(new_text, language=language) and not is_final:
            print(f"  Skipping hallucination: '{new_text}'", file=sys.stderr)
            session.mark_transcribed()
            return False

        # Check for and clean up sentence-level repetitions
        has_repetition, cleaned_text = detect_repetition(new_text)
        if has_repetition:
            print(f"  Detected sentence repetition! Cleaning {len(new_text)} -> {len(cleaned_text)} chars", file=sys.stderr)
            new_text = cleaned_text

        # Check for and clean up word-level repetitions (e.g., "American American American")
        has_word_rep, word_cleaned = detect_word_repetition(new_text, threshold=4)
        if has_word_rep:
            print(f"  Detected word repetition! Cleaning {len(new_text)} -> {len(word_cleaned)} chars", file=sys.stderr)
            new_text = word_cleaned

        # Check for phrase repetition at end (hallucinated repetition of earlier content)
        has_phrase_rep, phrase_cleaned = detect_phrase_repetition(new_text, min_ngram=7)
        if has_phrase_rep:
            print(f"  Detected phrase repetition! Cleaning {len(new_text)} -> {len(phrase_cleaned)} chars", file=sys.stderr)
            new_text = phrase_cleaned

        # Check for n-gram phrase repetition (e.g., same 5-word phrase repeated 2+ times)
        has_ngram_rep, ngram_cleaned = detect_ngram_repetition(new_text, min_ngram=3, max_ngram=10, min_repeats=2)
        if has_ngram_rep:
            print(f"  Detected n-gram repetition! Cleaning {len(new_text)} -> {len(ngram_cleaned)} chars", file=sys.stderr)
            new_text = ngram_cleaned

        # This is the text from the current window transcription
        window_text = new_text

        # ============================================================
        # SLIDING WINDOW MODE: LocalAgreement stability detection
        # ============================================================
        if session.use_sliding_window and not is_final:
            # Find stable prefix between current and previous transcription
            stable_prefix = find_stable_prefix(session.last_transcription, window_text)

            # Track agreement (normalize to tolerate minor punctuation/case changes from whisper)
            normalized_current = _normalize_for_agreement(stable_prefix) if stable_prefix else ""
            normalized_pending = _normalize_for_agreement(session.pending_stable_text) if session.pending_stable_text else ""

            if stable_prefix and normalized_current == normalized_pending:
                session.agreement_count += 1
                # Keep the longer/more punctuated version
                if len(stable_prefix) >= len(session.pending_stable_text):
                    session.pending_stable_text = stable_prefix
            elif stable_prefix and normalized_pending and normalized_current.startswith(normalized_pending):
                # Prefix grew — still agreeing, just more text now
                session.pending_stable_text = stable_prefix
                session.agreement_count += 1
            else:
                session.pending_stable_text = stable_prefix
                session.pending_stable_since = time.time()
                session.agreement_count = 1 if stable_prefix else 0

            # Check for echo hallucination: if the "stable" text is mostly
            # words already present in committed text, Whisper is likely just
            # regurgitating the context prompt rather than transcribing new audio.
            is_echo = False
            if session.pending_stable_text and session.committed_text:
                # Get the new portion that would actually be committed (after dedup)
                would_commit = _deduplicate_window_against_committed(
                    session.committed_text, session.pending_stable_text
                )
                if would_commit:
                    commit_words = [w.lower().strip('.,!?;:') for w in would_commit.split() if len(w) > 2]
                    # Compare against last portion of committed text
                    committed_tail = session.committed_text[-500:] if len(session.committed_text) > 500 else session.committed_text
                    committed_words_set = set(w.lower().strip('.,!?;:') for w in committed_tail.split() if len(w) > 2)
                    if commit_words and committed_words_set:
                        overlap = sum(1 for w in commit_words if w in committed_words_set) / len(commit_words)
                        if overlap > 0.75:
                            is_echo = True
                            print(
                                f"  Echo hallucination: {overlap:.0%} of new words already in committed text, "
                                f"rejecting stable text",
                                file=sys.stderr
                            )
                            session.agreement_count = 0
                            session.pending_stable_text = ""

            # Check if we should commit
            should_commit_now = (
                not is_echo and
                session.agreement_count >= session.min_stable_iterations and
                time.time() - session.pending_stable_since >= session.commit_delay_ms / 1000 and
                len(session.pending_stable_text) > 0
            )

            # Force commit if buffer too large
            pending_duration = session.total_audio_duration_ms - session.committed_duration_ms
            if pending_duration > session.max_pending_audio_ms:
                print(f"  Buffer pressure: forcing commit (pending={pending_duration:.0f}ms)", file=sys.stderr)
                should_commit_now = True

            if should_commit_now:
                commit_segment(session, session.pending_stable_text, session.last_segments)

            # Update last transcription for next comparison
            session.last_transcription = window_text

            # Build full text using committed as stable base, then append
            # deduplicated window content for the live-streaming portion.
            #
            # Strategy: committed_text is immutable and always forms the prefix.
            # Window text may re-transcribe committed audio with slight
            # variations (e.g., "petty" vs "peaty"), so we deduplicate with
            # fuzzy matching to find only genuinely new content.
            full_text = session.committed_text
            if window_text:
                new_content = _deduplicate_window_against_committed(full_text, window_text)
                if new_content:
                    if full_text and not full_text.endswith(' '):
                        full_text += ' '
                    full_text += new_content
            full_text = full_text.strip()

            # Always update best_transcription with latest text.
            # Use committed_text length as floor — committed text only grows
            # (append-only), so this prevents regression while allowing
            # hallucination cleanup to shrink the unstable window tail.
            if len(full_text) >= len(session.committed_text):
                session.best_transcription = full_text

            print(
                f"  LocalAgreement: stable='{session.pending_stable_text[:30]}...', "
                f"agreement={session.agreement_count}/{session.min_stable_iterations}, "
                f"committed={len(session.committed_text)} chars",
                file=sys.stderr
            )

        # ============================================================
        # LEGACY MODE: Best transcription tracking
        # ============================================================
        elif not session.use_sliding_window:
            # Update best transcription based on QUALITY not LENGTH
            prev_text = session.best_transcription
            new_unique = count_unique_words(window_text)
            prev_unique = count_unique_words(prev_text) if prev_text else 0

            if not prev_text:
                session.best_transcription = window_text
                session.last_transcription = window_text
                print(f"  First transcription: {len(window_text)} chars, {new_unique} unique words", file=sys.stderr)
            elif new_unique >= prev_unique:
                session.best_transcription = window_text
                session.last_transcription = window_text
                print(f"  Better transcription: {new_unique} vs {prev_unique} unique words", file=sys.stderr)
            else:
                session.last_transcription = window_text
                print(f"  Keeping previous: {prev_unique} vs {new_unique} unique words", file=sys.stderr)

        # ============================================================
        # FINAL TRANSCRIPTION: Use batch result directly
        # ============================================================
        if is_final:
            if session.use_sliding_window:
                # The final pass transcribed ALL audio in batch mode.
                # Use the batch transcription directly — it's more accurate
                # than the committed text (batch mode gets 0% WER).
                current_text = window_text
                print(
                    f"  Final: using batch result ({len(window_text)} chars) "
                    f"instead of committed text ({len(session.committed_text)} chars)",
                    file=sys.stderr
                )
            else:
                current_text = session.best_transcription

        else:
            current_text = session.best_transcription

        session.mark_transcribed()

        # Determine what to send
        prev_sent = session.last_sent_text

        # Skip if no meaningful change from what we last sent
        if current_text == prev_sent and not is_final:
            print(f"  No change, skipping update", file=sys.stderr)
            return False

        # Calculate delta from what was previously sent
        prefix_len = find_common_prefix_length(prev_sent, current_text)
        tail = current_text[prefix_len:]

        session.sequence += 1

        if is_final:
            # Send full final text with segment timestamps
            print(f"FINAL: Sending complete text ({len(current_text)} chars) with {len(session.last_segments)} segments", file=sys.stderr)
            print(f"  Text: {current_text}", file=sys.stderr)

            # Build segments with timestamps for the client
            segments_with_timestamps = []
            for seg in session.last_segments:
                segments_with_timestamps.append({
                    'text': seg.text,
                    'segmentId': seg.segment_id,
                    'startTime': seg.start_time,
                    'endTime': seg.end_time,
                })

            # Include committed segments if using sliding window
            if session.use_sliding_window:
                committed_segments = [seg.to_dict() for seg in session.committed_segments]
            else:
                committed_segments = None

            await session.send_message({
                'type': 'final_batch',
                'batchFinal': bool(is_final and session.use_sliding_window),
                'segments': segments_with_timestamps,
                'totalSegments': len(segments_with_timestamps),
                'fullText': current_text,
                'committedSegments': committed_segments,
                'sequence': session.sequence,
            })
        else:
            # Send partial with delta encoding
            print(f"PARTIAL: seq={session.sequence}, prefix={prefix_len}, tail_len={len(tail)}", file=sys.stderr)

            await session.send_message({
                'type': 'partial',
                'text': tail,
                'prefixLength': prefix_len,
                'sequence': session.sequence,
                'segmentId': str(uuid.uuid4()),
                'committedLength': len(session.committed_text.strip()),
            })

        # Track what we actually sent
        session.last_sent_text = current_text
        return True

    except Exception as e:
        print(f"TRANSCRIBE ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False


async def _run_transcribe_with_lock(session: TranscriptionSession, is_final: bool) -> bool:
    """
    Serialize transcription across all sessions to prevent overlapping MLX GPU evals.
    Coalesce multiple requests into at most one extra pass per cycle.
    """
    async with _transcribe_lock:
        session.is_transcribing = True
        try:
            sent = await transcribe_session(session, is_final=is_final)
            if is_final:
                session.needs_rerun = False
                return sent

            if session.needs_rerun and session.audio_chunks:
                session.needs_rerun = False
                sent = await transcribe_session(session, is_final=False)
            return sent
        finally:
            session.is_transcribing = False


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time transcription"""
    await websocket.accept()

    session_id = str(uuid.uuid4())
    session = None

    print(f"WebSocket connected: {session_id}", file=sys.stderr)

    try:
        # Wait for config message
        data = await websocket.receive_json()

        if data.get('type') != 'config':
            print(f"ERROR: Expected config message, got {data.get('type')}", file=sys.stderr)
            await websocket.close()
            return

        config = data.get('config', {})
        print(f"[WS] Received config: {json.dumps(config, indent=2)}", file=sys.stderr, flush=True)

        # Load backend and model (in executor to avoid blocking the event loop
        # when the model needs to be loaded for the first time)
        model_name = config.get('modelName', 'small.en')
        backend_type = config.get('backendType', 'auto')
        print(f"[WS] Loading model '{model_name}' (backend={backend_type})...", file=sys.stderr, flush=True)
        backend = await asyncio.get_running_loop().run_in_executor(
            _mlx_executor,
            lambda: get_or_load_backend(model_name, backend_type),
        )
        print(f"[WS] Model loaded, backend type: {backend.get_backend_type()}", file=sys.stderr, flush=True)

        # Create session
        session = TranscriptionSession(
            session_id=session_id,
            websocket=websocket,
            config=config,
            backend=backend,
        )
        sessions[session_id] = session

        # Send hello
        await session.send_message({
            'type': 'hello',
            'sessionId': session_id,
            'protocol': 'v3',
        })

        # Background transcription task
        transcription_task = None
        # Post-inference gap: how long to wait after a transcription completes
        # before starting the next one. Reuses heartbeatIntervalMs config.
        post_inference_gap = config.get('heartbeatIntervalMs', 2000) / 1000.0
        # Minimum new audio (in bytes) before bothering to transcribe again.
        # 500ms at 16kHz mono PCM16 = 16000 bytes.
        min_new_audio_bytes = 16000

        async def periodic_transcribe():
            """
            Completion-based transcription loop.

            Instead of firing on a fixed timer (which races against the 2-3s
            inference time, creating timing-dependent modes), this loop:
              1. Waits until enough new audio has accumulated
              2. Runs a transcription and AWAITS it
              3. Sleeps for a short gap (post_inference_gap)
              4. Repeats

            This eliminates the heartbeat/inference timing race that caused
            WER to vary between 9.2% and 25.0% across identical runs.
            """
            # Initial wait for audio to start arriving
            await asyncio.sleep(0.5)

            while not session.stop_requested:
                # Poll until we have enough new audio to transcribe
                if not session.audio_chunks or not session.has_new_audio(min_new_bytes=min_new_audio_bytes):
                    await asyncio.sleep(0.2)  # 200ms poll when idle
                    continue

                # Run transcription synchronously (no overlap possible)
                session.active_transcribe = asyncio.create_task(
                    _run_transcribe_with_lock(session, is_final=False)
                )
                try:
                    await asyncio.shield(session.active_transcribe)
                finally:
                    session.active_transcribe = None

                # Post-inference gap: let audio accumulate before next pass
                await asyncio.sleep(post_inference_gap)

        transcription_task = asyncio.create_task(periodic_transcribe())

        # Main message loop
        while True:
            data = await websocket.receive_json()
            msg_type = data.get('type')

            if msg_type == 'audio':
                # Decode and add audio
                audio_b64 = data.get('bytes', '')
                audio_bytes = base64.b64decode(audio_b64)
                session.add_chunk(audio_bytes)

            elif msg_type == 'stop':
                print(f"Stop signal received: {session_id}", file=sys.stderr)

                # Cancel periodic task
                if transcription_task:
                    session.stop_requested = True
                    transcription_task.cancel()
                    try:
                        await transcription_task
                    except asyncio.CancelledError:
                        pass

                # Ensure any in-flight transcribe completes before final
                if session.active_transcribe is not None:
                    try:
                        await asyncio.shield(session.active_transcribe)
                    except asyncio.CancelledError:
                        pass

                # Always run final transcription pass — commits all remaining
                # pending/unstable text and sends committed_text as final_batch.
                sent_final = await _run_transcribe_with_lock(session, is_final=True)

                # Fallback: if no window audio remained (all already committed),
                # send committed_text directly.
                if not sent_final and session.committed_text:
                    segments_with_timestamps = []
                    for seg in session.committed_segments:
                        segments_with_timestamps.append({
                            'text': seg.text,
                            'segmentId': str(uuid.uuid4()),
                            'startTime': seg.start_ms / 1000.0,
                            'endTime': seg.end_ms / 1000.0,
                        })

                    session.sequence += 1
                    await session.send_message({
                        'type': 'final_batch',
                        'batchFinal': True,
                        'segments': segments_with_timestamps,
                        'totalSegments': len(segments_with_timestamps),
                        'fullText': session.committed_text.strip(),
                        'committedSegments': [seg.to_dict() for seg in session.committed_segments],
                        'sequence': session.sequence,
                    })

                break

            else:
                print(f"Unknown message type: {msg_type}", file=sys.stderr)

    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {session_id}", file=sys.stderr)
    except Exception as e:
        print(f"WebSocket error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    finally:
        if session_id in sessions:
            # Log session stats before cleanup
            if session is not None:
                session.log_session_stats()
            del sessions[session_id]
        print(f"Session cleaned up: {session_id}", file=sys.stderr)


@app.get("/debug/sessions")
async def debug_sessions():
    """Return list of active session IDs (test-only)."""
    if os.environ.get("NODE_ENV") != "test":
        return JSONResponse(status_code=404, content={"error": "not available"})
    return {"session_ids": list(sessions.keys())}


@app.get("/debug/session/{session_id}")
async def debug_session(session_id: str):
    """Return session config and parsed fields (test-only)."""
    if os.environ.get("NODE_ENV") != "test":
        return JSONResponse(status_code=404, content={"error": "not available"})
    session = sessions.get(session_id)
    if session is None:
        return JSONResponse(status_code=404, content={"error": "session not found"})
    return {
        "session_id": session.session_id,
        "config": session.config,
        "use_sliding_window": session.use_sliding_window,
        "window_size_ms": session.window_size_ms,
        "window_overlap_ms": session.window_overlap_ms,
        "min_stable_iterations": session.min_stable_iterations,
        "commit_delay_ms": session.commit_delay_ms,
        "max_pending_audio_ms": session.max_pending_audio_ms,
        "context_prompt_max_chars": session.context_prompt_max_chars,
        "_vad_enabled": session._vad_enabled,
    }


@app.post("/shutdown")
async def graceful_shutdown():
    """Unload all backends (clearing Metal/GPU state) then exit."""
    with _backend_lock:
        for key, backend in list(backends.items()):
            try:
                backend.unload()
            except Exception as e:
                print(f"WARNING: failed to unload {key}: {e}", file=sys.stderr)
        backends.clear()
    # Exit after response is sent
    asyncio.get_running_loop().call_later(0.5, lambda: os._exit(0))
    return {"status": "shutting_down"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    # Get backend info if any backends are loaded
    backend_info = []
    for key, backend in backends.items():
        device_info = backend.get_device_info()
        backend_info.append({
            "cacheKey": key,
            "backendType": backend.get_backend_type(),
            "modelLoaded": backend.is_loaded(),
            "modelName": backend.get_loaded_model_name(),
            "device": device_info.to_dict() if device_info else None,
        })

    return {
        "status": "healthy",
        "version": "v3",
        "sessions": len(sessions),
        "backends": backend_info,
        "backendsLoaded": len(backends),
    }


@app.post("/refine")
async def refine_transcription(request: dict):
    """
    Refine transcription using second pass with higher beam size.

    Expects:
        - wav_path: Path to WAV file
        - model_name: Model to use (default: small.en)
        - beam_size: Beam size for refinement (default: 5)
        - hints: Optional user corrections to guide transcription (passed as initial_prompt)

    Returns:
        - text: Refined transcription
        - duration_ms: Audio duration in milliseconds
        - used_hints: Whether hints were applied
    """
    import soundfile as sf

    wav_path = request.get('wav_path')
    model_name = request.get('model_name', 'small')
    beam_size = request.get('beam_size', 5)
    backend_type = request.get('backend_type', 'auto')
    hints = request.get('hints')  # User corrections to bias transcription

    if not wav_path:
        return {"error": "wav_path is required", "success": False}

    print(f"REFINE: Starting refinement of {wav_path}", file=sys.stderr)
    print(f"  Model: {model_name}, Beam size: {beam_size}", file=sys.stderr)
    if hints:
        print(f"  Hints provided: {hints[:100]}{'...' if len(hints) > 100 else ''}", file=sys.stderr)
        print(f"  Using hints as initial_prompt to guide transcription", file=sys.stderr)

    try:
        import numpy as np

        # Load audio file
        audio, sample_rate = sf.read(wav_path, dtype='float32')

        # Ensure float32 (Whisper requirement)
        audio = np.asarray(audio, dtype=np.float32)

        # Ensure mono
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1).astype(np.float32)

        # Resample if needed (Whisper expects 16kHz)
        if sample_rate != 16000:
            # Simple resampling - for production use scipy.signal.resample
            ratio = 16000 / sample_rate
            new_length = int(len(audio) * ratio)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, new_length),
                np.arange(len(audio)),
                audio
            ).astype(np.float32)
            sample_rate = 16000

        duration_ms = len(audio) / sample_rate * 1000
        print(f"  Audio loaded: {duration_ms:.0f}ms at {sample_rate}Hz", file=sys.stderr)

        # Get/load backend
        backend = get_or_load_backend(model_name, backend_type)

        # VAD parameters for refinement
        vad_params = {
            'threshold': 0.25,
            'min_speech_duration_ms': 150,
            'min_silence_duration_ms': 400,
            'speech_pad_ms': 350,
        }

        # Add user corrections as initial_prompt to bias transcription
        initial_prompt = hints if hints else None
        if initial_prompt:
            print(f"  Applying initial_prompt from user hints", file=sys.stderr)

        # Transcribe with higher beam size for accuracy
        result = await asyncio.get_running_loop().run_in_executor(
            _mlx_executor,
            lambda: backend.transcribe(
                audio,
                language='en',
                temperature=0.0,  # Greedy for refinement
                beam_size=beam_size,
                initial_prompt=initial_prompt,
                vad_filter=True,
                vad_parameters=vad_params,
                condition_on_previous_text=False,
                repetition_penalty=1.2,
                no_repeat_ngram_size=3,
            )
        )

        # Get transcription from backend result
        refined_text = clean_text(result.text)

        print(f"  Raw segments: {len(result.segments)}", file=sys.stderr)

        # For refinement with beam_size=5, only apply light filtering
        # Skip aggressive word/phrase repetition filters as beam search handles quality
        has_rep, refined_text = detect_repetition(refined_text)  # Only remove exact duplicate sentences
        # Skip word-level filter: has_word_rep, refined_text = detect_word_repetition(refined_text, threshold=4)
        # Skip phrase-level filter: has_phrase_rep, refined_text = detect_phrase_repetition(refined_text, min_ngram=5)

        print(f"REFINE COMPLETE: {len(refined_text)} chars", file=sys.stderr)
        print(f"  Text: {refined_text[:100]}{'...' if len(refined_text) > 100 else ''}", file=sys.stderr)
        if hints:
            print(f"  Hints were applied via initial_prompt", file=sys.stderr)

        return {
            "text": refined_text,
            "duration_ms": duration_ms,
            "success": True,
            "used_hints": bool(hints),
        }

    except Exception as e:
        print(f"REFINE ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"error": str(e), "success": False}


# ============================================================================
# Model Management Endpoints
# ============================================================================

# Whisper model catalog
WHISPER_MODELS = [
    {"id": "tiny",      "name": "Tiny",       "paramsMB": 39,   "englishOnly": False, "accuracy": "basic",     "description": "39M parameters. Fastest option with lowest resource usage. Limited accuracy, especially with accents or background noise."},
    {"id": "tiny.en",   "name": "Tiny (EN)",  "paramsMB": 39,   "englishOnly": True,  "accuracy": "basic",     "description": "39M parameters, English-only. Slightly more accurate for English than the multilingual tiny model."},
    {"id": "base",      "name": "Base",       "paramsMB": 74,   "englishOnly": False, "accuracy": "basic",     "description": "74M parameters. Somewhat more accurate than tiny at a small size increase. Supports multiple languages."},
    {"id": "base.en",   "name": "Base (EN)",  "paramsMB": 74,   "englishOnly": True,  "accuracy": "basic",     "description": "74M parameters, English-only. More accurate for English than the multilingual base model."},
    {"id": "small",     "name": "Small",      "paramsMB": 244,  "englishOnly": False, "accuracy": "good",      "description": "244M parameters. Noticeable accuracy improvement over base with moderate resource usage."},
    {"id": "small.en",  "name": "Small (EN)", "paramsMB": 244,  "englishOnly": True,  "accuracy": "good",      "description": "244M parameters, English-only. More accurate for English than the multilingual small model."},
    {"id": "medium",    "name": "Medium",     "paramsMB": 769,  "englishOnly": False, "accuracy": "good",      "description": "769M parameters. Improved accuracy over small, particularly for non-English languages. Higher resource usage."},
    {"id": "medium.en", "name": "Medium (EN)","paramsMB": 769,  "englishOnly": True,  "accuracy": "good",      "description": "769M parameters, English-only. More accurate for English than the multilingual medium model."},
    {"id": "large-v3",  "name": "Large v3",   "paramsMB": 1550, "englishOnly": False, "accuracy": "excellent",  "description": "1.5B parameters. Most accurate model available. Significantly slower and more resource-intensive than smaller models."},
    {"id": "turbo",     "name": "Turbo",      "paramsMB": 809,  "englishOnly": False, "accuracy": "excellent",  "description": "809M parameter distilled model. Similar accuracy to large-v3 with faster inference speed."},
]

# Track background download status
_download_status: Dict[str, dict] = {}
_download_lock = threading.Lock()


def _get_repo_name(model_id: str) -> str:
    """Get the HuggingFace repo name for the active backend."""
    if _IS_APPLE_SILICON:
        from backends.mlx_whisper import _MLX_MODEL_MAP
        return _MLX_MODEL_MAP.get(model_id, f"mlx-community/whisper-{model_id}")
    return f"Systran/faster-whisper-{model_id}"


def _check_model_cached(model_id: str) -> bool:
    """Check if a whisper model is already downloaded in the HuggingFace cache."""
    try:
        from huggingface_hub import try_to_load_from_cache
        repo_id = _get_repo_name(model_id)
        print(f"[MODEL_CHECK] Checking HF cache for '{model_id}' (repo={repo_id})", file=sys.stderr, flush=True)
        # Check for config.json — present in both CTranslate2 and MLX repos
        result = try_to_load_from_cache(repo_id, "config.json")
        if result is not None and isinstance(result, str):
            print(f"[MODEL_CHECK] '{model_id}' found via config.json: {result}", file=sys.stderr, flush=True)
            return True
        # Also check for model.bin (CTranslate2 format) on non-Apple platforms
        if not _IS_APPLE_SILICON:
            result = try_to_load_from_cache(repo_id, "model.bin")
            found = result is not None and isinstance(result, str)
            print(f"[MODEL_CHECK] '{model_id}' model.bin check: found={found}, result={result}", file=sys.stderr, flush=True)
            return found
        print(f"[MODEL_CHECK] '{model_id}' NOT found in HF cache", file=sys.stderr, flush=True)
        return False
    except Exception as e:
        print(f"[MODEL_CHECK] Error checking '{model_id}': {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return False


def _get_current_loaded_model() -> Optional[str]:
    """Get the name of the currently loaded model, if any."""
    for key, backend in backends.items():
        if backend.is_loaded():
            return backend.get_loaded_model_name()
    return None


class ModelDownloadRequest(BaseModel):
    model_name: str


class ModelDeleteRequest(BaseModel):
    model_name: str


@app.get("/models/status")
async def get_models_status():
    """Return whisper model catalog with download status."""
    print("[MODELS_STATUS] Checking model status...", file=sys.stderr, flush=True)
    models = []
    for entry in WHISPER_MODELS:
        model = dict(entry)
        model["downloaded"] = _check_model_cached(entry["id"])
        models.append(model)

    loaded_model = _get_current_loaded_model()
    downloaded_ids = [m["id"] for m in models if m["downloaded"]]
    print(f"[MODELS_STATUS] Downloaded: {downloaded_ids}, Loaded: {loaded_model}", file=sys.stderr, flush=True)

    # Include any in-progress downloads
    with _download_lock:
        download_info = dict(_download_status)

    return {
        "models": models,
        "loadedModel": loaded_model,
        "downloads": download_info,
    }


@app.post("/models/download")
async def download_model(request: ModelDownloadRequest):
    """Trigger a model download in the background."""
    model_name = request.model_name

    # Validate model name
    valid_ids = {m["id"] for m in WHISPER_MODELS}
    if model_name not in valid_ids:
        return {"success": False, "error": f"Unknown model: {model_name}"}

    # Check if already downloading
    with _download_lock:
        if model_name in _download_status and _download_status[model_name].get("status") == "downloading":
            return {"success": True, "message": "Already downloading"}

    # Check if already cached
    if _check_model_cached(model_name):
        return {"success": True, "message": "Already downloaded"}

    # Start background download
    with _download_lock:
        _download_status[model_name] = {"status": "downloading", "progress": 0}

    def _do_download():
        try:
            from huggingface_hub import snapshot_download
            repo_id = _get_repo_name(model_name)
            print(f"MODEL DOWNLOAD: Starting download of {repo_id}", file=sys.stderr)
            snapshot_download(repo_id)
            with _download_lock:
                _download_status[model_name] = {"status": "complete"}
            print(f"MODEL DOWNLOAD: Completed {repo_id}", file=sys.stderr)
        except Exception as e:
            print(f"MODEL DOWNLOAD ERROR: {e}", file=sys.stderr)
            with _download_lock:
                _download_status[model_name] = {"status": "error", "error": str(e)}

    thread = threading.Thread(target=_do_download, daemon=True)
    thread.start()

    return {"success": True, "message": "Download started"}


@app.post("/models/delete")
async def delete_model(request: ModelDeleteRequest):
    """Delete a cached model from the HuggingFace cache."""
    model_name = request.model_name

    # Validate model name
    valid_ids = {m["id"] for m in WHISPER_MODELS}
    if model_name not in valid_ids:
        return {"success": False, "error": f"Unknown model: {model_name}"}

    # Don't allow deleting the currently loaded model
    loaded = _get_current_loaded_model()
    if loaded == model_name:
        return {"success": False, "error": "Cannot delete the currently loaded model"}

    try:
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()
        repo_id = _get_repo_name(model_name)

        deleted = False
        for repo in cache_info.repos:
            if repo.repo_id == repo_id:
                # Delete all revisions for this repo
                revision_hashes = [rev.commit_hash for rev in repo.revisions]
                if revision_hashes:
                    delete_strategy = cache_info.delete_revisions(*revision_hashes)
                    delete_strategy.execute()
                    deleted = True
                    print(f"MODEL DELETE: Removed {repo_id} from cache", file=sys.stderr)
                break

        if not deleted:
            return {"success": False, "error": "Model not found in cache"}

        # Clear download status
        with _download_lock:
            _download_status.pop(model_name, None)

        return {"success": True}
    except Exception as e:
        print(f"MODEL DELETE ERROR: {e}", file=sys.stderr)
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    import os

    port = int(os.environ.get("PORT", "48181"))
    print("=" * 70, file=sys.stderr)
    print(f"STARTING TRANSCRIPTION SERVER V3", file=sys.stderr)
    print(f"Port: {port}", file=sys.stderr)
    print(f"Host: 127.0.0.1", file=sys.stderr)
    print("=" * 70, file=sys.stderr)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
