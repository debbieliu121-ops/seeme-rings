import { extractVideoEvidence, validateVideoFile } from "./agent-media.mjs";
import { extractPoseFrames } from "./agent-pose.mjs";
import { normalizeAgentReport } from "./agent-report.mjs";

const HISTORY_KEY = "seeme-agent-history-v1";
const levelLabels = { LOW: "低关注", MEDIUM: "中关注", HIGH: "高关注", INSUFFICIENT: "信息不足" };
const stepOrder = ["read", "frames", "pose", "audio", "evidence", "report"];
const stepCopy = {
  read: ["正在读取视频", "确认视频时长和画面尺寸"],
  frames: ["正在抽取画面", "从不同时间点整理连续观察证据"],
  pose: ["正在测量姿态", "MMPose 识别马匹 MediaPipe 识别骑手姿态与重心趋势"],
  audio: ["正在分析声音", "提取基础响度和突发声变化"],
  evidence: ["正在综合证据", "区分可见事实、可能推断与不确定性"],
  report: ["正在生成报告", "将观察结果整理为可供教练复核的结构"],
};

const elements = {
  form: document.querySelector("#analysis-form"),
  input: document.querySelector("#video-input"),
  uploadZone: document.querySelector("#upload-zone"),
  videoCard: document.querySelector("#video-card"),
  preview: document.querySelector("#video-preview"),
  videoName: document.querySelector("#video-name"),
  videoDetail: document.querySelector("#video-detail"),
  removeVideo: document.querySelector("#remove-video"),
  authorization: document.querySelector("#authorization"),
  analyzeButton: document.querySelector("#analyze-button"),
  formError: document.querySelector("#form-error"),
  processingPanel: document.querySelector("#processing-panel"),
  processingTitle: document.querySelector("#processing-title"),
  processingCopy: document.querySelector("#processing-copy"),
  progressSteps: [...document.querySelectorAll("#progress-steps li")],
  reportSection: document.querySelector("#report-section"),
  reportMode: document.querySelector("#report-mode"),
  attentionLevel: document.querySelector("#attention-level"),
  confidenceBar: document.querySelector("#confidence-bar"),
  confidenceValue: document.querySelector("#confidence-value"),
  reportSummary: document.querySelector("#report-summary"),
  visualEvidence: document.querySelector("#visual-evidence"),
  poseEvidence: document.querySelector("#pose-evidence"),
  poseMeasurements: document.querySelector("#pose-measurements"),
  audioEvidence: document.querySelector("#audio-evidence"),
  positiveSignals: document.querySelector("#positive-signals"),
  uncertainties: document.querySelector("#uncertainties"),
  immediateActions: document.querySelector("#immediate-actions"),
  duringSessionActions: document.querySelector("#during-session-actions"),
  afterRideActions: document.querySelector("#after-ride-actions"),
  professionalReviewActions: document.querySelector("#professional-review-actions"),
  reportDisclaimer: document.querySelector("#report-disclaimer"),
  reviewButtons: [...document.querySelectorAll("[data-review]")],
  coachNote: document.querySelector("#coach-note"),
  saveReview: document.querySelector("#save-review"),
  printReport: document.querySelector("#print-report"),
  newAnalysis: document.querySelector("#new-analysis"),
  historyList: document.querySelector("#history-list"),
  clearHistory: document.querySelector("#clear-history"),
};

let selectedFile = null;
let previewUrl = null;
let activeReport = null;
let selectedReview = "UNREVIEWED";

const formatBytes = (bytes) => {
  if (!Number.isFinite(Number(bytes))) return "";
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

const formatTime = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = Math.round(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const readHistory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeAgentReport) : [];
  } catch {
    return [];
  }
};

const writeHistory = (history) => localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));

const replaceOrAddReport = (report) => {
  const history = readHistory().filter((item) => item.id !== report.id);
  writeHistory([report, ...history]);
  renderHistory();
};

const clearChildren = (element) => {
  while (element.firstChild) element.firstChild.remove();
};

const appendListItem = (list, primary, secondary = "") => {
  const item = document.createElement("li");
  item.textContent = primary;
  if (secondary) {
    const detail = document.createElement("small");
    detail.textContent = secondary;
    item.append(detail);
  }
  list.append(item);
};

const renderEmpty = (container, copy) => appendListItem(container, copy);

const appendEvidenceField = (container, label, value, className = "") => {
  if (!value) return;
  const field = document.createElement("div");
  field.className = `evidence-field ${className}`.trim();
  const heading = document.createElement("b");
  heading.textContent = label;
  const copy = document.createElement("span");
  copy.textContent = value;
  field.append(heading, copy);
  container.append(field);
};

const formatMetricValue = (value) => {
  if (typeof value === "number") return Number(value.toFixed(2)).toString();
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const metricLabels = {
  status: "状态",
  postureTrend: "重心趋势",
  torsoAngleDegrees: "躯干倾角",
  torsoStabilityDegrees: "上身稳定波动",
  usableFrameRatio: "可用画面比例",
};

const limitationLabels = {
  HORSE_MODEL_NOT_INSTALLED: "MMPose 马匹关键点模型尚未启用",
  HORSE_NOT_DETECTED: "当前未获得可靠马匹关键点",
  RIDER_NOT_DETECTED: "当前未获得可靠骑手关键点",
};

const formatMetrics = (metrics) => Object.entries(metrics || {})
  .map(([key, value]) => `${metricLabels[key] || key} ${formatMetricValue(value)}`)
  .join(" · ");

const renderPoseMeasurements = (report) => {
  clearChildren(elements.poseMeasurements);
  const measurements = report.poseMeasurements;
  const horseMetrics = measurements?.horseMetrics || {};
  const riderMetrics = measurements?.riderMetrics || {};
  const hasHorseMeasurements = Object.keys(horseMetrics).length > 0;
  const hasRiderMeasurements = Object.keys(riderMetrics).length > 0;
  if (!measurements || (!hasHorseMeasurements && !hasRiderMeasurements)) {
    const copy = document.createElement("p");
    copy.textContent = "本次未获得可靠的开源姿态测量 视觉分析仍可运行并由教练复核";
    elements.poseMeasurements.append(copy);
    return;
  }
  const versions = measurements.modelVersions || {};
  appendEvidenceField(elements.poseMeasurements, "骑手开源测量", hasRiderMeasurements
    ? `MediaPipe 已完成骑手姿态测量 · ${versions.rider || "Pose Landmarker"}`
    : "MediaPipe 本次未获得可靠骑手关键点");
  appendEvidenceField(elements.poseMeasurements, "骑手姿态与重心趋势", formatMetrics(riderMetrics) || "有效关键点不足");
  appendEvidenceField(elements.poseMeasurements, "马匹开源测量", hasHorseMeasurements
    ? `MMPose 已完成马匹关键点测量 · ${versions.horse || "RTMPose Animal AP-10K"}`
    : "MMPose 马匹模型尚未启用 视觉模型仍会分析马匹外观与动作");
  appendEvidenceField(elements.poseMeasurements, "马匹测量", formatMetrics(horseMetrics) || "等待 MMPose 模型");
  appendEvidenceField(elements.poseMeasurements, "测量限制", (measurements.limitations || []).map((item) => limitationLabels[item] || item).join(" · "));
};

const renderActionList = (container, actions, emptyCopy) => {
  clearChildren(container);
  if (!actions.length) renderEmpty(container, emptyCopy);
  actions.forEach((item) => appendListItem(container, item));
};

const renderReport = (report, shouldScroll = true) => {
  activeReport = normalizeAgentReport(report);
  selectedReview = activeReport.coachReview.status;
  elements.reportMode.textContent = activeReport.mode === "demo" ? "DEMO" : activeReport.mode === "fallback" ? "LOCAL" : "LIVE";
  elements.attentionLevel.textContent = levelLabels[activeReport.attentionLevel];
  elements.confidenceBar.style.width = `${Math.round(activeReport.confidence * 100)}%`;
  elements.confidenceValue.textContent = `${Math.round(activeReport.confidence * 100)}%`;
  elements.reportSummary.textContent = activeReport.summary;
  elements.reportDisclaimer.textContent = activeReport.disclaimer;

  clearChildren(elements.visualEvidence);
  if (!activeReport.segments.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "当前没有足够的可观察视觉证据。";
    elements.visualEvidence.append(empty);
  } else {
    activeReport.segments.forEach((segment) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      const time = document.createElement("time");
      time.textContent = segment.endSeconds > segment.startSeconds
        ? `${formatTime(segment.startSeconds)}–${formatTime(segment.endSeconds)}`
        : formatTime(segment.startSeconds);
      const rail = document.createElement("span");
      rail.className = "timeline-rail";
      const copy = document.createElement("div");
      copy.className = "timeline-copy";
      const headline = document.createElement("h4");
      headline.className = "segment-headline";
      headline.textContent = segment.headline;
      const summary = document.createElement("ul");
      summary.className = "segment-summary";
      segment.summaryLines.forEach((line) => appendListItem(summary, line));
      const details = document.createElement("details");
      details.className = "technical-evidence";
      const detailsSummary = document.createElement("summary");
      detailsSummary.textContent = "查看技术证据";
      const technical = document.createElement("div");
      technical.className = "technical-evidence-copy";
      appendEvidenceField(technical, "马匹表现", segment.technicalEvidence.horseObservation);
      appendEvidenceField(technical, "骑手动作", segment.technicalEvidence.riderObservation);
      appendEvidenceField(technical, "可能原因", segment.technicalEvidence.interactionHypothesis || "需要结合连续画面和现场信息复核", "is-hypothesis");
      appendEvidenceField(technical, "可能影响", segment.technicalEvidence.possibleImpact || "当前证据不足以判断生物力学影响", "is-impact");
      appendEvidenceField(technical, "测量值", segment.technicalEvidence.measurements.join(" · "));
      appendEvidenceField(technical, "测量限制", segment.technicalEvidence.limitations.join(" · "));
      if (segment.technicalEvidence.confidence !== null) appendEvidenceField(technical, "分段置信度", `${Math.round(segment.technicalEvidence.confidence * 100)}%`);
      details.append(detailsSummary, technical);
      copy.append(headline, summary, details);
      item.append(time, rail, copy);
      elements.visualEvidence.append(item);
    });
  }
  renderPoseMeasurements(activeReport);

  clearChildren(elements.audioEvidence);
  if (!activeReport.audioEvidence.length) renderEmpty(elements.audioEvidence, "没有可用的声音证据");
  activeReport.audioEvidence.forEach((item) => appendListItem(elements.audioEvidence, item.observation, item.inference));

  clearChildren(elements.positiveSignals);
  if (!activeReport.positiveSignals.length) renderEmpty(elements.positiveSignals, "当前素材未呈现足够的积极福利信号");
  activeReport.positiveSignals.forEach((item) => appendListItem(elements.positiveSignals, item));

  clearChildren(elements.uncertainties);
  if (!activeReport.uncertainties.length) renderEmpty(elements.uncertainties, "模型没有补充不确定性，请教练仍结合现场复核");
  activeReport.uncertainties.forEach((item) => appendListItem(elements.uncertainties, item));

  renderActionList(elements.immediateActions, activeReport.actions.immediate, "暂不需要立即调整");
  renderActionList(elements.duringSessionActions, activeReport.actions.duringSession, "请教练结合现场安排训练重点");
  renderActionList(elements.afterRideActions, activeReport.actions.afterRide, "记录训练后恢复状态");
  renderActionList(elements.professionalReviewActions, activeReport.actions.professionalReview, "当前未触发专业复核提示");

  elements.coachNote.value = activeReport.coachReview.note;
  elements.reviewButtons.forEach((button) => button.classList.toggle("is-selected", button.dataset.review === selectedReview));
  elements.processingPanel.classList.add("is-hidden");
  elements.reportSection.classList.remove("is-hidden");
  if (shouldScroll) elements.reportSection.scrollIntoView({ behavior: "smooth", block: "start" });
};

const renderHistory = () => {
  const history = readHistory();
  clearChildren(elements.historyList);
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "分析完成后，报告会保存在这台设备上。";
    elements.historyList.append(empty);
    return;
  }
  history.forEach((report) => {
    const card = document.createElement("article");
    card.className = "history-item";
    card.tabIndex = 0;
    const header = document.createElement("header");
    const date = document.createElement("span");
    date.textContent = new Date(report.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const mode = document.createElement("span");
    mode.textContent = report.mode.toUpperCase();
    header.append(date, mode);
    const level = document.createElement("strong");
    level.textContent = levelLabels[report.attentionLevel];
    const summary = document.createElement("p");
    summary.textContent = report.summary;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除记录";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      writeHistory(readHistory().filter((item) => item.id !== report.id));
      renderHistory();
    });
    const open = () => renderReport(report);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open();
    });
    card.append(header, level, summary, remove);
    elements.historyList.append(card);
  });
};

const setStep = (activeStep, progress = 0) => {
  const activeIndex = stepOrder.indexOf(activeStep);
  const [title, copy] = stepCopy[activeStep];
  elements.processingTitle.textContent = title;
  elements.processingCopy.textContent = activeStep === "frames" || activeStep === "pose"
    ? `${copy} · ${Math.round(progress * 100)}%`
    : copy;
  elements.progressSteps.forEach((item, index) => {
    item.classList.toggle("is-done", index < activeIndex);
    item.classList.toggle("is-active", index === activeIndex);
  });
};

const resetVideo = () => {
  selectedFile = null;
  elements.input.value = "";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  elements.preview.removeAttribute("src");
  elements.preview.load();
  elements.videoCard.classList.add("is-hidden");
  elements.uploadZone.classList.remove("is-hidden");
  elements.formError.textContent = "";
};

const selectVideo = (file) => {
  const validation = validateVideoFile(file);
  if (!validation.valid) {
    elements.formError.textContent = validation.reason;
    return;
  }
  resetVideo();
  selectedFile = file;
  previewUrl = URL.createObjectURL(file);
  elements.preview.src = previewUrl;
  elements.videoName.textContent = file.name;
  elements.videoDetail.textContent = formatBytes(file.size);
  elements.uploadZone.classList.add("is-hidden");
  elements.videoCard.classList.remove("is-hidden");
  elements.preview.addEventListener("loadedmetadata", () => {
    elements.videoDetail.textContent = `${formatBytes(file.size)} · ${formatTime(elements.preview.duration)}`;
  }, { once: true });
};

const formContext = () => {
  const data = new FormData(elements.form);
  return {
    horseName: String(data.get("horseName") || "").trim(),
    discipline: String(data.get("discipline") || "场地训练"),
    location: String(data.get("location") || "").trim(),
    note: String(data.get("note") || "").trim(),
    actualSessionMinutes: Number(data.get("actualSessionMinutes")) || null,
    perceivedIntensity: String(data.get("perceivedIntensity") || "").trim(),
    restNote: String(data.get("restNote") || "").trim(),
    authorized: elements.authorization.checked,
  };
};

const runAnalysis = async () => {
  elements.formError.textContent = "";
  if (window.location.protocol === "file:") {
    throw new Error("当前是离线文件预览，无法连接分析服务。请双击 启动SEEME-Agent.command 后，在自动打开的网页中分析视频。");
  }
  if (!selectedFile) throw new Error("请先选择一段骑乘视频。 ");
  const context = formContext();
  if (!context.authorized) throw new Error("请确认视频使用授权后再开始分析。");
  elements.analyzeButton.disabled = true;
  elements.reportSection.classList.add("is-hidden");
  elements.processingPanel.classList.remove("is-hidden");
  elements.processingPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  setStep("read");
  await new Promise((resolve) => setTimeout(resolve, 180));
  setStep("frames", 0);
  const evidence = await extractVideoEvidence(selectedFile, {
    frameCount: 2,
    maxDimension: 768,
    onProgress: (progress) => setStep("frames", progress),
  });
  setStep("pose", 0);
  const pose = await extractPoseFrames(selectedFile, {
    frameRate: 1,
    maxDimension: 960,
    onProgress: (progress) => setStep("pose", progress),
  });
  setStep("audio");
  await new Promise((resolve) => setTimeout(resolve, 180));
  setStep("evidence");
  const response = await fetch("/api/agent/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { ...context, durationSeconds: evidence.durationSeconds },
      frames: evidence.frames,
      poseFrames: pose.frames,
      audio: evidence.audio,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "模型暂时无法完成分析，请稍后重试。");
  setStep("report");
  await new Promise((resolve) => setTimeout(resolve, 260));
  const report = normalizeAgentReport({ ...body.report, trainingContext: context });
  replaceOrAddReport(report);
  renderReport(report);
};

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await runAnalysis();
  } catch (error) {
    elements.processingPanel.classList.add("is-hidden");
    elements.formError.textContent = error.message || "分析失败，请稍后重试。";
    elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    elements.analyzeButton.disabled = false;
  }
});

elements.input.addEventListener("change", () => selectVideo(elements.input.files?.[0]));
elements.removeVideo.addEventListener("click", resetVideo);
elements.uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.uploadZone.classList.add("is-dragging");
});
elements.uploadZone.addEventListener("dragleave", () => elements.uploadZone.classList.remove("is-dragging"));
elements.uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.uploadZone.classList.remove("is-dragging");
  selectVideo(event.dataTransfer.files?.[0]);
});

elements.reviewButtons.forEach((button) => button.addEventListener("click", () => {
  selectedReview = button.dataset.review;
  elements.reviewButtons.forEach((item) => item.classList.toggle("is-selected", item === button));
}));

elements.saveReview.addEventListener("click", () => {
  if (!activeReport) return;
  activeReport = normalizeAgentReport({
    ...activeReport,
    coachReview: { status: selectedReview, note: elements.coachNote.value.trim() },
  });
  replaceOrAddReport(activeReport);
  elements.saveReview.textContent = "已保存";
  setTimeout(() => { elements.saveReview.textContent = "保存复核"; }, 1200);
});

elements.printReport.addEventListener("click", () => window.print());
elements.newAnalysis.addEventListener("click", () => {
  elements.reportSection.classList.add("is-hidden");
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.clearHistory.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

renderHistory();

if (window.location.protocol === "file:") {
  elements.formError.textContent = "当前页面仅供预览。请双击 启动SEEME-Agent.command，使用自动打开的本机 Agent 分析视频。";
  elements.analyzeButton.disabled = true;
}
