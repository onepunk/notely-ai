# Transcription Pipeline Benchmarks

This document records benchmark results from the transcription pipeline validation tests.

## Test Environment

| Component | Value                                    |
| --------- | ---------------------------------------- |
| Date      | YYYY-MM-DD                               |
| Commit    | `abc1234`                                |
| Model     | small (multilingual, 483 MB)             |
| Backend   | FasterWhisperBackend / MLXWhisperBackend |
| GPU       | NVIDIA RTX 4090 / Apple M3 Max           |
| VRAM      | 24 GB / 36 GB Unified                    |
| VAD       | Silero-VAD (enabled)                     |

---

## Performance Results

### Processing Time

| Audio Duration | Processing Time | RTF  | Target | Status    |
| -------------- | --------------- | ---- | ------ | --------- |
| 30 seconds     | X.XX s          | 0.XX | < 5s   | PASS/FAIL |
| 5 minutes      | X.XX s          | 0.XX | < 30s  | PASS/FAIL |
| 15 minutes     | X.XX s          | 0.XX | < 60s  | PASS/FAIL |

**RTF (Real-Time Factor)** = processing_time / audio_duration

- RTF < 0.1 indicates O(1) complexity (constant time regardless of audio length)
- RTF > 0.1 may indicate O(n) complexity (linear growth with audio length)

### Memory Usage

| Metric       | Value         | Target    | Status    |
| ------------ | ------------- | --------- | --------- |
| Peak RSS     | XXXX MB       | < 4096 MB | PASS/FAIL |
| Steady State | XXXX MB       | -         | -         |
| Growth Rate  | Flat / Linear | Flat      | -         |

### VAD Efficiency

| Audio Type           | Original Duration | After VAD | Reduction |
| -------------------- | ----------------- | --------- | --------- |
| Meeting with pauses  | XX:XX             | XX:XX     | XX%       |
| Continuous speech    | XX:XX             | XX:XX     | XX%       |
| Silence-heavy (50%+) | XX:XX             | XX:XX     | XX%       |

**Expected reduction:**

- Speech-dense content: 20-30% reduction
- Typical meetings: 40-60% reduction
- Presentation with pauses: 60-80% reduction

---

## Multilingual Accuracy (WER)

Word Error Rate (WER) measures transcription accuracy:

- WER = (Substitutions + Insertions + Deletions) / Reference Words

| Language | WER  | Target | Status    |
| -------- | ---- | ------ | --------- |
| English  | X.X% | < 5%   | PASS/FAIL |
| French   | X.X% | < 15%  | PASS/FAIL |
| German   | X.X% | < 15%  | PASS/FAIL |
| Spanish  | X.X% | < 15%  | PASS/FAIL |

### WER Reference Sources

- English: LibriSpeech dev-clean subset
- French: Mozilla Common Voice validated set
- German: Mozilla Common Voice validated set
- Spanish: Mozilla Common Voice validated set

---

## Benchmark Consistency

Multiple iterations to check for variance:

| Iteration   | Processing Time | RTF  |
| ----------- | --------------- | ---- |
| 1           | X.XX s          | 0.XX |
| 2           | X.XX s          | 0.XX |
| 3           | X.XX s          | 0.XX |
| **Average** | X.XX s          | 0.XX |
| **Std Dev** | X.XX s          | -    |

**Variance ratio** = std_dev / average

- Target: < 0.2 (less than 20% variance)

---

## Historical Comparison

| Date       | Model    | Backend        | 30s RTF | 15min RTF | Peak Memory |
| ---------- | -------- | -------------- | ------- | --------- | ----------- |
| YYYY-MM-DD | small.en | faster-whisper | 0.XX    | 0.XX      | XXXX MB     |
| YYYY-MM-DD | small    | faster-whisper | 0.XX    | 0.XX      | XXXX MB     |

---

## Running Benchmarks

```bash
# Full validation suite
npm run validate:transcription

# Memory monitoring during long transcription
npm run validate:transcription:memory tests/fixtures/audio/long_english.wav

# Quick health check
npm run test:transcription:health

# Single benchmark with iterations
npm run test:transcription:benchmark

# Calculate WER for a specific transcription
npm run validate:transcription:wer -- -r reference.txt -h result.json
```

---

## Test Fixtures Required

See `tests/fixtures/audio/README.md` for how to obtain test audio files:

| File                 | Duration | Purpose                    |
| -------------------- | -------- | -------------------------- |
| `short_english.wav`  | 30s      | Basic performance test     |
| `long_english.wav`   | 15min    | O(1) latency validation    |
| `silence_gaps.wav`   | 30s+     | VAD efficiency test        |
| `french_sample.wav`  | 30s      | French language detection  |
| `german_sample.wav`  | 30s      | German language detection  |
| `spanish_sample.wav` | 30s      | Spanish language detection |

---

## Notes

- Benchmarks should be run on a clean system with no other GPU workloads
- First run may be slower due to model loading (warm-up)
- Memory measurements require `/proc` filesystem (Linux)
- macOS memory monitoring uses different methods
