#!/bin/bash
#
# Monitor memory usage during transcription
# Usage: ./scripts/monitor-transcription-memory.sh [audio_file]
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TRANSCRIPTION_DIR="$PROJECT_DIR/src/main/transcription"
CLI_PATH="$TRANSCRIPTION_DIR/cli.py"
VENV_PYTHON="$TRANSCRIPTION_DIR/.venv/bin/python"
INPUT_FILE="${1:-$PROJECT_DIR/tests/fixtures/audio/long_english.wav}"
INTERVAL=1
MEMORY_LIMIT_MB=4096  # 4GB

# Set LD_LIBRARY_PATH for NVIDIA cuDNN libraries (pip package location)
CUDNN_LIB="$TRANSCRIPTION_DIR/.venv/lib/python3.12/site-packages/nvidia/cudnn/lib"
if [ -d "$CUDNN_LIB" ]; then
    export LD_LIBRARY_PATH="$CUDNN_LIB:$LD_LIBRARY_PATH"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "  Transcription Memory Monitor"
echo "=========================================="
echo ""

if [ ! -f "$INPUT_FILE" ]; then
    echo -e "${RED}Error: Input file not found: $INPUT_FILE${NC}"
    echo ""
    echo "Usage: $0 [audio_file]"
    echo ""
    echo "Example:"
    echo "  $0 tests/fixtures/audio/short_english.wav"
    exit 1
fi

if [ ! -f "$VENV_PYTHON" ]; then
    echo -e "${RED}Error: Python venv not found at $VENV_PYTHON${NC}"
    exit 1
fi

echo "Input: $INPUT_FILE"
echo "Memory limit: ${MEMORY_LIMIT_MB} MB"
echo ""

# Start transcription in background
echo "Starting transcription..."
$VENV_PYTHON "$CLI_PATH" transcribe --input "$INPUT_FILE" > /tmp/transcription_result.json 2>&1 &
CLI_PID=$!

# Wait for process to start
sleep 1

# Find the Python process
PYTHON_PID=$CLI_PID

if [ ! -d "/proc/$PYTHON_PID" ]; then
    echo -e "${YELLOW}Warning: Process exited quickly, may have completed already${NC}"
    wait $CLI_PID 2>/dev/null || true
    if [ -f /tmp/transcription_result.json ]; then
        echo ""
        echo "Transcription result:"
        cat /tmp/transcription_result.json | jq -r '.processing_time_s' 2>/dev/null && echo "s processing time"
    fi
    exit 0
fi

echo "PID: $PYTHON_PID"
echo ""
echo "Time(s)  RSS(MB)  VMS(MB)  Status"
echo "-------  -------  -------  ------"

START_TIME=$(date +%s)
PEAK_RSS=0
SAMPLES=0

while kill -0 $CLI_PID 2>/dev/null; do
    CURRENT_TIME=$(($(date +%s) - START_TIME))

    if [ -f /proc/$PYTHON_PID/status ]; then
        RSS=$(grep VmRSS /proc/$PYTHON_PID/status 2>/dev/null | awk '{print $2}' || echo "0")
        VMS=$(grep VmSize /proc/$PYTHON_PID/status 2>/dev/null | awk '{print $2}' || echo "0")

        if [ -n "$RSS" ] && [ "$RSS" != "0" ]; then
            RSS_MB=$((RSS / 1024))
            VMS_MB=$((VMS / 1024))

            if [ $RSS_MB -gt $PEAK_RSS ]; then
                PEAK_RSS=$RSS_MB
            fi

            STATUS=""
            if [ $RSS_MB -gt $MEMORY_LIMIT_MB ]; then
                STATUS="${RED}OVER LIMIT${NC}"
            elif [ $RSS_MB -gt $((MEMORY_LIMIT_MB * 75 / 100)) ]; then
                STATUS="${YELLOW}HIGH${NC}"
            else
                STATUS="${GREEN}OK${NC}"
            fi

            printf "%7d  %7d  %7d  " $CURRENT_TIME $RSS_MB $VMS_MB
            echo -e "$STATUS"
            ((SAMPLES++))
        fi
    fi

    sleep $INTERVAL
done

# Wait for process to complete
wait $CLI_PID 2>/dev/null
EXIT_CODE=$?

echo ""
echo "=========================================="
echo "  Memory Monitor Summary"
echo "=========================================="
echo ""
echo "Duration: $(($(date +%s) - START_TIME)) seconds"
echo "Peak RSS: ${PEAK_RSS} MB"
echo "Samples: ${SAMPLES}"
echo ""

if [ $PEAK_RSS -lt $MEMORY_LIMIT_MB ]; then
    echo -e "${GREEN}PASS${NC}: Memory stayed under ${MEMORY_LIMIT_MB}MB limit"
    MEMORY_PASS=0
else
    echo -e "${RED}FAIL${NC}: Memory exceeded ${MEMORY_LIMIT_MB}MB limit"
    MEMORY_PASS=1
fi

# Show transcription result if available
if [ -f /tmp/transcription_result.json ]; then
    echo ""
    echo "Transcription completed:"
    processing_time=$(cat /tmp/transcription_result.json | jq -r '.processing_time_s' 2>/dev/null || echo "N/A")
    rtf=$(cat /tmp/transcription_result.json | jq -r '.rtf' 2>/dev/null || echo "N/A")
    echo "  Processing time: ${processing_time}s"
    echo "  RTF: ${rtf}"
fi

exit $MEMORY_PASS
