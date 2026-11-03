const SUPPORTED_EXTENSIONS = new Set(["mp4", "mov", "m4v"]);
const SUPPORTED_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v"]);
const MAX_VIDEO_BYTES = 500_000_000;

export const validateVideoFile = (file = {}) => {
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  const supported = SUPPORTED_TYPES.has(file.type) || SUPPORTED_EXTENSIONS.has(extension);
  if (!supported) return { valid: false, reason: "请选择 MP4、MOV 或 M4V 视频。" };
  if (Number(file.size) > MAX_VIDEO_BYTES) return { valid: false, reason: "视频不能超过 500 MB，请先截取较短片段。" };
  return { valid: true, reason: "" };
};

export const sampleFrameTimes = (durationSeconds, count = 6) => {
  const duration = Number(durationSeconds);
  const frameCount = Math.max(1, Math.floor(Number(count) || 0));
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return Array.from({ length: frameCount }, (_, index) => Number((((index + 1) * duration) / (frameCount + 1)).toFixed(3)));
};

export const summarizeAudio = (samples = []) => {
  if (!samples.length) return { available: false, rms: 0, peak: 0, transientCount: 0 };
  let squareTotal = 0;
  let peak = 0;
  let transientCount = 0;
  let previous = 0;
  for (const raw of samples) {
    const sample = Math.max(-1, Math.min(1, Number(raw) || 0));
    const absolute = Math.abs(sample);
    squareTotal += sample * sample;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.8 && Math.abs(sample - previous) >= 0.65) transientCount += 1;
    previous = sample;
  }
  return {
    available: true,
    rms: Number(Math.sqrt(squareTotal / samples.length).toFixed(4)),
    peak: Number(peak.toFixed(4)),
    transientCount,
  };
};

const waitForEvent = (target, eventName, timeoutMs = 12000) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    cleanup();
    reject(new Error(`等待视频 ${eventName} 超时`));
  }, timeoutMs);
  const cleanup = () => {
    clearTimeout(timeout);
    target.removeEventListener(eventName, onEvent);
    target.removeEventListener("error", onError);
  };
  const onEvent = () => {
    cleanup();
    resolve();
  };
  const onError = () => {
    cleanup();
    reject(new Error("浏览器无法读取该视频，请尝试 MP4 格式。"));
  };
  target.addEventListener(eventName, onEvent, { once: true });
  target.addEventListener("error", onError, { once: true });
});

const seekVideo = async (video, timeSeconds) => {
  const completed = waitForEvent(video, "seeked");
  video.currentTime = timeSeconds;
  await completed;
};

const captureFrame = (video, timeSeconds, maxDimension = 1280) => {
  const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, width, height);
  return {
    timeSeconds,
    imageDataUrl: canvas.toDataURL("image/jpeg", 0.72),
    width,
    height,
  };
};

const extractAudioSummary = async (file) => {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return summarizeAudio([]);
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const stride = Math.max(1, Math.floor(channel.length / 12000));
    const samples = [];
    for (let index = 0; index < channel.length; index += stride) samples.push(channel[index]);
    return summarizeAudio(samples);
  } catch {
    return summarizeAudio([]);
  } finally {
    await context.close().catch(() => {});
  }
};

export const extractVideoEvidence = async (file, options = {}) => {
  const validation = validateVideoFile(file);
  if (!validation.valid) throw new Error(validation.reason);
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForEvent(video, "loadedmetadata");
    const durationSeconds = Number(video.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("无法读取视频时长。");
    const times = sampleFrameTimes(durationSeconds, options.frameCount || 6);
    const frames = [];
    for (const timeSeconds of times) {
      await seekVideo(video, timeSeconds);
      frames.push(captureFrame(video, timeSeconds, options.maxDimension || 1280));
      options.onProgress?.(frames.length / times.length);
    }
    const audio = await extractAudioSummary(file);
    return { durationSeconds, frames, audio };
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  }
};
