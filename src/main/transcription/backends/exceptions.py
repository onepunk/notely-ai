"""
Custom exceptions for transcription backends.
"""


class TranscriptionBackendError(Exception):
    """Base exception for transcription backend errors."""

    pass


class NoCompatibleGPUError(TranscriptionBackendError):
    """
    Raised when no compatible GPU is available for transcription.

    This error is raised when:
    - NVIDIA backend: No CUDA device or cuDNN is not available
    - Apple backend: Not running on macOS with Apple Silicon

    CPU fallback is intentionally NOT supported due to performance requirements.
    Real-time transcription requires GPU acceleration.
    """

    def __init__(self, message: str, backend_type: str = "unknown"):
        self.backend_type = backend_type
        super().__init__(message)


class ModelLoadError(TranscriptionBackendError):
    """
    Raised when a model fails to load.

    This can happen due to:
    - Invalid model name
    - Insufficient GPU memory
    - Corrupted model files
    - Missing dependencies
    """

    def __init__(self, message: str, model_name: str = "unknown"):
        self.model_name = model_name
        super().__init__(message)


class TranscriptionError(TranscriptionBackendError):
    """
    Raised when transcription fails.

    This can happen due to:
    - Invalid audio format
    - GPU memory exhaustion during inference
    - Model not loaded
    """

    pass


class BackendNotImplementedError(TranscriptionBackendError):
    """
    Raised when a backend method is not yet implemented.

    Used for stub implementations (e.g., MLX backend before macOS testing).
    """

    def __init__(self, backend_type: str, method: str):
        self.backend_type = backend_type
        self.method = method
        super().__init__(
            f"{backend_type} backend: {method}() is not yet implemented. "
            f"This backend requires testing on the target platform."
        )
