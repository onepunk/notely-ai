"""
Sliding window helpers for streaming transcription with LocalAgreement stability.

This module provides functions for:
1. Finding stable text prefixes across consecutive transcriptions (LocalAgreement)
2. Extracting audio within a sliding window
3. Managing the audio buffer (trimming old chunks)
4. Estimating text duration for timing calculations
"""

from typing import List, Tuple, Deque
import logging

logger = logging.getLogger(__name__)


def find_stable_prefix(prev_text: str, curr_text: str) -> str:
    """
    Find the longest common prefix at word boundaries.

    Uses word-level comparison for robustness against minor
    transcription variations (punctuation, capitalization, etc.).

    This is the core of the LocalAgreement algorithm - when the same
    prefix appears in multiple consecutive transcriptions, we consider
    it "stable" and can commit it.

    Args:
        prev_text: Previous transcription result
        curr_text: Current transcription result

    Returns:
        Longest common prefix string (at word boundaries)
    """
    if not prev_text or not curr_text:
        return ""

    prev_words = prev_text.strip().split()
    curr_words = curr_text.strip().split()

    common_words = []
    for prev_word, curr_word in zip(prev_words, curr_words):
        # Exact match
        if prev_word == curr_word:
            common_words.append(prev_word)
        # Allow minor punctuation differences at word end
        elif prev_word.rstrip('.,!?;:') == curr_word.rstrip('.,!?;:'):
            # Keep the current word's punctuation
            common_words.append(curr_word)
        else:
            # Mismatch - stop here
            break

    if not common_words:
        return ""

    return ' '.join(common_words)


def estimate_text_duration_ms(
    text: str,
    segments: List[dict],
    words_per_second: float = 2.5
) -> float:
    """
    Estimate duration of text in milliseconds.

    Uses segment timestamps if available, otherwise estimates
    based on word count (average speaking rate).

    Args:
        text: Text to estimate duration for
        segments: Transcription segments with timing info (start, end in seconds)
        words_per_second: Fallback estimation rate (default 2.5 = 150 WPM)

    Returns:
        Estimated duration in milliseconds
    """
    # Try to get duration from segments if available
    if segments:
        # Find segments that overlap with the text
        text_lower = text.lower()
        text_words = set(text_lower.split())

        matching_segments = []
        for seg in segments:
            seg_text = seg.get('text', '') if isinstance(seg, dict) else getattr(seg, 'text', '')
            seg_words = set(seg_text.lower().split())
            if seg_words & text_words:  # Any word overlap
                matching_segments.append(seg)

        if matching_segments:
            # Get start/end from segment objects or dicts
            def get_start(s):
                return s.get('start', 0) if isinstance(s, dict) else getattr(s, 'start_time', 0)

            def get_end(s):
                return s.get('end', 0) if isinstance(s, dict) else getattr(s, 'end_time', 0)

            start = min(get_start(s) for s in matching_segments)
            end = max(get_end(s) for s in matching_segments)
            if end > start:
                return (end - start) * 1000

    # Fallback: estimate from word count
    word_count = len(text.split())
    return (word_count / words_per_second) * 1000


def calculate_window_cutoff_ms(
    total_duration_ms: float,
    committed_duration_ms: float,
    window_size_ms: float
) -> float:
    """
    Calculate the cutoff timestamp for the sliding window.

    Audio before this timestamp can be discarded (after committing).

    Args:
        total_duration_ms: Total audio duration accumulated
        committed_duration_ms: Duration of audio already committed
        window_size_ms: Size of the sliding window

    Returns:
        Cutoff timestamp in ms - chunks before this can be trimmed
    """
    # Start from committed duration (we don't need audio before what's committed)
    effective_start = committed_duration_ms

    # But also apply window size limit
    window_cutoff = total_duration_ms - window_size_ms

    return max(effective_start, window_cutoff, 0)


def should_force_commit(
    total_duration_ms: float,
    committed_duration_ms: float,
    max_pending_ms: float
) -> bool:
    """
    Check if we should force a commit due to buffer pressure.

    This prevents unbounded memory growth if LocalAgreement never
    finds a stable prefix (e.g., in noisy audio).

    Args:
        total_duration_ms: Total audio duration accumulated
        committed_duration_ms: Duration already committed
        max_pending_ms: Maximum pending audio before force commit

    Returns:
        True if a force commit is needed
    """
    pending_duration = total_duration_ms - committed_duration_ms
    return pending_duration > max_pending_ms


def _truncate_at_repetition(text: str, min_ngram: int = 3) -> str:
    """
    If text contains repeated n-gram phrases, truncate at the first repetition.

    This prevents feeding hallucinated repeated content back into Whisper
    as context, which would reinforce the hallucination loop.

    Args:
        text: Input text
        min_ngram: Minimum phrase length in words to check

    Returns:
        Text truncated before the first detected repetition, or original text
    """
    words = text.split()
    if len(words) < min_ngram * 2:
        return text

    max_ngram = min(10, len(words) // 2)

    for ngram_size in range(max_ngram, min_ngram - 1, -1):
        for i in range(len(words) - ngram_size * 2 + 1):
            pattern = [w.lower().strip('.,!?;:') for w in words[i:i + ngram_size]]
            candidate = [w.lower().strip('.,!?;:') for w in words[i + ngram_size:i + ngram_size * 2]]
            if pattern == candidate:
                # Found repetition — truncate just before the repeat
                truncated = ' '.join(words[:i + ngram_size])
                logger.info(
                    f"Context prompt truncated at repetition: "
                    f"{ngram_size}-gram at word {i}"
                )
                return truncated

    return text


def get_context_prompt(committed_text: str, max_chars: int) -> str:
    """
    Get context prompt from committed text for Whisper initial_prompt.

    Takes the last N characters of committed text to provide context
    for the next window transcription. Filters out repetitive content
    to prevent reinforcing hallucination loops.

    Args:
        committed_text: All committed text so far
        max_chars: Maximum characters to use as prompt

    Returns:
        Context string to use as initial_prompt
    """
    if not committed_text:
        return ""

    # Truncate at any detected repetition to avoid feeding
    # hallucinated loops back into Whisper as context
    committed_text = _truncate_at_repetition(committed_text)

    if len(committed_text) <= max_chars:
        return committed_text

    # Take last max_chars, but try to start at a word boundary
    context = committed_text[-max_chars:]

    # Find first space to start at word boundary
    first_space = context.find(' ')
    if first_space > 0 and first_space < max_chars // 2:
        context = context[first_space + 1:]

    return context.strip()
