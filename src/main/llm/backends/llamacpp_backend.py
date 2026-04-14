"""
LLM Backend implementations for Notely Standalone.

Provides an abstract interface for LLM inference and a concrete implementation
using llama-cpp-python for local GGUF model execution.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional
import logging
import gc
import re

logger = logging.getLogger(__name__)


@dataclass
class GenerationConfig:
    """Configuration for text generation."""
    max_tokens: int = 900
    temperature: float = 0.3
    top_p: float = 0.9
    stop_sequences: Optional[List[str]] = None
    repeat_penalty: float = 1.1


class LLMBackend(ABC):
    """Abstract base class for LLM backends."""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None,
    ) -> str:
        """
        Generate text completion for the given prompt.

        Args:
            prompt: The input prompt to generate from.
            config: Optional generation configuration.

        Returns:
            Generated text completion.
        """
        pass

    @abstractmethod
    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        pass

    @abstractmethod
    def unload(self) -> None:
        """Unload the current model and free resources."""
        pass

    @abstractmethod
    def get_context_length(self) -> int:
        """Get the model's maximum context length in tokens."""
        pass

    def estimate_tokens(self, text: str, chars_per_token: float = 4.0) -> int:
        """
        Estimate the number of tokens in text.

        Args:
            text: Text to estimate tokens for.
            chars_per_token: Average characters per token (default 4.0).

        Returns:
            Estimated token count.
        """
        if not text:
            return 0
        return max(1, int(len(text) / chars_per_token))


class LlamaCppBackend(LLMBackend):
    """
    LLM backend using llama-cpp-python for local GGUF model inference.

    Supports both CUDA (NVIDIA) and Metal (Apple Silicon) acceleration.
    """

    def __init__(
        self,
        model_path: str,
        n_gpu_layers: int = -1,
        n_ctx: int = 4096,
        n_threads: Optional[int] = None,
        verbose: bool = False,
    ):
        """
        Initialize the llama.cpp backend.

        Args:
            model_path: Path to the GGUF model file.
            n_gpu_layers: Number of layers to offload to GPU (-1 for all).
            n_ctx: Context window size in tokens.
            n_threads: Number of CPU threads (None for auto).
            verbose: Whether to enable verbose logging from llama.cpp.
        """
        self.model_path = model_path
        self.n_gpu_layers = n_gpu_layers
        self.n_ctx = n_ctx
        self.n_threads = n_threads
        self.verbose = verbose
        self._llm = None

        self._load_model()

    @staticmethod
    def check_gpu_available() -> bool:
        """Check if GPU offload is supported by the installed llama-cpp-python build."""
        try:
            from llama_cpp import llama_cpp as _lib
            return bool(_lib.llama_supports_gpu_offload())
        except Exception:
            return False

    def _load_model(self) -> None:
        """Load the model from disk. Requires GPU — raises if unavailable."""
        try:
            from llama_cpp import Llama, llama_cpp as _lib

            # GPU is mandatory — refuse to load on CPU-only builds
            if not _lib.llama_supports_gpu_offload():
                import platform
                if platform.system() == "Darwin":
                    hint = (
                        "Reinstall llama-cpp-python with Metal support: "
                        'CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python'
                    )
                else:
                    hint = (
                        "Reinstall llama-cpp-python with CUDA support: "
                        "pip install llama-cpp-python --extra-index-url "
                        "https://abetlen.github.io/llama-cpp-python/whl/cu124"
                    )
                raise RuntimeError(
                    f"GPU acceleration is required but not available. {hint}"
                )

            logger.info(f"Loading model from {self.model_path}")
            logger.info(f"GPU layers: {self.n_gpu_layers}, context: {self.n_ctx}")

            self._llm = Llama(
                model_path=self.model_path,
                n_gpu_layers=self.n_gpu_layers,
                n_ctx=self.n_ctx,
                n_threads=self.n_threads,
                verbose=self.verbose,
                # Use chat format for instruction-tuned models
                chat_format="llama-2",
            )

            logger.info("Model loaded successfully (GPU offload active)")

        except ImportError as e:
            logger.error(f"llama-cpp-python not installed: {e}")
            raise RuntimeError(
                "llama-cpp-python is required. Install with CUDA support: "
                "pip install llama-cpp-python --extra-index-url "
                "https://abetlen.github.io/llama-cpp-python/whl/cu124"
            ) from e
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise RuntimeError(f"Failed to load model from {self.model_path}: {e}") from e

    def generate(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None,
    ) -> str:
        """
        Generate text completion using the loaded model.

        Args:
            prompt: The input prompt.
            config: Optional generation configuration.

        Returns:
            Generated text.
        """
        if not self._llm:
            raise RuntimeError("No model loaded")

        if not prompt:
            return ""

        cfg = config or GenerationConfig()

        # Ensure we don't exceed context
        prompt_tokens = self.estimate_tokens(prompt)
        available_tokens = self.n_ctx - prompt_tokens - 16  # Safety margin

        if available_tokens <= 0:
            logger.error(
                f"Prompt too long: ~{prompt_tokens} tokens, context is {self.n_ctx}"
            )
            return ""

        max_tokens = min(cfg.max_tokens, available_tokens)

        try:
            # Use chat completion format for instruction-tuned models
            response = self._llm.create_chat_completion(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=cfg.temperature,
                top_p=cfg.top_p,
                repeat_penalty=cfg.repeat_penalty,
                stop=cfg.stop_sequences or ["</s>", "\n\n\n"],
            )

            # Extract the generated text
            if response and "choices" in response and len(response["choices"]) > 0:
                message = response["choices"][0].get("message", {})
                content = message.get("content", "")
                return self._clean_output(content) if content else ""

            logger.warning("Empty response from model")
            return ""

        except Exception as e:
            logger.error(f"Generation failed: {e}")
            raise RuntimeError(f"Text generation failed: {e}") from e

    @staticmethod
    def _clean_output(text: str) -> str:
        """Strip chat-format artifacts ([INST], [/INST], <<SYS>>, etc.) from model output."""
        cleaned = text
        # Remove [INST]...[/INST] blocks that the model may echo back
        cleaned = re.sub(r"\[/?INST\]", "", cleaned)
        # Remove <<SYS>>...<</ SYS>> blocks
        cleaned = re.sub(r"<<?/?SYS>?>", "", cleaned)
        # Collapse runs of blank lines left behind
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()

    def generate_raw(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None,
    ) -> str:
        """
        Generate text completion using raw completion (non-chat) format.

        Useful for models that work better with raw prompts.

        Args:
            prompt: The input prompt.
            config: Optional generation configuration.

        Returns:
            Generated text.
        """
        if not self._llm:
            raise RuntimeError("No model loaded")

        if not prompt:
            return ""

        cfg = config or GenerationConfig()

        prompt_tokens = self.estimate_tokens(prompt)
        available_tokens = self.n_ctx - prompt_tokens - 16

        if available_tokens <= 0:
            logger.error(
                f"Prompt too long: ~{prompt_tokens} tokens, context is {self.n_ctx}"
            )
            return ""

        max_tokens = min(cfg.max_tokens, available_tokens)

        try:
            response = self._llm(
                prompt,
                max_tokens=max_tokens,
                temperature=cfg.temperature,
                top_p=cfg.top_p,
                repeat_penalty=cfg.repeat_penalty,
                stop=cfg.stop_sequences or ["```", "\n\n\n"],
            )

            if response and "choices" in response and len(response["choices"]) > 0:
                text = response["choices"][0].get("text", "")
                return text.strip() if text else ""

            return ""

        except Exception as e:
            logger.error(f"Raw generation failed: {e}")
            raise RuntimeError(f"Text generation failed: {e}") from e

    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        return self._llm is not None

    def unload(self) -> None:
        """Unload the model and free GPU/CPU memory."""
        if self._llm:
            logger.info("Unloading model")
            del self._llm
            self._llm = None

            # Force garbage collection to free memory
            gc.collect()

            # Try to clear CUDA cache if available
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    logger.info("Cleared CUDA cache")
            except ImportError:
                pass  # torch not available, that's fine

            logger.info("Model unloaded")

    def get_context_length(self) -> int:
        """Get the model's context length."""
        return self.n_ctx

    def get_model_info(self) -> dict:
        """Get information about the loaded model."""
        return {
            "model_path": self.model_path,
            "n_gpu_layers": self.n_gpu_layers,
            "n_ctx": self.n_ctx,
            "n_threads": self.n_threads,
            "loaded": self.is_loaded(),
        }

    def __del__(self):
        """Cleanup on destruction."""
        self.unload()
