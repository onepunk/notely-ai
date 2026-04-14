/**
 * AudioWorklet processor for transcription recording.
 * Downsamples incoming audio to 16kHz and sends frames to the main thread.
 *
 * NOTE: This is the compiled JavaScript version of transcriptionRecorder.worklet.ts.
 *       Placed in public/ so Vite copies it as-is to the build output, avoiding
 *       the data: URL MIME type issue that breaks addModule() in file:// contexts.
 */

const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_BUFFER_SAMPLES = 1920; // ~120ms at 16kHz after downsampling

class TranscriptionRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._portRef = this.port;
    this._inputSampleRate = sampleRate || TARGET_SAMPLE_RATE;
    this._ratio = Math.max(1, this._inputSampleRate / TARGET_SAMPLE_RATE);
    // Maintain a rolling buffer large enough to hold several frames before flush
    const capacity = Math.ceil(DEFAULT_BUFFER_SAMPLES * this._ratio * 2);
    this._buffer = new Float32Array(capacity);
    this._bufferedSamples = 0;
    // Diagnostic counters
    this._processCallCount = 0;
    this._emptyInputCount = 0;
    this._emptyChannelCount = 0;
    this._lastDiagTime = currentTime;
  }

  process(inputs) {
    this._processCallCount++;

    // Periodic diagnostic (every ~2 seconds of audio time)
    if (currentTime - this._lastDiagTime >= 2.0) {
      this._portRef.postMessage({
        type: 'diag',
        processCalls: this._processCallCount,
        emptyInputs: this._emptyInputCount,
        emptyChannels: this._emptyChannelCount,
        bufferedSamples: this._bufferedSamples,
        sampleRate: sampleRate,
        ratio: this._ratio,
        currentTime: currentTime,
      });
      this._lastDiagTime = currentTime;
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      this._emptyInputCount++;
      return true;
    }

    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      this._emptyChannelCount++;
      return true;
    }

    // Append incoming samples to our rolling buffer
    this._appendToBuffer(channelData);

    // Downsample and flush while we have enough data
    while (this._bufferedSamples >= this._ratio) {
      const frameLength = Math.min(
        DEFAULT_BUFFER_SAMPLES,
        Math.floor(this._bufferedSamples / this._ratio)
      );
      if (frameLength <= 0) break;

      const downsampled = new Float32Array(frameLength);
      for (let i = 0; i < frameLength; i += 1) {
        const sampleIndex = i * this._ratio;
        const lowIndex = Math.floor(sampleIndex);
        const highIndex = Math.min(this._bufferedSamples - 1, lowIndex + 1);
        const frac = sampleIndex - lowIndex;
        const sample =
          this._buffer[lowIndex] + (this._buffer[highIndex] - this._buffer[lowIndex]) * frac;
        downsampled[i] = sample;
      }

      this._portRef.postMessage(downsampled.buffer, [downsampled.buffer]);
      this._consumeFromBuffer(Math.ceil(frameLength * this._ratio));
    }

    return true;
  }

  _appendToBuffer(data) {
    const available = this._buffer.length - this._bufferedSamples;
    if (available < data.length) {
      // Shift existing data to make room
      const shift = data.length - available;
      if (shift < this._bufferedSamples) {
        this._buffer.copyWithin(0, shift, this._bufferedSamples);
        this._bufferedSamples -= shift;
      } else {
        this._bufferedSamples = 0;
      }
    }
    this._buffer.set(data, this._bufferedSamples);
    this._bufferedSamples += data.length;
  }

  _consumeFromBuffer(count) {
    if (count <= 0) {
      return;
    }
    if (count >= this._bufferedSamples) {
      this._bufferedSamples = 0;
      return;
    }
    this._buffer.copyWithin(0, count, this._bufferedSamples);
    this._bufferedSamples -= count;
  }
}

registerProcessor('transcription-recorder', TranscriptionRecorderProcessor);
