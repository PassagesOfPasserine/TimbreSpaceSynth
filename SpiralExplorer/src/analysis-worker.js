import { analyze } from './analysis.js';
self.onmessage = ({ data }) => {
  try {
    const features = analyze(data.mono, data.rate, progress => self.postMessage({ type: 'progress', progress }), data.volume, data.width, { quality: data.quality });
    self.postMessage({ type: 'result', features });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
