const ATTENTION_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "INSUFFICIENT"]);
const REVIEW_STATUSES = new Set(["UNREVIEWED", "CONFIRMED", "EDITED", "NEEDS_MEDIA"]);
const POSE_STATUSES = new Set(["MEASURED", "INSUFFICIENT", "UNAVAILABLE", "UNSUPPORTED"]);
const ACTION_GROUPS = ["immediate", "duringSession", "afterRide", "professionalReview"];
const DIAGNOSTIC_PATTERNS = [
  /确诊/,
  /诊断为/,
  /一定(?:是|存在|患有)/,
  /百分之百/,
  /100%/,
  /立刻治疗/,
  /(?:立即|立刻|必须|直接).*(?:冰敷|治疗|用药)/,
  /确定(?:疼痛|快乐|焦虑|恐惧)/,
];

const toText = (value, fallback = "") => typeof value === "string" ? value.trim() || fallback : fallback;
const toList = (value) => Array.isArray(value) ? value : [];
const safeList = (value) => toList(value).map((item) => toText(item)).filter((item) => item && !isDiagnosticLanguage(item));

export const isDiagnosticLanguage = (text) => {
  const value = toText(text);
  return DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(value));
};

const safeSummary = (value) => {
  const summary = toText(value, "当前素材无法形成可靠结论，建议结合现场观察复核。");
  return isDiagnosticLanguage(summary)
    ? "当前素材无法形成可靠结论，建议结合现场观察复核。"
    : summary;
};

const possibilityText = (value) => {
  const text = isDiagnosticLanguage(value) ? "需要结合现场信息复核" : toText(value);
  if (!text || /可能|或与|需要|尚不能|无法/.test(text)) return text;
  return `可能${text}`;
};

const normalizeVisualEvidence = (value) => toList(value).map((item) => ({
  timeSeconds: Number.isFinite(Number(item?.timeSeconds)) ? Math.max(0, Number(item.timeSeconds)) : 0,
  horseObservation: toText(item?.horseObservation, toText(item?.observation)),
  riderObservation: toText(item?.riderObservation),
  interactionHypothesis: possibilityText(item?.interactionHypothesis ?? item?.inference),
  possibleImpact: possibilityText(item?.possibleImpact),
  adjustment: isDiagnosticLanguage(item?.adjustment) ? "请教练结合现场信息复核" : toText(item?.adjustment),
})).filter((item) => item.horseObservation || item.riderObservation);

const normalizeAudioEvidence = (value) => toList(value).map((item) => ({
  observation: toText(item?.observation),
  inference: isDiagnosticLanguage(item?.inference) ? "需要结合现场信息复核" : toText(item?.inference),
})).filter((item) => item.observation);

const deriveHeadline = (evidence) => {
  const combined = [evidence.horseObservation, evidence.riderObservation].filter(Boolean).join(" ");
  if (/跑步|高速|腾跃/.test(combined)) return "高速运动 人马姿态出现变化";
  if (/快步/.test(combined)) return "快步阶段 节奏与平衡需要观察";
  if (/慢步/.test(combined)) return "慢步阶段 观察放松与连接";
  return "运动片段 人马状态可供复核";
};

const normalizeTechnicalEvidence = (value = {}, fallback = {}) => ({
  horseObservation: toText(value.horseObservation, fallback.horseObservation),
  riderObservation: toText(value.riderObservation, fallback.riderObservation),
  interactionHypothesis: possibilityText(value.interactionHypothesis ?? fallback.interactionHypothesis),
  possibleImpact: possibilityText(value.possibleImpact ?? fallback.possibleImpact),
  measurements: safeList(value.measurements),
  confidence: Number.isFinite(Number(value.confidence))
    ? Math.min(1, Math.max(0, Number(value.confidence)))
    : null,
  limitations: safeList(value.limitations),
});

const normalizeSegments = (segments, visualEvidence) => {
  const source = toList(segments).length ? toList(segments) : visualEvidence.map((evidence) => ({
    startSeconds: evidence.timeSeconds,
    endSeconds: evidence.timeSeconds,
    headline: deriveHeadline(evidence),
    summaryLines: [evidence.horseObservation, evidence.riderObservation, evidence.adjustment],
    adjustment: evidence.adjustment,
    technicalEvidence: evidence,
  }));

  return source.map((segment) => {
    const startSeconds = Number.isFinite(Number(segment?.startSeconds ?? segment?.timeSeconds))
      ? Math.max(0, Number(segment.startSeconds ?? segment.timeSeconds))
      : 0;
    const endSeconds = Number.isFinite(Number(segment?.endSeconds))
      ? Math.max(startSeconds, Number(segment.endSeconds))
      : startSeconds;
    const technicalEvidence = normalizeTechnicalEvidence(segment?.technicalEvidence, segment || {});
    const summaryFallback = [
      technicalEvidence.horseObservation,
      technicalEvidence.riderObservation,
      toText(segment?.adjustment),
    ];
    const summaryLines = safeList(toList(segment?.summaryLines).length ? segment.summaryLines : summaryFallback).slice(0, 3);
    return {
      startSeconds,
      endSeconds,
      headline: toText(segment?.headline, deriveHeadline(technicalEvidence)),
      summaryLines,
      adjustment: isDiagnosticLanguage(segment?.adjustment) ? "请教练结合现场信息复核" : toText(segment?.adjustment),
      technicalEvidence,
    };
  }).filter((segment) => segment.summaryLines.length || segment.technicalEvidence.horseObservation || segment.technicalEvidence.riderObservation);
};

const normalizeTrainingContext = (value = {}) => ({
  actualSessionMinutes: Number.isFinite(Number(value.actualSessionMinutes)) && Number(value.actualSessionMinutes) > 0
    ? Number(value.actualSessionMinutes)
    : null,
  perceivedIntensity: toText(value.perceivedIntensity),
  restNote: toText(value.restNote),
});

const isLoadDurationAdvice = (text) => /(?:分钟|小时).*(?:训练|运动|休息|负荷)|(?:训练|运动|高强度|负荷).*(?:分钟|小时)/.test(text);

const normalizeActions = (value, recommendations, trainingContext) => {
  const hasLoadContext = trainingContext.actualSessionMinutes !== null && Boolean(trainingContext.perceivedIntensity);
  const source = value && typeof value === "object" ? value : { duringSession: recommendations };
  return Object.fromEntries(ACTION_GROUPS.map((group) => [
    group,
    safeList(source[group]).filter((item) => hasLoadContext || !isLoadDurationAdvice(item)),
  ]));
};

const normalizePoseMeasurements = (value) => {
  if (!value || typeof value !== "object") return null;
  return {
    horseMetrics: value.horseMetrics && typeof value.horseMetrics === "object" ? value.horseMetrics : {},
    riderMetrics: value.riderMetrics && typeof value.riderMetrics === "object" ? value.riderMetrics : {},
    segments: toList(value.segments),
    limitations: safeList(value.limitations),
    modelVersions: value.modelVersions && typeof value.modelVersions === "object" ? value.modelVersions : null,
  };
};

export const normalizeAgentReport = (input = {}) => {
  const confidence = Number(input.confidence);
  const mode = input.mode === "demo" || input.mode === "fallback" ? input.mode : "live";
  const reviewStatus = REVIEW_STATUSES.has(input.coachReview?.status)
    ? input.coachReview.status
    : "UNREVIEWED";
  const visualEvidence = normalizeVisualEvidence(input.visualEvidence);
  const trainingContext = normalizeTrainingContext(input.trainingContext);
  const recommendations = safeList(input.recommendations);

  return {
    id: toText(input.id, `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    createdAt: toText(input.createdAt, new Date().toISOString()),
    mode,
    attentionLevel: ATTENTION_LEVELS.has(input.attentionLevel) ? input.attentionLevel : "INSUFFICIENT",
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    summary: safeSummary(input.summary),
    visualEvidence,
    segments: normalizeSegments(input.segments, visualEvidence),
    audioEvidence: normalizeAudioEvidence(input.audioEvidence),
    positiveSignals: safeList(input.positiveSignals),
    uncertainties: safeList(input.uncertainties),
    recommendations,
    actions: normalizeActions(input.actions, recommendations, trainingContext),
    trainingContext,
    poseStatus: POSE_STATUSES.has(input.poseStatus) ? input.poseStatus : "UNAVAILABLE",
    poseMeasurements: normalizePoseMeasurements(input.poseMeasurements),
    coachReview: {
      status: reviewStatus,
      note: toText(input.coachReview?.note),
    },
    disclaimer: "本报告仅用于马匹福利观察与训练决策辅助，不构成医疗诊断，也不能替代兽医、教练或动物行为专家。",
  };
};

export const createDemoReport = (context = {}) => normalizeAgentReport({
  mode: "demo",
  attentionLevel: "INSUFFICIENT",
  confidence: 0.36,
  summary: `${toText(context.horseName, "该马匹")}的本次${toText(context.discipline, "训练")}为演示分析，尚未连接真实视觉模型。`,
  visualEvidence: [
    {
      timeSeconds: 2.4,
      horseObservation: "示例：马匹身体轮廓清晰，可继续观察耳位、头颈和步态变化。",
      riderObservation: "示例：骑手上身与手部位置可进入互动分析。",
      interactionHypothesis: "单一画面不足以判断人马连接，需要连续视频与现场信息。",
      possibleImpact: "当前无法判断对步态与背部摆动的影响。",
      adjustment: "连接真实模型后重新分析并请教练复核。",
    },
  ],
  audioEvidence: [{ observation: "示例：已读取基础声音强度。", inference: "环境声不能单独代表马匹状态。" }],
  positiveSignals: ["示例：运动节奏可作为后续连续观察基线"],
  uncertainties: ["当前为演示模式，未调用真实视觉模型", "短视频无法覆盖训练前后状态变化"],
  recommendations: ["连接模型后重新分析", "请教练结合现场反应复核"],
});
