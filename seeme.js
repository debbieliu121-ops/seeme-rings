const details = [
  {
    id: "01",
    label: "REIN PRESSURE",
    title: "双通道缰绳压力",
    text: "左右两侧微型力传感器以 100Hz 捕捉接触变化，识别持续拉力、瞬时冲击与手部不对称。",
    spec: "100 HZ / ±0.1 N",
  },
  {
    id: "02",
    label: "RIDER BIOMETRICS",
    title: "骑手生理信号",
    text: "内侧光学模组读取心率与节律变化，帮助理解紧张、专注与动作之间的时序关系。",
    spec: "PPG / HRV READY",
  },
  {
    id: "03",
    label: "HAPTIC LANGUAGE",
    title: "克制的触觉反馈",
    text: "训练中不看屏幕。戒指通过轻微触觉节奏提示失衡或压力峰值，让注意力始终留在马身上。",
    spec: "3 HAPTIC PATTERNS",
  },
  {
    id: "04",
    label: "EDGE INTELLIGENCE",
    title: "在动作发生时理解",
    text: "SEIS 将压力、心率和时间上下文在端侧融合，输出可解释的连接状态，而不是一串孤立数字。",
    spec: "ON-DEVICE FUSION",
  },
];

const modes = {
  contact: { left: 31, right: 34, heart: 78 },
  transition: { left: 44, right: 50, heart: 91 },
  turn: { left: 68, right: 48, heart: 104 },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const menuButton = $(".menu-button");
const nav = $(".nav-links");
menuButton.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(open));
});
$$('.nav-links a').forEach((link) => link.addEventListener("click", () => {
  nav.classList.remove("is-open");
  menuButton.setAttribute("aria-expanded", "false");
}));

const progress = $(".scroll-progress");
const updateProgress = () => {
  const total = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${total > 0 ? window.scrollY / total : 0})`;
};
updateProgress();
window.addEventListener("scroll", updateProgress, { passive: true });

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
$$('.reveal').forEach((element) => observer.observe(element));

const telemetry = $(".hero-telemetry");
const telemetryLabel = telemetry.querySelector("b");
for (let index = 0; index < 22; index += 1) {
  const bar = document.createElement("i");
  bar.style.height = `${14 + ((index * 17) % 38)}%`;
  bar.style.animationDelay = `${index * -0.07}s`;
  telemetry.insertBefore(bar, telemetryLabel);
}

const addTilt = (stage, target, amount) => {
  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    if (target.classList.contains("ring-image-wrap")) {
      target.style.transform = `perspective(1000px) rotateX(${y * amount * -1}deg) rotateY(${x * amount}deg) scale(1.025)`;
    } else {
      target.style.transform = `translate3d(${x * amount * -1}px, ${y * amount * -0.7}px, 0) scale(1.03)`;
      $(".hero-beam").style.transform = `translate3d(${x * amount * 2.7}px, ${y * amount * 1.8}px, 0) rotate(-16deg)`;
    }
  });
  stage.addEventListener("pointerleave", () => {
    target.style.transform = target.classList.contains("ring-image-wrap")
      ? "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1.025)"
      : "translate3d(0,0,0) scale(1.03)";
  });
};
addTilt($(".hero"), $(".hero-horse-wrap"), 13);
addTilt($(".ring-stage"), $(".ring-image-wrap"), 8);

const detailControls = $$('[data-detail]');
const selectDetail = (index) => {
  const detail = details[index];
  detailControls.forEach((control) => {
    const active = Number(control.dataset.detail) === index;
    control.classList.toggle("active", active);
    if (control.getAttribute("role") === "tab") control.setAttribute("aria-selected", String(active));
  });
  $(".detail-label").textContent = `${detail.id} / ${detail.label}`;
  $(".detail-spec").textContent = detail.spec;
  $(".detail-title").textContent = detail.title;
  $(".detail-text").textContent = detail.text;
};
detailControls.forEach((control) => control.addEventListener("click", () => selectDetail(Number(control.dataset.detail))));

let leftPressure = modes.contact.left;
let rightPressure = modes.contact.right;
let heartRate = modes.contact.heart;
let live = true;

const leftRange = $(".left-range");
const rightRange = $(".right-range");

const updateSignal = () => {
  const delta = Math.abs(leftPressure - rightPressure);
  const balance = clamp(100 - delta * 2.15, 0, 100);
  const contact = (leftPressure + rightPressure) / 2;
  const state = delta > 16 ? "ASYMMETRIC" : contact > 63 ? "OVER-CONTACT" : contact < 23 ? "DISCONNECTED" : "BALANCED";
  const notes = {
    "ASYMMETRIC": "左右信号差异明显。SEIS 建议检查外侧手是否持续施压。",
    "OVER-CONTACT": "接触持续偏高。尝试放松手指，让缰绳重新传递细微信息。",
    "DISCONNECTED": "连接信号较弱。保持柔软、连续的接触，而不是突然收紧。",
    "BALANCED": "节奏稳定，左右接触接近。保持呼吸与肘部的弹性。",
  };

  $(".left-value").textContent = leftPressure;
  $(".right-value").textContent = rightPressure;
  $(".heart-value").textContent = heartRate;
  $(".score-value").textContent = Math.round(balance);
  $(".left-control-value").textContent = `${leftPressure}%`;
  $(".right-control-value").textContent = `${rightPressure}%`;
  $(".state-value").textContent = state;
  $(".signal-note").textContent = notes[state];
  $(".left-bar").style.transform = `scaleX(${leftPressure / 100})`;
  $(".right-bar").style.transform = `scaleX(${rightPressure / 100})`;
  $(".heart-bar").style.transform = `scaleX(${heartRate / 130})`;
  $(".score-bar").style.transform = `scaleX(${balance / 100})`;
  const ring = $(".balance-ring");
  ring.style.setProperty("--score", `${balance * 3.6}deg`);
  ring.classList.toggle("warning", balance < 70);
  ring.querySelector("span").textContent = Math.round(balance);
  leftRange.value = leftPressure;
  rightRange.value = rightPressure;
};

const setLive = (next) => {
  live = next;
  $(".live-dot").classList.toggle("is-live", live);
  $(".live-dot").textContent = live ? "LIVE" : "PAUSED";
  $(".signal-toggle").textContent = live ? "PAUSE SIGNAL" : "RESUME SIGNAL";
};

$(".signal-toggle").addEventListener("click", () => setLive(!live));
$$('[data-mode]').forEach((button) => button.addEventListener("click", () => {
  const selected = modes[button.dataset.mode];
  leftPressure = selected.left;
  rightPressure = selected.right;
  heartRate = selected.heart;
  setLive(true);
  $$('[data-mode]').forEach((item) => item.classList.toggle("active", item === button));
  updateSignal();
}));

leftRange.addEventListener("input", (event) => {
  leftPressure = Number(event.target.value);
  setLive(false);
  updateSignal();
});
rightRange.addEventListener("input", (event) => {
  rightPressure = Number(event.target.value);
  setLive(false);
  updateSignal();
});

window.setInterval(() => {
  if (!live) return;
  leftPressure = clamp(Math.round(leftPressure + (Math.random() - 0.5) * 4), 10, 86);
  rightPressure = clamp(Math.round(rightPressure + (Math.random() - 0.5) * 4), 10, 86);
  heartRate = clamp(Math.round(heartRate + (Math.random() - 0.48) * 3), 66, 122);
  updateSignal();
}, 900);

const canvas = $(".waveform");
const context = canvas.getContext("2d");
let frame = 0;
const drawSignal = (pressure, color, offset, width, height) => {
  const amplitude = 7 + pressure * 0.16;
  context.beginPath();
  for (let x = 0; x <= width; x += 3) {
    const time = x / width;
    const flutter = Math.sin(time * 46 + frame * 0.045 + offset) * amplitude * 0.16;
    const wave = Math.sin(time * 13 + frame * 0.026 + offset) * amplitude;
    const pulse = Math.exp(-Math.pow(((time + frame * 0.0018) % 1) - 0.62, 2) / 0.002) * pressure * 0.34;
    const y = height * 0.52 + wave + flutter - pulse;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.strokeStyle = color;
  context.lineWidth = 1.45;
  context.shadowColor = color;
  context.shadowBlur = 8;
  context.stroke();
  context.shadowBlur = 0;
};

const renderWaveform = () => {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,.08)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += width / 8) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = 0; y <= height; y += height / 4) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  drawSignal(leftPressure, "rgba(239,242,238,.92)", 0, width, height);
  drawSignal(rightPressure, "rgba(153,255,207,.78)", 1.4, width, height);
  frame += live ? 1 : 0.16;
  requestAnimationFrame(renderWaveform);
};

updateSignal();
renderWaveform();
