const MAX_DURATION_SECONDS = 30;
const MAX_FRAME_RATE = 5;
const DEFAULT_FRAME_RATE = 1;

export const samplePoseFrameTimes = (durationSeconds, frameRate = DEFAULT_FRAME_RATE) => {
  const duration = Number(durationSeconds);
  const rate = Math.min(MAX_FRAME_RATE, Math.max(1, Number(frameRate) || DEFAULT_FRAME_RATE));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长。");
  if (duration > MAX_DURATION_SECONDS) throw new Error("姿态测量首版仅支持 30 秒以内的视频，请先截取片段。");
  const count = Math.min(150, Math.max(1, Math.floor(duration * rate)));
  return Array.from({ length: count }, (_, index) => Number((((index + 0.5) * duration) / count).toFixed(3)));
};

export const batchPoseFrames = (frames, batchSize = 20) => {
  const size = Math.max(1, Math.floor(Number(batchSize) || 20));
  const batches = [];
  for (let index = 0; index < frames.length; index += size) batches.push(frames.slice(index, index + size));
  return batches;
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
    reject(new Error("浏览器无法读取姿态分析画面，请尝试 MP4 格式。"));
  };
  target.addEventListener(eventName, onEvent, { once: true });
  target.addEventListener("error", onError, { once: true });
});

const capturePoseFrame = (video, timeSeconds, maxDimension) => {
  const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, width, height);
  return {
    timeSeconds,
    imageDataUrl: canvas.toDataURL("image/jpeg", 0.62),
  };
};

export const extractPoseFrames = async (file, options = {}) => {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;
  try {
    await waitForEvent(video, "loadedmetadata");
    const times = samplePoseFrameTimes(video.duration, options.frameRate || DEFAULT_FRAME_RATE);
    const frames = [];
    for (const timeSeconds of times) {
      const completed = waitForEvent(video, "seeked");
      video.currentTime = timeSeconds;
      await completed;
      frames.push(capturePoseFrame(video, timeSeconds, options.maxDimension || 960));
      options.onProgress?.(frames.length / times.length);
    }
    return { durationSeconds: Number(video.duration), frames };
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  }
};
