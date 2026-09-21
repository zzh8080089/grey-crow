"use strict";

// The worklet bounds capture independently of throttled Renderer timers.
class GreyCrowPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(1600);
    this.used = 0;
    this.count = 0;
    this.sourcePosition = 0;
    this.nextPosition = 0;
    this.previous = 0;
    this.done = false;
    this.port.onmessage = ({ data }) => { if (data === "stop") this.finish(false); };
  }
  flush() {
    if (!this.used) return;
    const chunk = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: "samples", samples: chunk }, [chunk.buffer]);
    this.used = 0;
  }
  finish(limit) {
    if (this.done) return;
    this.done = true;
    this.flush();
    this.port.postMessage({ type: "stopped", limit });
  }
  process(inputs) {
    if (this.done) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      sample /= channels.length;
      // Interpolate a continuous 16 kHz stream when a device ignores the
      // requested AudioContext rate. Keep phase across render quanta.
      while (this.nextPosition <= this.sourcePosition) {
        const fraction = Math.max(0, Math.min(1, this.nextPosition - this.sourcePosition + 1));
        const value = Math.max(-1, Math.min(1, this.previous + (sample - this.previous) * fraction));
        this.buffer[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.count++;
        if (this.used === this.buffer.length) this.flush();
        this.nextPosition += sampleRate / 16000;
        if (this.count >= 16000 * 120) { this.finish(true); return false; }
      }
      this.previous = sample;
      this.sourcePosition++;
    }
    return true;
  }
}
registerProcessor("grey-crow-pcm-capture", GreyCrowPcmCapture);
