"""
Chunking Pipeline for Notely Standalone.

Modern chunk-map-reduce-refine pattern for analyzing long meeting transcripts.
Ported from notely-platform with adaptations for local LLM inference:
- Uses abstract LLMBackend interface (supports llama.cpp)
- Removed Redis caching (unnecessary for single-user desktop)
- Configuration passed as constructor parameter
- Prompts loaded from configurable directory

Features preserved:
- Token estimation with configurable char-to-token ratio
- Smart chunking: speaker changes > paragraphs > sentences (NLTK)
- Per-chunk extraction with JSON parsing + error recovery
- Fuzzy deduplication (SequenceMatcher, 0.75 threshold)
- Result aggregation and refinement pass
"""

from __future__ import annotations

import json
import logging
import math
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

try:
    import nltk
    from nltk.tokenize import sent_tokenize

    # Ensure punkt data is available
    try:
        nltk.download("punkt", quiet=True)
        nltk.download("punkt_tab", quiet=True)
    except Exception:
        pass
except ImportError:
    nltk = None
    sent_tokenize = None

from backends.llamacpp_backend import LLMBackend, GenerationConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class PipelineConfig:
    """Runtime configuration for the chunking pipeline."""

    # Context and token settings
    context_limit: int = 4096
    completion_tokens: int = 900
    chunk_token_target: int = field(init=False)
    chunk_token_overlap: int = 500
    min_chunk_tokens: int = 800
    max_chunks: int = 100
    chars_per_token: float = 4.0

    # Generation settings
    temperature_extract: float = 0.3
    temperature_refine: float = 0.3
    top_p: float = 0.9

    # Paths
    debug_dir: Optional[Path] = None

    # Deduplication
    similarity_threshold: float = 0.75

    def __post_init__(self) -> None:
        # Calculate chunk target based on context
        target = self.context_limit - self.completion_tokens - 600
        object.__setattr__(self, "chunk_token_target", max(512, target))

    def tokens_to_chars(self, token_count: int) -> int:
        """Convert token count to approximate character count."""
        return max(1, int(math.ceil(token_count * self.chars_per_token)))

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count from character count."""
        if not text or self.chars_per_token <= 0:
            return max(1, len(text or ""))
        return max(1, int(math.ceil(len(text) / self.chars_per_token)))


# ---------------------------------------------------------------------------
# Utility classes
# ---------------------------------------------------------------------------


class TokenEstimator:
    """Token counting utilities."""

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    def estimate(self, text: str) -> int:
        return self.config.estimate_tokens(text)

    def remaining_completion_tokens(self, prompt: str) -> int:
        prompt_tokens = self.estimate(prompt)
        available = self.config.context_limit - prompt_tokens
        return max(0, available)


class PromptRegistry:
    """Manages prompt templates for the chunking pipeline.

    Prompts MUST come from the database (prompt_templates table) and be
    passed in at generation time via the ``from_overrides`` factory.
    There are no silent empty defaults — if prompts are missing, the
    pipeline fails explicitly.
    """

    def __init__(self, base_prompt: str = "", templates: Optional[Dict[str, str]] = None) -> None:
        self.base_prompt = base_prompt
        self.templates = templates or {}

    def get(self, name: str) -> str:
        """Get a prompt template by name."""
        if name not in self.templates:
            raise KeyError(f"Prompt template '{name}' not found")
        return self.templates[name]

    def format_prompt(self, template_name: str, **kwargs) -> str:
        """Format a prompt template with the base prompt included."""
        template = self.get(template_name)
        return template.format(base_prompt=self.base_prompt, **kwargs)

    @classmethod
    def from_overrides(
        cls,
        base_prompt: Optional[str] = None,
        templates: Optional[Dict[str, str]] = None,
        fallback: Optional["PromptRegistry"] = None,
    ) -> "PromptRegistry":
        """Create a PromptRegistry with custom overrides.

        Any field not explicitly overridden falls back to the *fallback*
        registry (if provided).  Raises ``ValueError`` if prompts cannot
        be resolved from any source — prompts must come from the DB.
        """
        resolved_base = base_prompt or (fallback.base_prompt if fallback else None)
        resolved_templates = templates or (fallback.templates if fallback else None)

        if not resolved_base:
            raise ValueError(
                "PromptRegistry: base_prompt is empty — prompts must be "
                "provided from the DB via the TypeScript layer"
            )
        if not resolved_templates:
            raise ValueError(
                "PromptRegistry: templates are empty — prompts must be "
                "provided from the DB via the TypeScript layer"
            )

        return cls(base_prompt=resolved_base, templates=resolved_templates)


# ---------------------------------------------------------------------------
# Chunking stage
# ---------------------------------------------------------------------------


@dataclass
class Chunk:
    """A chunk of transcript text with metadata."""
    text: str
    metadata: Dict[str, Any]


class TranscriptChunker:
    """Split transcripts into manageable overlapping chunks."""

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config
        self.estimator = TokenEstimator(config)

    def chunk(self, text: str) -> List[Chunk]:
        """Split text into chunks based on token limits."""
        token_length = self.estimator.estimate(text)

        # If short enough, return as single chunk
        if token_length <= self.config.chunk_token_target:
            return [self._make_chunk(text, 0, len(text), token_length, 0)]

        splits = self._candidate_split_positions(text)
        chunks: List[Chunk] = []
        start = 0
        chunk_id = 0

        while start < len(text) and chunk_id < self.config.max_chunks:
            target_end = start + self.config.tokens_to_chars(self.config.chunk_token_target)
            best_split = self._select_split(splits, start, target_end)
            best_split = min(best_split, len(text))

            # Add overlap from previous chunk (except for first chunk)
            overlap_chars = (
                self.config.tokens_to_chars(self.config.chunk_token_overlap)
                if chunk_id > 0 else 0
            )
            chunk_start = max(0, start - overlap_chars)
            chunk_text = text[chunk_start:best_split]
            chunk_tokens = self.estimator.estimate(chunk_text)

            chunks.append(self._make_chunk(
                chunk_text, chunk_start, best_split, chunk_tokens, chunk_id
            ))
            start = best_split
            chunk_id += 1

        logger.info(f"Created {len(chunks)} chunks from {token_length} tokens")
        return chunks

    def _candidate_split_positions(self, text: str) -> List[tuple]:
        """Find candidate positions for splitting the text."""
        positions: List[tuple] = []

        # Speaker changes get highest priority (100)
        for match in re.finditer(r"\n\s*[A-Z][a-zA-Z\s]+:\s*", text):
            positions.append((match.start(), 100))

        # Paragraph boundaries (50)
        current = 0
        for paragraph in text.split("\n\n")[:-1]:
            current += len(paragraph) + 2
            positions.append((current, 50))

        # Sentence boundaries via NLTK (10)
        if sent_tokenize:
            try:
                sentences = sent_tokenize(text)
            except Exception:
                sentences = text.split(". ")
        else:
            sentences = text.split(". ")

        offset = 0
        for sentence in sentences[:-1]:
            idx = text.find(sentence, offset)
            if idx >= 0:
                positions.append((idx + len(sentence), 10))
                offset = idx + len(sentence)

        positions.sort(key=lambda x: x[0])
        return positions

    def _select_split(
        self,
        positions: List[tuple],
        start: int,
        target_end: int,
    ) -> int:
        """Select the best split position near the target."""
        best_pos = target_end
        best_score = -1.0

        min_chars = self.config.tokens_to_chars(self.config.min_chunk_tokens)
        max_offset = self.config.tokens_to_chars(self.config.chunk_token_overlap)

        for pos, score in positions:
            if not (start + min_chars <= pos <= target_end + max_offset):
                continue

            distance = abs(pos - target_end)
            distance_penalty = distance / max(1, target_end - start)
            weighted = score * (1 - distance_penalty * 0.5)

            if weighted > best_score:
                best_score = weighted
                best_pos = pos

        return best_pos

    @staticmethod
    def _make_chunk(
        text: str,
        start: int,
        end: int,
        tokens: int,
        chunk_id: int,
    ) -> Chunk:
        """Create a Chunk object with metadata."""
        metadata = {
            "chunk_id": chunk_id,
            "start_char": start,
            "end_char": end,
            "token_estimate": tokens,
            "speaker_count": len(re.findall(r"\n\s*[A-Z][a-zA-Z\s]+:\s*", text)),
        }
        return Chunk(text=text, metadata=metadata)


# ---------------------------------------------------------------------------
# Map stage (per-chunk processing)
# ---------------------------------------------------------------------------


@dataclass
class ChunkAnalysis:
    """Results from analyzing a single chunk."""
    chunk_id: int
    action_items: List[Dict[str, Any]]
    decisions: List[Dict[str, Any]]
    key_points: List[Dict[str, Any]]
    participants: List[str]
    topics: List[str]
    raw_text: str
    processing_time: float


class ChunkAnalyser:
    """Extract structured information from each chunk."""

    def __init__(
        self,
        backend: LLMBackend,
        prompts: PromptRegistry,
        config: PipelineConfig,
    ) -> None:
        self.backend = backend
        self.prompts = prompts
        self.config = config

    def analyse(self, chunk: Chunk) -> ChunkAnalysis:
        """Analyze a chunk and extract structured data."""
        start = time.monotonic()

        prompt = self.prompts.format_prompt(
            "chunk_extraction",
            text=chunk.text,
        )

        gen_config = GenerationConfig(
            max_tokens=self.config.completion_tokens,
            temperature=self.config.temperature_extract,
            top_p=self.config.top_p,
            stop_sequences=["</s>"],
        )

        response = self.backend.generate(prompt, gen_config)
        structured = self._parse_response(response, chunk)
        duration = time.monotonic() - start

        return ChunkAnalysis(
            chunk_id=chunk.metadata["chunk_id"],
            action_items=structured.get("action_items", []),
            decisions=structured.get("decisions", []),
            key_points=structured.get("key_points", []),
            participants=self._coerce_to_strings(structured.get("participants", [])),
            topics=self._coerce_to_strings(structured.get("topics", [])),
            raw_text=response,
            processing_time=duration,
        )

    @staticmethod
    def _coerce_to_strings(items: list) -> List[str]:
        """Coerce a list of mixed types into List[str].

        Smaller LLMs sometimes return participants/topics as dicts
        (e.g. {"name": "Sarah", "role": "Engineer"}) instead of plain
        strings.  This normalises any such list into a flat string list.
        """
        result: List[str] = []
        for item in items:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, (list, tuple)):
                result.append(", ".join(str(x) for x in item))
            elif isinstance(item, dict):
                result.append(
                    str(item.get("name") or item.get("text") or next(iter(item.values()), ""))
                )
            else:
                result.append(str(item))
        return result

    def _parse_response(self, response: str, chunk: Chunk) -> Dict[str, Any]:
        """Parse JSON response with error recovery."""
        if not response:
            return {}

        cleaned = response.strip()

        # Strip markdown fences if present
        fenced = re.match(r"```(?:json)?\s*(.*)```", cleaned, re.DOTALL | re.IGNORECASE)
        if fenced:
            cleaned = fenced.group(1).strip()

        # Fix trailing commas before parsing
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)

        # Find the first '{' and use raw_decode to parse exactly one JSON object,
        # ignoring any trailing text the LLM may have appended.
        brace_idx = cleaned.find("{")
        if brace_idx == -1:
            logger.warning(
                f"No JSON object found in chunk {chunk.metadata['chunk_id']} response"
            )
            self._persist_raw_response(chunk, cleaned)
            return {}

        decoder = json.JSONDecoder()
        try:
            obj, end_idx = decoder.raw_decode(cleaned, brace_idx)
            if not isinstance(obj, dict):
                logger.warning(
                    f"JSON value is not an object for chunk {chunk.metadata['chunk_id']}"
                )
                self._persist_raw_response(chunk, cleaned)
                return {}
            return obj
        except json.JSONDecodeError as e:
            logger.warning(
                f"JSON parse failed for chunk {chunk.metadata['chunk_id']}: {e}"
            )
            self._persist_raw_response(chunk, cleaned)
            return {}

    def _persist_raw_response(self, chunk: Chunk, response: str) -> None:
        """Save failed response for debugging."""
        if not self.config.debug_dir:
            return

        try:
            self.config.debug_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
            path = self.config.debug_dir / f"chunk_error_{chunk.metadata['chunk_id']}_{timestamp}.txt"
            path.write_text(response, encoding="utf-8")
            logger.info(f"Saved failed response to {path}")
        except Exception as e:
            logger.warning(f"Failed to save debug output: {e}")


# ---------------------------------------------------------------------------
# Reduce stage
# ---------------------------------------------------------------------------


class Deduplicator:
    """Deduplicate items using fuzzy string matching."""

    def __init__(self, threshold: float = 0.75) -> None:
        self.threshold = threshold

    def deduplicate_items(
        self,
        items: Iterable[Dict[str, Any]],
        key: str,
    ) -> List[Dict[str, Any]]:
        """Deduplicate dict items based on a text key."""
        unique: List[Dict[str, Any]] = []

        for item in items:
            if not isinstance(item, dict):
                continue
            text = item.get(key, "").strip().lower()
            if not text:
                continue

            if any(self._similar(text, u.get(key, "")) for u in unique):
                continue
            unique.append(item)

        return unique

    def deduplicate_strings(self, items: Iterable) -> List[str]:
        """Deduplicate a list of strings.

        Handles non-string items gracefully: dicts are coerced by extracting
        a 'name' key (common LLM pattern) or falling back to str(), and other
        non-string types are converted via str().
        """
        unique: List[str] = []

        for item in items:
            if isinstance(item, (list, tuple)):
                value = ", ".join(str(x) for x in item)
            elif isinstance(item, dict):
                # LLMs sometimes return {"name": "...", "role": "..."} instead of a plain string
                value = str(item.get("name") or item.get("text") or next(iter(item.values()), ""))
            elif not isinstance(item, str):
                value = str(item)
            else:
                value = item
            value = value.strip()
            if not value:
                continue
            if any(self._similar(value, u) for u in unique):
                continue
            unique.append(value)

        return unique

    def _similar(self, left: str, right: str) -> bool:
        """Check if two strings are similar enough to be duplicates."""
        if not left or not right:
            return False
        return SequenceMatcher(None, left.lower(), right.lower()).ratio() >= self.threshold


@dataclass
class AggregatedResults:
    """Aggregated results from all chunks."""
    action_items: List[Dict[str, Any]]
    decisions: List[Dict[str, Any]]
    key_points: List[Dict[str, Any]]
    participants: List[str]
    topics: List[str]
    processing_stats: Dict[str, Any]


class ResultAggregator:
    """Merge chunk-level analyses into consolidated results."""

    def __init__(self, deduplicator: Deduplicator) -> None:
        self.deduplicator = deduplicator

    def aggregate(self, analyses: List[ChunkAnalysis]) -> AggregatedResults:
        """Aggregate all chunk analyses into a single result."""
        # Flatten all items
        all_action_items = [i for a in analyses for i in a.action_items]
        all_decisions = [d for a in analyses for d in a.decisions]
        all_key_points = [k for a in analyses for k in a.key_points]
        all_participants = [p for a in analyses for p in a.participants]
        all_topics = [t for a in analyses for t in a.topics]

        # Deduplicate
        unique_actions = self.deduplicator.deduplicate_items(all_action_items, "text")
        unique_decisions = self.deduplicator.deduplicate_items(all_decisions, "text")
        unique_key_points = self.deduplicator.deduplicate_items(all_key_points, "summary")
        unique_participants = self.deduplicator.deduplicate_strings(all_participants)
        unique_topics = self.deduplicator.deduplicate_strings(all_topics)

        stats = {
            "chunks_processed": len(analyses),
            "processing_time_seconds": sum(a.processing_time for a in analyses),
            "action_items_before_dedup": len(all_action_items),
            "action_items_after_dedup": len(unique_actions),
        }

        return AggregatedResults(
            action_items=unique_actions,
            decisions=unique_decisions,
            key_points=unique_key_points,
            participants=unique_participants,
            topics=unique_topics,
            processing_stats=stats,
        )


# ---------------------------------------------------------------------------
# Refine stage
# ---------------------------------------------------------------------------


class Refiner:
    """Generate a polished narrative summary from aggregated data."""

    def __init__(
        self,
        backend: LLMBackend,
        prompts: PromptRegistry,
        config: PipelineConfig,
    ) -> None:
        self.backend = backend
        self.prompts = prompts
        self.config = config

    def refine(self, aggregated: AggregatedResults) -> str:
        """Generate the final summary narrative."""
        structured_json = json.dumps(
            {
                "action_items": aggregated.action_items,
                "decisions": aggregated.decisions,
                "key_points": aggregated.key_points,
                "participants": aggregated.participants,
                "topics": aggregated.topics,
            },
            indent=2,
        )

        prompt = self.prompts.format_prompt(
            "refinement",
            text=structured_json,
        )

        gen_config = GenerationConfig(
            max_tokens=min(self.config.completion_tokens, 600),
            temperature=self.config.temperature_refine,
            top_p=self.config.top_p,
            stop_sequences=["</s>"],
        )

        response = self.backend.generate(prompt, gen_config)
        cleaned = self._strip_prompt_echo(response.strip(), prompt)
        cleaned = self._truncate_repeated(cleaned)
        cleaned = self._strip_trailing_chatter(cleaned)

        if self._is_valid_summary(cleaned):
            return cleaned

        logger.warning(
            "Refinement produced unusable output (prompt echo or code), "
            "building summary from structured data"
        )
        return self._build_fallback_summary(aggregated)

    def _strip_prompt_echo(self, response: str, prompt: str) -> str:
        """Strip echoed prompt text from model response.

        Some models echo the prompt before (or instead of) generating their
        response. This detects that pattern and extracts just the generated
        content that follows the echo.
        """
        if not response:
            return ""

        base_prefix = self.prompts.base_prompt[:50]

        # If the response does not start with the base prompt, no echo
        if not response.startswith(base_prefix):
            return response

        logger.warning("Detected prompt echo in refinement response, stripping")

        # Strategy 1: find the full prompt verbatim and take what follows
        prompt_stripped = prompt.strip()
        idx = response.find(prompt_stripped)
        if idx >= 0:
            after = response[idx + len(prompt_stripped):].strip()
            # Strip leading quote/fence artifacts left by the model
            after = re.sub(r'^[\s"\'`]+', "", after)
            if after:
                return after

        # Strategy 2: find the structured findings JSON block and take
        # whatever the model generated after it
        marker = "Structured findings"
        marker_idx = response.find(marker)
        if marker_idx >= 0:
            brace_start = response.find("{", marker_idx)
            if brace_start >= 0:
                depth = 0
                json_end = -1
                for i in range(brace_start, len(response)):
                    if response[i] == "{":
                        depth += 1
                    elif response[i] == "}":
                        depth -= 1
                        if depth == 0:
                            json_end = i + 1
                            break
                if json_end > 0:
                    after = response[json_end:].strip()
                    after = re.sub(r'^[\s"\'`]+', "", after)
                    if after:
                        return after

        # Nothing usable after the echo
        return ""

    @staticmethod
    def _truncate_repeated(text: str) -> str:
        """Detect and truncate repeated summary content.

        Quantized models often generate a complete summary and then fill
        the remaining token budget by repeating it — sometimes with slight
        rewording or hallucinated conversational turns in between.

        Strategy 1: Find the first meaningful line and truncate at its
        second occurrence (catches full-summary repetition).

        Strategy 2: Find any section header that appears more than once
        and truncate at the second occurrence (catches tail-section
        repetition like "Open Questions:" repeating 5+ times).
        """
        if not text or len(text) < 100:
            return text

        # Strategy 1: first-line anchor
        anchor: Optional[str] = None
        for line in text.split("\n"):
            candidate = line.strip()
            if len(candidate) >= 10:
                anchor = candidate
                break

        if anchor:
            first = text.find(anchor)
            if first >= 0:
                second = text.find(anchor, first + len(anchor))
                if second > 0:
                    logger.warning(
                        "Detected repeated summary (anchor %r at pos %d and %d), truncating",
                        anchor[:40],
                        first,
                        second,
                    )
                    return text[:second].rstrip()

        # Strategy 2: repeated section headers
        section_re = re.compile(
            r"^((?:Title|Executive Summary|Key Decisions|Action Items|"
            r"Discussion Highlights|Open Questions)\s*:)",
            re.IGNORECASE | re.MULTILINE,
        )

        seen: Dict[str, int] = {}
        for match in section_re.finditer(text):
            header = match.group(1).strip().lower()
            pos = match.start()
            if header in seen:
                logger.warning(
                    "Detected repeated section header %r at pos %d (first at %d), truncating",
                    match.group(1),
                    pos,
                    seen[header],
                )
                return text[:pos].rstrip()
            seen[header] = pos

        return text

    @staticmethod
    def _strip_trailing_chatter(text: str) -> str:
        """Remove conversational hallucinations appended after the summary.

        Quantized models sometimes finish the summary and then continue
        with meta-commentary ("It seems like…", "Could you please…") as
        if they are chatting with the user.  This detects such trailing
        noise and strips it, provided no further section header follows.
        """
        if not text or len(text) < 100:
            return text

        chatter = re.compile(
            r"(?:It seems(?: like)?|Could you|Can you|Would you|"
            r"Please (?:double[- ]check|let|check|verify|note|see)|"
            r"Let me know|If not,|Do you want|Shall I|"
            r"Is there anything|Feel free|Don't hesitate|Happy to|"
            r"I hope this|I'd suggest|I would recommend|"
            r"Perfect!|Great!|Sure!|Absolutely!|"
            r"Your summary|The summary|This summary|Overall,|"
            r"Note:|Note that|However,\s|In summary,|To summarize,|"
            r"To adhere strictly|Since you've asked|Given that you want|"
            r"For clarity and to finalize|Since none of these|"
            r"The provided structured findings)",
            re.IGNORECASE,
        )

        # Only search past the first 100 chars to avoid false positives
        # in the actual summary content.
        match = chatter.search(text, 100)
        if not match:
            return text

        # Only strip if no section header appears after the chatter —
        # if there is one, the "chatter" text is likely inside a
        # legitimate section.
        section_re = re.compile(
            r"\n\s*(?:Title|Executive Summary|Key Decisions|Action Items|"
            r"Discussion Highlights|Open Questions)\s*:",
            re.IGNORECASE,
        )
        if section_re.search(text, match.start()):
            return text

        logger.warning(
            "Stripping trailing chatter at pos %d (%r…)",
            match.start(),
            text[match.start() : match.start() + 40],
        )
        return text[: match.start()].rstrip()

    @staticmethod
    def _is_valid_summary(text: str) -> bool:
        """Check whether text looks like a usable narrative summary."""
        if not text or len(text) < 30:
            return False
        # Reject responses that are clearly code rather than prose
        if re.match(
            r"^\s*(def |class |import |from |function |const |let |var )",
            text,
        ):
            return False
        # Reject responses containing markdown code fences — the LLM
        # returned JSON/code blocks instead of prose narrative
        if "```" in text:
            return False
        # Reject responses that embed raw JSON objects (e.g. {"Title": ...})
        if re.search(r'\{\s*"[A-Za-z]', text):
            return False
        return True

    @staticmethod
    def _build_fallback_summary(aggregated: AggregatedResults) -> str:
        """Build a brief prose overview from the structured extraction results.

        Called when the LLM refinement step fails to produce usable prose.
        Returns 1-2 sentences summarising participants, topics, and counts
        of extracted items.  No headings or bullet lists — the structured
        fields (action items, decisions, key points) are rendered separately
        by the frontend.
        """
        parts: List[str] = []

        # Opening: participants + topics
        who = ", ".join(aggregated.participants) if aggregated.participants else None
        topics = ", ".join(aggregated.topics[:3]) if aggregated.topics else None

        if who and topics:
            parts.append(f"A meeting involving {who} covered {topics}.")
        elif who:
            parts.append(f"A meeting involving {who}.")
        elif topics:
            parts.append(f"A meeting covered {topics}.")
        else:
            parts.append("Meeting summary.")

        # Counts sentence
        counts: List[str] = []
        if aggregated.key_points:
            counts.append(f"{len(aggregated.key_points)} key discussion point{'s' if len(aggregated.key_points) != 1 else ''}")
        if aggregated.decisions:
            counts.append(f"{len(aggregated.decisions)} decision{'s' if len(aggregated.decisions) != 1 else ''}")
        if aggregated.action_items:
            counts.append(f"{len(aggregated.action_items)} action item{'s' if len(aggregated.action_items) != 1 else ''}")

        if counts:
            parts.append(f"The discussion produced {', '.join(counts)}.")

        return " ".join(parts)


# ---------------------------------------------------------------------------
# Pipeline facade
# ---------------------------------------------------------------------------


class ChunkingPipeline:
    """High-level orchestrator for the chunk-map-reduce-refine pipeline."""

    def __init__(
        self,
        backend: LLMBackend,
        config: Optional[PipelineConfig] = None,
    ) -> None:
        """
        Initialize the chunking pipeline.

        Args:
            backend: LLM backend for text generation.
            config: Pipeline configuration (uses defaults if not provided).
        """
        self.config = config or PipelineConfig()
        self.backend = backend
        self.prompts = PromptRegistry()
        self.chunker = TranscriptChunker(self.config)
        self.analyser = ChunkAnalyser(backend, self.prompts, self.config)
        self.deduplicator = Deduplicator(self.config.similarity_threshold)
        self.aggregator = ResultAggregator(self.deduplicator)
        self.refiner = Refiner(backend, self.prompts, self.config)

    def process(
        self,
        text: str,
        analysis_type: str = "full",
        skip_refinement: bool = False,
        system_prompt: Optional[str] = None,
        prompt_templates: Optional[Dict[str, str]] = None,
        temperature_extract: Optional[float] = None,
        temperature_refine: Optional[float] = None,
        top_p: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Process a transcript through the full pipeline.

        Args:
            text: The transcript text to analyze.
            analysis_type: Type of analysis (for metadata).
            skip_refinement: If True, skip the final refinement pass.
            system_prompt: Custom system prompt override (None = use defaults).
            prompt_templates: Custom prompt templates override (None = use defaults).
            temperature_extract: Override extraction temperature (None = use config default).
            temperature_refine: Override refinement temperature (None = use config default).
            top_p: Override top-p sampling (None = use config default).
            max_tokens: Override max completion tokens (None = use config default).

        Returns:
            Dictionary with structured results and metadata.
        """
        start_time = time.monotonic()

        # Apply per-request config overrides (restored in finally block)
        original_config_values: Dict[str, Any] = {}
        if temperature_extract is not None:
            original_config_values['temperature_extract'] = self.config.temperature_extract
            self.config.temperature_extract = temperature_extract
        if temperature_refine is not None:
            original_config_values['temperature_refine'] = self.config.temperature_refine
            self.config.temperature_refine = temperature_refine
        if top_p is not None:
            original_config_values['top_p'] = self.config.top_p
            self.config.top_p = top_p
        if max_tokens is not None:
            original_config_values['completion_tokens'] = self.config.completion_tokens
            self.config.completion_tokens = max_tokens

        # Apply custom prompt overrides if provided
        original_prompts = self.prompts
        if system_prompt or prompt_templates:
            overridden = PromptRegistry.from_overrides(
                base_prompt=system_prompt,
                templates=prompt_templates,
                fallback=self.prompts,
            )
            self.analyser.prompts = overridden
            self.refiner.prompts = overridden

        try:
            # Chunk the transcript
            chunks = self.chunker.chunk(text)
            logger.info(f"Processing {len(chunks)} chunks")

            # Analyze each chunk
            analyses = []
            for chunk in chunks:
                analysis = self.analyser.analyse(chunk)
                analyses.append(analysis)
                logger.debug(
                    f"Chunk {chunk.metadata['chunk_id']}: "
                    f"{len(analysis.action_items)} actions, "
                    f"{len(analysis.decisions)} decisions"
                )

            # Aggregate results
            aggregated = self.aggregator.aggregate(analyses)

            # Optional refinement pass
            narrative = ""
            if not skip_refinement:
                # Check if there's meaningful content to summarize
                has_content = (
                    len(aggregated.action_items) > 0 or
                    len(aggregated.decisions) > 0 or
                    len(aggregated.key_points) > 0 or
                    len(aggregated.participants) > 0
                )

                if has_content:
                    narrative = self.refiner.refine(aggregated)
                else:
                    narrative = "This transcript does not contain sufficient meeting content to generate a summary."

            total_time = time.monotonic() - start_time

            return {
                "result": {
                    "summary": narrative,
                    "action_items": aggregated.action_items,
                    "decisions": aggregated.decisions,
                    "key_points": aggregated.key_points,
                    "participants": aggregated.participants,
                    "topics_discussed": aggregated.topics,
                    "processing_stats": {
                        **aggregated.processing_stats,
                        "total_time_seconds": total_time,
                    },
                },
                "result_is_text": False,
                "analysis_type": analysis_type,
                "backend": "llamacpp",
                "timestamp": time.time(),
            }
        finally:
            # Restore default prompts
            self.analyser.prompts = original_prompts
            self.refiner.prompts = original_prompts
            # Restore original config values
            for key, value in original_config_values.items():
                setattr(self.config, key, value)


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def create_pipeline(
    backend: LLMBackend,
    config: Optional[PipelineConfig] = None,
) -> ChunkingPipeline:
    """
    Create a configured chunking pipeline.

    Args:
        backend: LLM backend instance (e.g., LlamaCppBackend).
        config: Pipeline configuration.

    Returns:
        Configured ChunkingPipeline instance.
    """
    return ChunkingPipeline(
        backend=backend,
        config=config,
    )
