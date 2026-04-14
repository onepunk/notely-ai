#!/bin/bash
#
# Transcription Pipeline Validation Script
# Validates that all production requirements are met
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  Transcription Pipeline Validation"
echo "=========================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TRANSCRIPTION_DIR="$PROJECT_DIR/src/main/transcription"
CLI_PATH="$TRANSCRIPTION_DIR/cli.py"
VENV_PYTHON="$TRANSCRIPTION_DIR/.venv/bin/python"
FIXTURES_DIR="$PROJECT_DIR/tests/fixtures/audio"

# Set LD_LIBRARY_PATH for NVIDIA cuDNN libraries (pip package location)
CUDNN_LIB="$TRANSCRIPTION_DIR/.venv/lib/python3.12/site-packages/nvidia/cudnn/lib"
if [ -d "$CUDNN_LIB" ]; then
    export LD_LIBRARY_PATH="$CUDNN_LIB:$LD_LIBRARY_PATH"
fi

# Validation results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

pass() {
    echo -e "${GREEN}PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

warn() {
    echo -e "${YELLOW}WARN${NC}: $1"
}

skip() {
    echo -e "${CYAN}SKIP${NC}: $1"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

# Check prerequisites
echo "=== Prerequisites ==="
echo ""

if [ ! -f "$CLI_PATH" ]; then
    fail "CLI not found at $CLI_PATH"
    exit 1
fi
pass "CLI found at $CLI_PATH"

if [ ! -f "$VENV_PYTHON" ]; then
    fail "Python venv not found at $VENV_PYTHON"
    exit 1
fi
pass "Python venv found"

# Health check
echo ""
echo "=== Health Check ==="
echo ""

if $VENV_PYTHON "$CLI_PATH" health > /dev/null 2>&1; then
    pass "Backend health check"
else
    fail "Backend health check - run 'npm run test:transcription:health' for details"
    exit 1
fi

# Test 1: Short audio processing time
echo ""
echo "=== Test 1: Short Audio Processing Time ==="
echo "Target: < 5s for 30s audio"
echo ""

SHORT_AUDIO="$FIXTURES_DIR/short_english.wav"
if [ -f "$SHORT_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" transcribe --input "$SHORT_AUDIO" 2>/dev/null)
    processing_time=$(echo "$result" | jq -r '.processing_time_s')
    rtf=$(echo "$result" | jq -r '.rtf')
    duration=$(echo "$result" | jq -r '.duration_s')

    echo "  Audio duration: ${duration}s"
    echo "  Processing time: ${processing_time}s"
    echo "  RTF: ${rtf}"
    echo ""

    if (( $(echo "$processing_time < 5" | bc -l) )); then
        pass "Short audio processed in ${processing_time}s (target: <5s)"
    else
        fail "Short audio took ${processing_time}s (target: <5s)"
    fi
else
    skip "short_english.wav not found - see tests/fixtures/audio/README.md"
fi

# Test 2: Long audio processing time (sliding window test)
echo ""
echo "=== Test 2: Long Audio Processing Time ==="
echo "Target: < 60s for 15min audio (O(1) processing)"
echo ""

LONG_AUDIO="$FIXTURES_DIR/long_english.wav"
if [ -f "$LONG_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" transcribe --input "$LONG_AUDIO" 2>/dev/null)
    processing_time=$(echo "$result" | jq -r '.processing_time_s')
    duration=$(echo "$result" | jq -r '.duration_s')
    rtf=$(echo "$result" | jq -r '.rtf')

    echo "  Audio duration: ${duration}s"
    echo "  Processing time: ${processing_time}s"
    echo "  RTF: ${rtf}"
    echo ""

    if (( $(echo "$processing_time < 60" | bc -l) )); then
        pass "Long audio processed in ${processing_time}s (target: <60s)"
    else
        fail "Long audio took ${processing_time}s (target: <60s)"
    fi

    # Check RTF for O(1) behavior
    if (( $(echo "$rtf < 0.1" | bc -l) )); then
        pass "RTF is ${rtf} (target: <0.1 for O(1) behavior)"
    else
        fail "RTF is ${rtf} (target: <0.1)"
    fi
else
    skip "long_english.wav not found - see tests/fixtures/audio/README.md"
fi

# Test 3: VAD efficiency
echo ""
echo "=== Test 3: VAD Efficiency ==="
echo "Target: 50%+ audio reduction on silence-heavy content"
echo ""

SILENCE_AUDIO="$FIXTURES_DIR/silence_gaps.wav"
if [ -f "$SILENCE_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" transcribe --input "$SILENCE_AUDIO" 2>/dev/null)
    vad_reduction=$(echo "$result" | jq -r '.vad_reduction_pct // 0')
    vad_enabled=$(echo "$result" | jq -r '.vad_enabled')

    echo "  VAD enabled: ${vad_enabled}"
    echo "  VAD reduction: ${vad_reduction}%"
    echo ""

    if [ "$vad_enabled" != "true" ]; then
        warn "VAD is disabled"
    elif (( $(echo "$vad_reduction > 50" | bc -l) )); then
        pass "VAD reduced audio by ${vad_reduction}% (target: >50%)"
    else
        warn "VAD reduction was ${vad_reduction}% (target: >50% for silence-heavy audio)"
    fi
else
    skip "silence_gaps.wav not found - see tests/fixtures/audio/README.md"
fi

# Test 4: Multilingual - French
echo ""
echo "=== Test 4: French Transcription ==="
echo ""

FRENCH_AUDIO="$FIXTURES_DIR/french_sample.wav"
if [ -f "$FRENCH_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" transcribe --input "$FRENCH_AUDIO" 2>/dev/null)
    language=$(echo "$result" | jq -r '.language')
    text_length=$(echo "$result" | jq -r '.text | length')

    echo "  Detected language: $language"
    echo "  Text length: ${text_length} chars"
    echo ""

    if [ "$language" == "fr" ]; then
        pass "French language detected correctly"
    else
        fail "Expected 'fr', got '$language'"
    fi
else
    skip "french_sample.wav not found - see tests/fixtures/audio/README.md"
fi

# Test 5: Multilingual - German
echo ""
echo "=== Test 5: German Transcription ==="
echo ""

GERMAN_AUDIO="$FIXTURES_DIR/german_sample.wav"
if [ -f "$GERMAN_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" transcribe --input "$GERMAN_AUDIO" 2>/dev/null)
    language=$(echo "$result" | jq -r '.language')

    echo "  Detected language: $language"
    echo ""

    if [ "$language" == "de" ]; then
        pass "German language detected correctly"
    else
        fail "Expected 'de', got '$language'"
    fi
else
    skip "german_sample.wav not found - see tests/fixtures/audio/README.md"
fi

# Test 6: Multilingual - Spanish
echo ""
echo "=== Test 6: Spanish Transcription ==="
echo ""

SPANISH_AUDIO="$FIXTURES_DIR/spanish_sample.wav"
if [ -f "$SPANISH_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" transcribe --input "$SPANISH_AUDIO" 2>/dev/null)
    language=$(echo "$result" | jq -r '.language')

    echo "  Detected language: $language"
    echo ""

    if [ "$language" == "es" ]; then
        pass "Spanish language detected correctly"
    else
        fail "Expected 'es', got '$language'"
    fi
else
    skip "spanish_sample.wav not found - see tests/fixtures/audio/README.md"
fi

# Test 7: Benchmark consistency
echo ""
echo "=== Test 7: Benchmark Consistency ==="
echo "Running 3 iterations..."
echo ""

if [ -f "$SHORT_AUDIO" ]; then
    result=$($VENV_PYTHON "$CLI_PATH" benchmark --input "$SHORT_AUDIO" --iterations 3 2>/dev/null)
    avg_time=$(echo "$result" | jq -r '.avg_time_s')
    std_time=$(echo "$result" | jq -r '.std_time_s')
    min_time=$(echo "$result" | jq -r '.min_time_s')
    max_time=$(echo "$result" | jq -r '.max_time_s')

    echo "  Average time: ${avg_time}s"
    echo "  Std deviation: ${std_time}s"
    echo "  Min/Max: ${min_time}s / ${max_time}s"
    echo ""

    # Check consistency (std should be < 20% of avg)
    if (( $(echo "$avg_time > 0" | bc -l) )); then
        variance_ratio=$(echo "scale=4; $std_time / $avg_time" | bc -l)
        if (( $(echo "$variance_ratio < 0.2" | bc -l) )); then
            pass "Processing time is consistent (variance ratio: ${variance_ratio})"
        else
            warn "Processing time variance is high: ${variance_ratio}"
        fi
    fi
else
    skip "Benchmark skipped - short_english.wav not found"
fi

# Test 8: Backend info
echo ""
echo "=== Test 8: Backend Information ==="
echo ""

result=$($VENV_PYTHON "$CLI_PATH" health 2>/dev/null | grep -A 3 "Active Backend:" || true)
if [ -n "$result" ]; then
    echo "$result"
    echo ""
    pass "Backend information available"
else
    warn "Could not retrieve backend information"
fi

# Summary
echo ""
echo "=========================================="
echo "  Validation Summary"
echo "=========================================="
echo -e "  ${GREEN}Passed${NC}: $TESTS_PASSED"
echo -e "  ${RED}Failed${NC}: $TESTS_FAILED"
echo -e "  ${CYAN}Skipped${NC}: $TESTS_SKIPPED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    if [ $TESTS_SKIPPED -gt 0 ]; then
        echo -e "${YELLOW}Validation passed with skipped tests.${NC}"
        echo "Add audio fixtures to tests/fixtures/audio/ for complete validation."
        exit 0
    else
        echo -e "${GREEN}All validations passed!${NC}"
        exit 0
    fi
else
    echo -e "${RED}Some validations failed.${NC}"
    exit 1
fi
