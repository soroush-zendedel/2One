import { FFmpeg } from '@ffmpeg/ffmpeg';
import './style.css';

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
const TARGET_SECONDS = 59;
const $ = (id) => document.getElementById(id);
const ui = {
  input: $('videoInput'), picker: $('filePicker'), pickerTitle: $('pickerTitle'), pickerSub: $('pickerSub'),
  selectButton: $('selectButton'), process: $('processButton'), buttonLabel: $('buttonLabel'),
  preview: $('sourcePreview'), previewTitle: $('previewTitle'), previewHint: $('previewHint'),
  meta: $('fileMeta'), fileName: $('fileName'), fileDetails: $('fileDetails'), remove: $('removeFile'),
  engine: $('engineCard'), engineTitle: $('engineTitle'), engineText: $('engineText'),
  enginePercent: $('enginePercent'), engineProgress: $('engineProgress'), engineSpinner: $('engineSpinner'),
  result: $('resultCard'), resultDetails: $('resultDetails'), download: $('downloadButton'), toast: $('toast'),
};

let ffmpeg;
let engineReady = false;
let encodingVideo = false;
let busy = false;
let chosenFile;
let previewUrl;
let outputUrl;
let toastTimer;
let activeLogs = null;
let detectedFps = 30;

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 4000);
}

function prettySize(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function prettyDuration(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function setProgress(value, title, detail) {
  const clamped = Math.min(100, Math.max(0, value));
  ui.engine.hidden = false;
  ui.engineTitle.textContent = title;
  if (detail) ui.engineText.textContent = detail;
  ui.enginePercent.textContent = `${Math.round(clamped).toLocaleString('fa-IR')}٪`;
  ui.engineProgress.style.width = `${clamped}%`;
}

function showError(message) {
  ui.engineSpinner.style.animationPlayState = 'paused';
  ui.engineTitle.textContent = 'پردازش انجام نشد';
  ui.engineText.textContent = message;
  ui.enginePercent.textContent = '×';
  ui.engineProgress.style.width = '100%';
  ui.engineProgress.style.background = '#ff6685';
}

async function fetchAsBlobUrl(url, mime, rangeStart, rangeEnd, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`دریافت ${name} ناموفق بود (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) {
      const fraction = Math.min(1, received / total);
      setProgress(rangeStart + fraction * (rangeEnd - rangeStart), `دریافت موتور ویدیو · ${name}`,
        `${prettySize(received)} از ${prettySize(total)} · فقط بار اول`);
    } else {
      setProgress(rangeStart + ((received / (30 * 1024 * 1024)) * (rangeEnd - rangeStart)) % (rangeEnd - rangeStart),
        `دریافت موتور ویدیو · ${name}`, `${prettySize(received)} دریافت شد · فقط بار اول`);
    }
  }
  return URL.createObjectURL(new Blob(chunks, { type: mime }));
}

async function loadEngine() {
  if (engineReady) return;
  ui.engineSpinner.style.animationPlayState = 'running';
  ui.engineProgress.style.background = '';
  setProgress(0, 'دریافت موتور ویدیو', 'حدود ۳۱ مگابایت · فقط بار اول');
  ui.process.disabled = true;
  let coreUrl;
  let wasmUrl;
  try {
    coreUrl = await fetchAsBlobUrl(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript', 0, 12, 'فایل اجرایی');
    wasmUrl = await fetchAsBlobUrl(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm', 12, 82, 'موتور پردازش');
    setProgress(85, 'راه‌اندازی موتور ویدیو', 'این مرحله ممکن است چند لحظه طول بکشد');
    ffmpeg ??= new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      if (activeLogs) activeLogs.push(message);
    });
    ffmpeg.on('progress', ({ progress }) => {
      if (encodingVideo && Number.isFinite(progress)) setProgress(27 + Math.max(0, Math.min(1, progress)) * 70, 'ساخت ویدیوی ۵۹ ثانیه‌ای', 'همهٔ فریم‌ها در حال حفظ‌شدن هستند');
    });
    await ffmpeg.load({ coreURL: coreUrl, wasmURL: wasmUrl });
    engineReady = true;
    setProgress(100, 'موتور آماده است', 'فایل ویدیو همچنان فقط روی دستگاه تو می‌ماند');
  } catch (error) {
    try { ffmpeg?.terminate(); } catch { /* worker may not have started */ }
    ffmpeg = undefined;
    engineReady = false;
    throw error;
  } finally {
    if (coreUrl) URL.revokeObjectURL(coreUrl);
    if (wasmUrl) URL.revokeObjectURL(wasmUrl);
  }
}

function readVideoInfo(file) {
  return new Promise((resolve, reject) => {
    const tempUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      URL.revokeObjectURL(tempUrl);
      resolve(result);
    };
    video.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      reject(new Error('مرورگر نتوانست این ویدیو را باز کند.'));
    };
    video.src = tempUrl;
  });
}

function extractFreezeSpans(logs, duration) {
  const raw = [];
  const pending = [];
  for (const line of logs) {
    const start = line.match(/freeze_start:\s*(-?\d+(?:\.\d+)?)/i);
    const end = line.match(/freeze_end:\s*(-?\d+(?:\.\d+)?)/i);
    const fps = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*fps\b/i);
    if (fps) detectedFps = Number(fps[1]) || detectedFps;
    if (start) pending.push(Number(start[1]));
    if (end && pending.length) raw.push([pending.shift(), Math.min(duration, Number(end[1]))]);
  }
  for (const start of pending) raw.push([start, duration]);
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of raw) {
    if (!(end > start)) continue;
    const last = merged.at(-1);
    if (last && start - last[1] <= 0.35) last[1] = end;
    else merged.push([Math.max(0, start), end]);
  }
  return merged.filter(([start, end]) => end - start >= 1);
}

function makeSegments(duration, pauses) {
  const segments = [];
  let cursor = 0;
  for (const [start, end] of pauses) {
    if (start > cursor) segments.push({ start: cursor, end: start, frozen: false });
    segments.push({ start, end, frozen: true });
    cursor = end;
  }
  if (cursor < duration) segments.push({ start: cursor, end: duration, frozen: false });
  return segments;
}

function allocateDurations(segments, pauseOption = 0.3) {
  const active = segments.filter((s) => !s.frozen).reduce((sum, s) => sum + s.end - s.start, 0);
  const frozen = segments.filter((s) => s.frozen).reduce((sum, s) => sum + s.end - s.start, 0);
  const freezeCount = segments.filter((s) => s.frozen).length;
  let durations;
  if (active >= TARGET_SECONDS) {
    const pauseBudget = Math.min(frozen, pauseOption * freezeCount, TARGET_SECONDS * 0.1);
    const activeScale = (TARGET_SECONDS - pauseBudget) / active;
    const frozenScale = frozen ? pauseBudget / frozen : 0;
    durations = segments.map((s) => (s.end - s.start) * (s.frozen ? frozenScale : activeScale));
  } else if (frozen >= TARGET_SECONDS - active) {
    const frozenScale = frozen ? (TARGET_SECONDS - active) / frozen : 0;
    durations = segments.map((s) => (s.end - s.start) * (s.frozen ? frozenScale : 1));
  } else {
    const scale = TARGET_SECONDS / segments.reduce((sum, s) => sum + s.end - s.start, 0);
    durations = segments.map((s) => (s.end - s.start) * scale);
  }
  if (!durations.length) throw new Error('هیچ بخشی برای پردازش پیدا نشد.');
  durations[durations.length - 1] += TARGET_SECONDS - durations.reduce((a, b) => a + b, 0);
  const lastRatio = durations.at(-1) / (segments.at(-1).end - segments.at(-1).start);
  const mappedEnd = TARGET_SECONDS - (1 - lastRatio) / detectedFps;
  const correction = mappedEnd / durations.reduce((a, b) => a + b, 0);
  return { durations: durations.map((d) => d * correction), active, frozen, freezeCount };
}

function speedFilters(speed) {
  const factors = [];
  let remaining = speed;
  while (remaining > 2) { factors.push(2); remaining /= 2; }
  while (remaining < 0.5) { factors.push(0.5); remaining /= 0.5; }
  factors.push(remaining);
  return factors.map((x) => `atempo=${x.toFixed(10)}`).join(',');
}

function createTimeline(segments, durations, hasAudio) {
  const pieces = [];
  let outputTime = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const ratio = durations[i] / (segment.end - segment.start);
    pieces.push({ end: segment.end, value: `${outputTime.toFixed(12)}+(T-${segment.start.toFixed(12)})*${ratio.toFixed(12)}` });
    outputTime += durations[i];
  }
  let mapping = pieces.at(-1).value;
  for (let i = pieces.length - 2; i >= 0; i -= 1) {
    mapping = `if(lt(T\\,${pieces[i].end.toFixed(12)})\\,${pieces[i].value}\\,${mapping})`;
  }
  const filters = [`[0:v:0]settb=expr=AVTB,setpts=${mapping}/TB[vout]`];
  const audioPads = [];
  if (hasAudio) {
    segments.forEach((segment, i) => {
      const inDuration = segment.end - segment.start;
      const ratio = durations[i] / inDuration;
      filters.push(`[0:a:0]atrim=start=${segment.start.toFixed(9)}:end=${segment.end.toFixed(9)},asetpts=PTS-STARTPTS,${speedFilters(1 / ratio)},asetpts=N/SR/TB[a${i}]`);
      audioPads.push(`[a${i}]`);
    });
    filters.push(`${audioPads.join('')}concat=n=${segments.length}:v=0:a=1[aout]`);
  }
  return filters.join(';');
}

async function processVideo() {
  if (!chosenFile) return;
  busy = true;
  ui.process.disabled = true;
  ui.remove.disabled = true;
  ui.picker.style.pointerEvents = 'none';
  ui.result.hidden = true;
  ui.engine.hidden = false;
  ui.engineProgress.style.background = '';
  ui.engineSpinner.style.animationPlayState = 'running';
  ui.buttonLabel.textContent = 'در حال آماده‌سازی…';
  let inputName = '2one_input';
  let outputName = '2one_output.mp4';
  try {
    await loadEngine();
    setProgress(4, 'خواندن ویدیو', 'ویدیو در حافظهٔ مرورگر باز می‌شود');
    const info = await readVideoInfo(chosenFile);
    if (!Number.isFinite(info.duration) || info.duration <= 0) throw new Error('مدت ویدیو قابل‌خواندن نیست.');
    const ext = chosenFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    inputName = `2one_input.${ext}`;
    await ffmpeg.writeFile(inputName, new Uint8Array(await chosenFile.arrayBuffer()));

    setProgress(12, 'پیداکردن مکث‌ها', 'فریم‌های تکراری در حال شناسایی هستند');
    const analysisLogs = [];
    detectedFps = 30;
    activeLogs = analysisLogs;
    await ffmpeg.exec(['-hide_banner', '-i', inputName, '-vf', 'freezedetect=n=-45dB:d=1', '-an', '-f', 'null', '-']);
    activeLogs = null;
    const pauses = extractFreezeSpans(analysisLogs, info.duration);
    const segments = makeSegments(info.duration, pauses);
    if (!segments.length) throw new Error('بخش‌های ویدیو شناسایی نشدند.');
    const allocation = allocateDurations(segments);
    const hasAudio = analysisLogs.some((line) => /\bAudio:/i.test(line));
    const filters = createTimeline(segments, allocation.durations, hasAudio);

    setProgress(25, 'ساخت ویدیوی ۵۹ ثانیه‌ای', `تعداد ${allocation.freezeCount.toLocaleString('fa-IR')} مکث پیدا شد`);
    const args = ['-hide_banner', '-i', inputName, '-filter_complex', filters, '-map', '[vout]'];
    if (hasAudio) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-fps_mode', 'passthrough', '-enc_time_base', '1:1000000', '-video_track_timescale', '1000000',
      '-t', '59.000000', '-movflags', '+faststart', outputName);
    encodingVideo = true;
    await ffmpeg.exec(args);
    encodingVideo = false;
    setProgress(98, 'آماده‌کردن دانلود', 'خروجی نهایی در حال آماده‌شدن است');
    const data = await ffmpeg.readFile(outputName);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
    ui.preview.src = outputUrl;
    ui.preview.controls = true;
    ui.preview.hidden = false;
    ui.selectButton.hidden = true;
    ui.previewTitle.hidden = true;
    ui.previewHint.hidden = true;
    ui.download.href = outputUrl;
    ui.download.download = `${chosenFile.name.replace(/\.[^.]+$/, '')}_2One.mp4`;
    ui.resultDetails.textContent = `۵۹ ثانیه · ${prettySize(data.byteLength)} · ${allocation.freezeCount.toLocaleString('fa-IR')} مکث فشرده شد`;
    ui.result.hidden = false;
    ui.engineSpinner.style.animationPlayState = 'paused';
    setProgress(100, 'ویدیوت آماده است', 'همهٔ فریم‌ها حفظ شدند؛ ویدیو فقط روی دستگاهت پردازش شد');
    ui.buttonLabel.textContent = 'ساخت دوبارهٔ ویدیو';
    toast('ویدیوی شورتس آمادهٔ دانلود است.');
    try { await ffmpeg.deleteFile(inputName); await ffmpeg.deleteFile(outputName); } catch { /* cleaned when next file is loaded */ }
  } catch (error) {
    activeLogs = null;
    encodingVideo = false;
    console.error(error);
    showError(error?.message || 'یک خطای ناشناخته رخ داد.');
    ui.buttonLabel.textContent = 'تلاش دوباره';
    toast(error?.message || 'پردازش ویدیو ناموفق بود.');
  } finally {
    busy = false;
    ui.remove.disabled = false;
    ui.picker.style.pointerEvents = '';
    ui.process.disabled = !chosenFile;
  }
}

async function setFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm|mkv|avi)$/i.test(file.name)) {
    toast('لطفاً یک فایل ویدیویی انتخاب کن.');
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (outputUrl) { URL.revokeObjectURL(outputUrl); outputUrl = null; }
  chosenFile = file;
  previewUrl = URL.createObjectURL(file);
  ui.preview.src = previewUrl;
  ui.preview.controls = true;
  ui.preview.hidden = false;
  ui.selectButton.hidden = true;
  ui.previewTitle.hidden = true;
  ui.previewHint.hidden = true;
  ui.preview.style.zIndex = '1';
  ui.meta.hidden = false;
  ui.fileName.textContent = file.name;
  ui.fileDetails.textContent = `در حال خواندن مدت ویدیو · ${prettySize(file.size)}`;
  ui.pickerTitle.textContent = 'انتخاب ویدیوی دیگری';
  ui.pickerSub.textContent = 'برای جایگزینی فایل فعلی لمس کن';
  ui.buttonLabel.textContent = 'ساخت ویدیوی ۵۹ ثانیه‌ای';
  ui.process.disabled = false;
  ui.result.hidden = true;
  ui.engine.hidden = true;
  ui.engineProgress.style.width = '0%';
  try {
    const info = await readVideoInfo(file);
    ui.fileDetails.textContent = `${prettyDuration(info.duration)} · ${prettySize(file.size)} · ${info.width}×${info.height}`;
  } catch (error) {
    ui.fileDetails.textContent = prettySize(file.size);
    toast(error.message);
  }
}

ui.input.addEventListener('change', (event) => setFile(event.target.files?.[0]));
ui.selectButton.addEventListener('click', () => ui.input.click());
ui.process.addEventListener('click', processVideo);
ui.remove.addEventListener('click', () => {
  if (busy) return;
  chosenFile = null;
  ui.input.value = '';
  ui.meta.hidden = true;
  ui.result.hidden = true;
  ui.engine.hidden = true;
  ui.preview.pause();
  ui.preview.removeAttribute('src');
  ui.preview.load();
  ui.preview.hidden = true;
  ui.selectButton.hidden = false;
  ui.previewTitle.hidden = false;
  ui.previewHint.hidden = false;
  ui.pickerTitle.textContent = 'انتخاب فایل ویدیو';
  ui.pickerSub.textContent = 'MP4، MOV یا هر ویدیوی گوشی';
  ui.buttonLabel.textContent = 'اول ویدیو رو انتخاب کن';
  ui.process.disabled = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  previewUrl = null;
  outputUrl = null;
});
ui.picker.addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
});
ui.picker.addEventListener('dragover', (event) => { event.preventDefault(); ui.picker.classList.add('dragging'); });
ui.picker.addEventListener('dragleave', () => ui.picker.classList.remove('dragging'));
ui.picker.addEventListener('drop', (event) => {
  event.preventDefault();
  ui.picker.classList.remove('dragging');
  setFile(event.dataTransfer.files?.[0]);
});

window.addEventListener('pagehide', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
});
