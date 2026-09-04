class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16_000;
    this.gain = 1;
    this.inputBuffer = new Float32Array(0);
    this.inputPosition = 0;
    this.outputBuffer = [];
    this.port.onmessage = (event) => {
      if (event.data?.type === "set-gain") {
        this.gain = Math.max(0, Math.min(2, Number(event.data.gain) || 0));
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    // AudioContext 的实际采样率由浏览器决定；这里统一重采样到 Fun-ASR 所需的 16 kHz。
    const combined = new Float32Array(this.inputBuffer.length + channel.length);
    combined.set(this.inputBuffer);
    combined.set(channel, this.inputBuffer.length);
    const ratio = sampleRate / this.targetSampleRate;

    while (this.inputPosition + 1 < combined.length) {
      const leftIndex = Math.floor(this.inputPosition);
      const fraction = this.inputPosition - leftIndex;
      const sample = combined[leftIndex]
        + (combined[leftIndex + 1] - combined[leftIndex]) * fraction;
      this.outputBuffer.push(Math.max(-1, Math.min(1, sample * this.gain)));
      this.inputPosition += ratio;
    }

    const consumed = Math.floor(this.inputPosition);
    this.inputBuffer = combined.slice(consumed);
    this.inputPosition -= consumed;

    // 每 20 ms 发送一帧，既避免小包过多，也保持实时字幕的低延迟。
    while (this.outputBuffer.length >= 320) {
      const pcm = new Int16Array(320);
      for (let index = 0; index < pcm.length; index += 1) {
        const sample = this.outputBuffer[index];
        pcm[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      }
      this.outputBuffer.splice(0, pcm.length);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("asr4dnd-pcm-capture", PcmCaptureProcessor);
