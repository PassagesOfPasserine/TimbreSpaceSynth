class SpiralProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.models = [null, null]; this.playing = false; this.position = 0; this.direction = 1;
    this.phases = new Float64Array(32); this.seed = 0x51f15e; this.noiseState = 0; this.lastTransient = 0;
    this.frames = [0, 1].map(() => ({ harmonics: new Float64Array(32), phase: new Float64Array(32) }));
    this.params = { morph: 0, harmonics: 1, residual: .2, transient: .25, pitch: 1, level: .8, traversal: 'forward' };
    this.port.onmessage = ({ data }) => {
      if (data.type === 'load') this.models[data.slot] = data.model;
      if (data.type === 'params') Object.assign(this.params, data.params);
      if (data.type === 'play') { this.position = data.offset || 0; this.direction = data.direction || 1; this.playing = true; }
      if (data.type === 'seek') this.position = Math.max(0, data.time || 0);
      if (data.type === 'stop') this.playing = false;
    };
  }
  scalar(stream, a, b, part) {
    return (stream?.[a] || 0) * (1 - part) + (stream?.[b] ?? stream?.[a] ?? 0) * part;
  }
  frame(model, time, result) {
    if (!model) return false;
    const hop = model.analysis.hopSize / model.analysis.rate;
    const position = Math.max(0, Math.min(model.times.length - 1, time / hop));
    const a = Math.floor(position), b = Math.min(a + 1, model.times.length - 1), part = position - a;
    result.rms = this.scalar(model.rms, a, b, part); result.f0 = this.scalar(model.pitch, a, b, part);
    result.centroid = this.scalar(model.centroid, a, b, part); result.residual = this.scalar(model.residual, a, b, part);
    result.transient = this.scalar(model.transient, a, b, part); result.width = this.scalar(model.stereoWidth, a, b, part);
    for (let h = 0; h < 32; h++) {
      const harmonicA = model.harmonics[a]?.[h] || 0, harmonicB = model.harmonics[b]?.[h] || harmonicA;
      const phaseA = model.harmonicPhases[a]?.[h] || 0, phaseB = model.harmonicPhases[b]?.[h] || phaseA;
      result.harmonics[h] = harmonicA * (1 - part) + harmonicB * part;
      result.phase[h] = phaseA * (1 - part) + phaseB * part;
    }
    return true;
  }
  process(_inputs, outputs) {
    const output = outputs[0], left = output[0], right = output[1] || output[0];
    if (!this.playing || !this.models[0]) { left.fill(0); if (right !== left) right.fill(0); return true; }
    const a = this.frames[0], b = this.frames[1];
    for (let i = 0; i < left.length; i++) {
      const duration = this.models[0].source.duration;
      if (this.position >= duration || this.position < 0) {
        if (this.params.traversal === 'loop') this.position = this.position < 0 ? duration : 0;
        else if (this.params.traversal === 'pendulum') { this.direction *= -1; this.position = Math.max(0, Math.min(duration, this.position)); }
        else { this.playing = false; left.fill(0, i); if (right !== left) right.fill(0, i); break; }
      }
      this.frame(this.models[0], this.position, a); const hasB = this.frame(this.models[1], this.position, b);
      const morph = hasB ? this.params.morph : 0, inverseMorph = 1 - morph;
      const rms = a.rms * inverseMorph + b.rms * morph;
      const f0 = Math.max(0, (a.f0 * inverseMorph + b.f0 * morph) * this.params.pitch);
      let harmonic = 0;
      for (let h = 0; h < 32; h++) {
        const frequency = f0 * (h + 1); if (frequency <= 0 || frequency >= sampleRate * .48) continue;
        this.phases[h] += 2 * Math.PI * frequency / sampleRate;
        if (this.phases[h] > Math.PI * 2) this.phases[h] -= Math.PI * 2;
        harmonic += (a.harmonics[h] * inverseMorph + b.harmonics[h] * morph)
          * Math.sin(this.phases[h] + a.phase[h] * inverseMorph + b.phase[h] * morph);
      }
      this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
      const noise = ((this.seed >>> 0) / 0xffffffff) * 2 - 1;
      const centroid = a.centroid * inverseMorph + b.centroid * morph;
      const coefficient = Math.min(.98, Math.max(.02, centroid / sampleRate * 3));
      this.noiseState += coefficient * (noise - this.noiseState);
      const transient = a.transient * inverseMorph + b.transient * morph;
      const onset = Math.max(0, transient - this.lastTransient); this.lastTransient = transient;
      const residual = a.residual * inverseMorph + b.residual * morph;
      const width = Math.max(0, Math.min(1, a.width * inverseMorph + b.width * morph));
      const signal = Math.tanh(rms * this.params.level * (this.params.harmonics * harmonic
        + this.params.residual * residual * this.noiseState + this.params.transient * onset * noise * 2));
      left[i] = signal * (1 + width * .15); right[i] = signal * (1 - width * .15);
      if (this.params.traversal !== 'freeze') this.position += this.direction / sampleRate;
    }
    return true;
  }
}
registerProcessor('spiral-processor', SpiralProcessor);
