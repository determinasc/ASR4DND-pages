const INPUT_SAMPLE_RATE = 16_000;
const MAX_BUFFERED_INPUT_SAMPLES = INPUT_SAMPLE_RATE * 2;
const START_BUFFER_INPUT_SAMPLES = 640;

class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.participants = new Map();
    this.masterVolume = 1;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  participant(participantId) {
    let state = this.participants.get(participantId);
    if (!state) {
      state = {
        samples: [],
        readPosition: 0,
        started: false,
        volume: 0.8,
        lastReceivedFrame: currentFrame,
      };
      this.participants.set(participantId, state);
    }
    return state;
  }

  handleMessage(message) {
    if (message?.type === "pcm" && typeof message.participantId === "string") {
      const state = this.participant(message.participantId);
      const pcm = new Int16Array(message.pcm);
      for (let index = 0; index < pcm.length; index += 1) {
        state.samples.push(pcm[index] / (pcm[index] < 0 ? 0x8000 : 0x7fff));
      }
      // 浏览器卡顿时只保留最近两秒，避免恢复后播放很久以前的语音。
      if (state.samples.length > MAX_BUFFERED_INPUT_SAMPLES) {
        state.samples.splice(0, state.samples.length - MAX_BUFFERED_INPUT_SAMPLES);
        state.readPosition = 0;
      }
      state.lastReceivedFrame = currentFrame;
      return;
    }
    if (message?.type === "participant-volume") {
      this.participant(message.participantId).volume = Math.max(0, Math.min(1, message.volume));
      return;
    }
    if (message?.type === "master-volume") {
      this.masterVolume = Math.max(0, Math.min(1, message.volume));
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    const step = INPUT_SAMPLE_RATE / sampleRate;

    for (const [participantId, state] of this.participants) {
      if (!state.started && state.samples.length >= START_BUFFER_INPUT_SAMPLES) {
        state.started = true;
      }
      if (state.started) {
        for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
          const leftIndex = Math.floor(state.readPosition);
          if (leftIndex + 1 >= state.samples.length) {
            state.started = false;
            break;
          }
          const fraction = state.readPosition - leftIndex;
          const sample = state.samples[leftIndex]
            + (state.samples[leftIndex + 1] - state.samples[leftIndex]) * fraction;
          output[outputIndex] += sample * state.volume * this.masterVolume;
          state.readPosition += step;
        }
        const consumed = Math.floor(state.readPosition);
        if (consumed > 0) {
          state.samples.splice(0, consumed);
          state.readPosition -= consumed;
        }
      }
      // 五秒没有音频且缓冲已空时清理成员，防止长团无限积累对象。
      if (!state.started && state.samples.length < 2 && currentFrame - state.lastReceivedFrame > sampleRate * 5) {
        this.participants.delete(participantId);
      }
    }

    // 多人同时发言相加后可能超过正常范围，最后统一做软限制。
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.max(-1, Math.min(1, output[index]));
    }
    return true;
  }
}

registerProcessor("asr4dnd-pcm-playback", PcmPlaybackProcessor);
