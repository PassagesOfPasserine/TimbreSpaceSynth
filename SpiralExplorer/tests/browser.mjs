import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.SPIRAL_TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.spiralReady?.frames > 0, { timeout: 30000 });
  assert.match(await page.locator('#status').textContent(), /Ready to play/);
  assert.equal(await page.locator('canvas').count(), 1);
  await page.locator('#play').click(); await page.waitForTimeout(1400);
  assert.notEqual(await page.locator('#current').textContent(), '0:00');
  await page.locator('#play').click();
  const position = await page.locator('#seek').inputValue(); await page.waitForTimeout(300);
  assert.equal(await page.locator('#seek').inputValue(), position, 'pause freezes timeline');
  await page.locator('#play').click(); await page.waitForTimeout(350); await page.locator('#play').click();
  assert.ok(Number(await page.locator('#seek').inputValue()) > Number(position), 'resume advances from paused position');
  await page.locator('#axes').check(); await page.locator('#direction').selectOption('-1');
  await page.locator('#resolution').fill('1024'); await page.locator('#resolution').dispatchEvent('input');
  assert.equal(await page.locator('#resolutionValue').textContent(), '1024');
  const canvas = page.locator('canvas'); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 60, { steps: 8 }); await page.mouse.up();
  await page.mouse.wheel(0, -150);
  await page.mouse.down({button:'right'}); await page.mouse.move(box.x + 200, box.y + 220, {steps:5}); await page.mouse.up({button:'right'});
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await downloadEvent; assert.equal(download.suggestedFilename(), 'timbre-space-features.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.schema, 'timbre-space-features/1');
  assert.equal(exported.times.length, exported.rms.length);
  assert.equal(exported.harmonics[0].length, 16); assert.equal(exported.envelope[0].length, 24);
  // Generate an actual RIFF PCM16 WAV and exercise browser decoding + worker import.
  const rate = 16000, samples = rate, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(10000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  await page.locator('#file').setInputFiles({ name: 'test-220Hz.wav', mimeType: 'audio/wav', buffer: wav });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('test-220Hz.wav') && document.getElementById('status').textContent.includes('Ready to play'));
  await page.locator('#seek').fill('0.5'); await page.locator('#seek').dispatchEvent('input');
  await page.waitForTimeout(200); assert.match(await page.locator('#pitch').textContent(), /220/);
  await page.locator('#reset').click();
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/spiral-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout fits');
  await page.screenshot({ path: 'test-results/spiral-mobile.png', fullPage: true });
  const stereo = Buffer.alloc(44 + samples * 4); wav.copy(stereo, 0, 0, 44);
  stereo.writeUInt32LE(stereo.length - 8, 4); stereo.writeUInt16LE(2, 22);
  stereo.writeUInt32LE(rate * 4, 28); stereo.writeUInt16LE(4, 32); stereo.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) {
    const sample = wav.readInt16LE(44 + i * 2); stereo.writeInt16LE(sample, 44 + i * 4); stereo.writeInt16LE(-sample, 46 + i * 4);
  }
  await page.locator('#file').setInputFiles({ name: 'stereo-antiphase.wav', mimeType: 'audio/wav', buffer: stereo });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('stereo-antiphase.wav') && document.getElementById('status').textContent.includes('Ready to play'));
  await page.locator('#seek').fill('0.5'); await page.locator('#seek').dispatchEvent('input');
  await page.waitForTimeout(150);
  assert.match(await page.locator('#pitch').textContent(), /220/);
  assert.ok(Number.parseFloat(await page.locator('#rms').textContent()) > -15, 'stereo RMS avoids cancellation');
  await page.locator('#file').setInputFiles({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Import failed'));
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: WebGL, playback, pause, orbit/pan/zoom, axes, direction, resolution, export, WAV import, seek/pitch, responsive layout, invalid-file handling.');
} finally { await browser.close(); }
