/* ---------------------------------------------------------------------
   Applied Concepts — Shottimer AudioWorklet processor.
   Runs on the audio rendering thread: sample-accurate onset detection
   for shots (high-pass -> peak/dead-time onset) and, while armed, a
   Goertzel filter tuned to the start-beep frequency so the beep and the
   shots are timestamped from the same input path (no cross-clock drift
   between "when we scheduled the beep" and "when the mic heard it").
   All timestamps are AudioWorkletGlobalScope `currentFrame` values —
   a monotonic sample counter shared with the main thread's
   AudioContext.currentTime * sampleRate, so frame differences convert
   straight to seconds via /sampleRate with no extra clock math.
--------------------------------------------------------------------- */
class ShottimerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.35;
    this.deadTimeSamples = Math.round(0.06 * sampleRate);
    this.lastShotFrame = -Infinity;
    this.hpPrevIn = 0;
    this.hpPrevOut = 0;
    this.hpAlpha = this._hpAlpha(700);

    this.beepFreq = 2800;
    this.beepCoeff = 2 * Math.cos((2 * Math.PI * this.beepFreq) / sampleRate);
    this.beepWindowSize = 256;
    this.beepBuf = new Float32Array(this.beepWindowSize);
    this.beepBufIdx = 0;
    this.beepArmed = false;
    this.beepDetectRatio = 5; // Goertzel bin energy vs. mean block energy

    this.mode = 'idle'; // 'idle' | 'listening'
    this.maskUntilFrame = -Infinity; // shot detection ignored before this frame (masks the beep itself)

    this.levelCounter = 0;
    this.peakSinceReport = 0;

    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _hpAlpha(cutoffHz) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    return rc / (rc + dt);
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'config':
        if (msg.threshold != null) this.threshold = msg.threshold;
        if (msg.deadTimeMs != null) this.deadTimeSamples = Math.round((msg.deadTimeMs / 1000) * sampleRate);
        if (msg.highpassHz != null) this.hpAlpha = this._hpAlpha(msg.highpassHz);
        if (msg.beepFreq != null) {
          this.beepFreq = msg.beepFreq;
          this.beepCoeff = 2 * Math.cos((2 * Math.PI * this.beepFreq) / sampleRate);
        }
        break;
      case 'setMode':
        this.mode = msg.mode;
        break;
      case 'armBeepDetection':
        this.beepArmed = true;
        this.beepBufIdx = 0;
        break;
      case 'maskUntil':
        this.maskUntilFrame = msg.frame;
        break;
      case 'reset':
        this.lastShotFrame = -Infinity;
        this.maskUntilFrame = -Infinity;
        this.beepArmed = false;
        this.mode = 'idle';
        break;
    }
  }

  _goertzelPower() {
    let s1 = 0, s2 = 0, energy = 0;
    for (let i = 0; i < this.beepWindowSize; i++) {
      const x = this.beepBuf[i];
      const s0 = x + this.beepCoeff * s1 - s2;
      s2 = s1; s1 = s0;
      energy += x * x;
    }
    const power = s1 * s1 + s2 * s2 - this.beepCoeff * s1 * s2;
    return { power, meanEnergy: energy / this.beepWindowSize };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    const blockStart = currentFrame;

    for (let i = 0; i < channel.length; i++) {
      const x = channel[i];
      const y = this.hpAlpha * (this.hpPrevOut + x - this.hpPrevIn);
      this.hpPrevIn = x;
      this.hpPrevOut = y;

      const absY = Math.abs(y);
      if (absY > this.peakSinceReport) this.peakSinceReport = absY;
      const frame = blockStart + i;

      if (this.beepArmed) {
        this.beepBuf[this.beepBufIdx++] = x;
        if (this.beepBufIdx >= this.beepWindowSize) {
          const { power, meanEnergy } = this._goertzelPower();
          this.beepBufIdx = 0;
          if (meanEnergy > 1e-7 && power / (meanEnergy * this.beepWindowSize) > this.beepDetectRatio) {
            this.port.postMessage({ type: 'beep', frame });
            this.beepArmed = false;
          }
        }
      }

      if (this.mode === 'listening' && frame >= this.maskUntilFrame) {
        if (absY > this.threshold && frame - this.lastShotFrame > this.deadTimeSamples) {
          this.lastShotFrame = frame;
          this.port.postMessage({ type: 'shot', frame, amplitude: absY });
        }
      }
    }

    this.levelCounter += channel.length;
    if (this.levelCounter >= sampleRate / 20) {
      this.port.postMessage({ type: 'level', peak: this.peakSinceReport, frame: blockStart });
      this.peakSinceReport = 0;
      this.levelCounter = 0;
    }
    return true;
  }
}
registerProcessor('shottimer-processor', ShottimerProcessor);
