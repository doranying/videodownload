const statusEl = document.querySelector("#status");
const form = document.querySelector("#downloadForm");
const fetchInfoButton = document.querySelector("#fetchInfo");
const infoEl = document.querySelector("#videoInfo");
const resultEl = document.querySelector("#result");

const fields = {
  url: document.querySelector("#url"),
  language: document.querySelector("#language"),
  useAutoCaptions: document.querySelector("#useAutoCaptions"),
  subtitleOnly: document.querySelector("#subtitleOnly"),
  subtitleFormat: document.querySelector("#subtitleFormat")
};

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function payload() {
  return {
    url: fields.url.value.trim(),
    language: fields.language.value,
    useAutoCaptions: fields.useAutoCaptions.checked,
    subtitleOnly: fields.subtitleOnly.checked,
    subtitleFormat: fields.subtitleFormat.value
  };
}

function setBusy(isBusy, text) {
  fetchInfoButton.disabled = isBusy;
  form.querySelector(".primary").disabled = isBusy;
  if (text) statusEl.textContent = text;
}

async function checkHealth() {
  const response = await fetch("/api/health");
  const data = await response.json();
  statusEl.textContent = data.downloaderReady ? "工具已就绪" : "需要安装工具";
  statusEl.classList.toggle("ready", data.downloaderReady);
}

function renderInfo(data) {
  const languages = [...new Set([...data.subtitles, ...data.automaticCaptions])].sort();
  infoEl.hidden = false;
  const languageBlock = languages.length
    ? `<div class="chips">
        ${languages.slice(0, 28).map((lang) => `<button type="button" class="chip" data-lang="${escapeHtml(lang)}">${escapeHtml(lang)}</button>`).join("")}
      </div>`
    : `<p class="notice">没有检测到 YouTube 公开的外挂字幕轨。画面中已经压进去的字幕不能直接提取为字幕文件。</p>`;
  infoEl.innerHTML = `
    <div class="videoCard">
      ${data.thumbnail ? `<img src="${data.thumbnail}" alt="">` : "<div></div>"}
      <div>
        <h2>${escapeHtml(data.title || "未命名视频")}</h2>
        <p>${escapeHtml(data.uploader || "")}</p>
        ${languageBlock}
        ${data.warnings?.length ? `<p class="warning">${escapeHtml(data.warnings.join("\n"))}</p>` : ""}
      </div>
    </div>
  `;
  infoEl.querySelectorAll("[data-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      const lang = button.dataset.lang;
      if (![...fields.language.options].some((option) => option.value === lang)) {
        fields.language.add(new Option(lang, lang));
      }
      fields.language.value = lang;
    });
  });
}

function renderFiles(files, notice) {
  resultEl.hidden = false;
  if (!files.length) {
    resultEl.innerHTML = `<h2>没有生成新文件</h2><p>${escapeHtml(window.lastDiagnosis || "这个视频可能没有匹配语言的字幕，或下载工具没有拿到可用资源。")}</p>`;
    return;
  }
  resultEl.innerHTML = `
    <h2>下载完成</h2>
    ${notice ? `<p class="warning">${escapeHtml(notice)}</p>` : ""}
    <ul class="files">
      ${files.map((file) => `<li><a href="${file.url}" download>${escapeHtml(file.name)} · ${formatSize(file.size)}</a></li>`).join("")}
    </ul>
  `;
}

function renderError(error) {
  resultEl.hidden = false;
  resultEl.innerHTML = `<h2>处理失败</h2><p class="error">${escapeHtml(error.message)}</p>`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

fetchInfoButton.addEventListener("click", async () => {
  resultEl.hidden = true;
  setBusy(true, "读取中");
  try {
    renderInfo(await postJson("/api/info", { url: fields.url.value.trim() }));
    statusEl.textContent = "已读取";
  } catch (error) {
    renderError(error);
    statusEl.textContent = "读取失败";
  } finally {
    setBusy(false);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultEl.hidden = true;
  setBusy(true, "下载中");
  try {
    const data = await postJson("/api/download", payload());
    window.lastDiagnosis = data.diagnosis;
    renderFiles(data.files, data.notice);
    statusEl.textContent = "下载完成";
  } catch (error) {
    renderError(error);
    statusEl.textContent = "下载失败";
  } finally {
    setBusy(false);
  }
});

checkHealth();

const ocr = {
  file: document.querySelector("#ocrVideoFile"),
  video: document.querySelector("#ocrVideo"),
  overlay: document.querySelector("#ocrOverlay"),
  language: document.querySelector("#ocrLanguage"),
  interval: document.querySelector("#ocrInterval"),
  endTime: document.querySelector("#ocrEndTime"),
  picker: document.querySelector(".videoPicker"),
  back10: document.querySelector("#ocrBack10"),
  forward10: document.querySelector("#ocrForward10"),
  selectMode: document.querySelector("#ocrSelectMode"),
  timeReadout: document.querySelector("#ocrTimeReadout"),
  preview: document.querySelector("#ocrPreview"),
  start: document.querySelector("#ocrStart"),
  cancel: document.querySelector("#ocrCancel"),
  output: document.querySelector("#ocrOutput"),
  selection: null,
  dragStart: null,
  selectionMode: false,
  activeJob: null,
  lastSrt: ""
};

const overlayContext = ocr.overlay.getContext("2d");

ocr.file.addEventListener("change", () => {
  const file = ocr.file.files?.[0];
  if (!file) return;
  ocr.video.src = URL.createObjectURL(file);
  ocr.selection = null;
  drawOverlay();
});

ocr.video.addEventListener("loadedmetadata", () => {
  resizeOverlay();
  updateOcrTimeReadout();
  if (!ocr.endTime.value) {
    ocr.endTime.placeholder = `${Math.floor(ocr.video.duration)} 秒`;
  }
});

ocr.video.addEventListener("timeupdate", updateOcrTimeReadout);
ocr.video.addEventListener("durationchange", updateOcrTimeReadout);

window.addEventListener("resize", resizeOverlay);

ocr.overlay.addEventListener("pointerdown", (event) => {
  if (!ocr.selectionMode) return;
  resizeOverlay();
  ocr.dragStart = pointerPoint(event);
  ocr.selection = { x: ocr.dragStart.x, y: ocr.dragStart.y, w: 0, h: 0 };
  ocr.overlay.setPointerCapture(event.pointerId);
});

ocr.overlay.addEventListener("pointermove", (event) => {
  if (!ocr.dragStart) return;
  const point = pointerPoint(event);
  const x = Math.min(point.x, ocr.dragStart.x);
  const y = Math.min(point.y, ocr.dragStart.y);
  const w = Math.abs(point.x - ocr.dragStart.x);
  const h = Math.abs(point.y - ocr.dragStart.y);
  ocr.selection = { x, y, w, h };
  drawOverlay();
});

ocr.overlay.addEventListener("pointerup", () => {
  ocr.dragStart = null;
  setSelectionMode(false);
  drawOverlay();
});

ocr.selectMode.addEventListener("click", () => {
  setSelectionMode(!ocr.selectionMode);
});

ocr.back10.addEventListener("click", () => {
  if (!Number.isFinite(ocr.video.duration)) return;
  ocr.video.currentTime = Math.max(0, ocr.video.currentTime - 10);
});

ocr.forward10.addEventListener("click", () => {
  if (!Number.isFinite(ocr.video.duration)) return;
  ocr.video.currentTime = Math.min(ocr.video.duration, ocr.video.currentTime + 10);
});

ocr.cancel.addEventListener("click", () => {
  cancelOcrJob("已取消 OCR");
});

ocr.preview.addEventListener("click", async () => {
  const job = createOcrJob();
  try {
    requireOcrReady();
    setOcrBusy(true, "预览识别中");
    const text = await recognizeCurrentFrame(job);
    renderOcrText(text || "没有识别到文字。");
    statusEl.textContent = "预览完成";
  } catch (error) {
    renderOcrText(`${job.cancelled ? "预览已取消" : "预览失败"}：${error.message}`);
    statusEl.textContent = job.cancelled ? "预览已取消" : "预览失败";
  } finally {
    await finishOcrJob(job);
    setOcrBusy(false);
  }
});

ocr.start.addEventListener("click", async () => {
  const job = createOcrJob();
  try {
    requireOcrReady();
    setOcrBusy(true, "OCR 处理中");
    const cues = await buildOcrCues(job);
    const srt = cuesToSrt(cues);
    renderOcrText(srt || "没有识别到可写入字幕的文字。", srt);
    statusEl.textContent = "OCR 完成";
  } catch (error) {
    renderOcrText(`${job.cancelled ? "OCR 已取消" : "OCR 失败"}：${error.message}`);
    statusEl.textContent = job.cancelled ? "OCR 已取消" : "OCR 失败";
  } finally {
    await finishOcrJob(job);
    setOcrBusy(false);
  }
});

function resizeOverlay() {
  const rect = ocr.overlay.getBoundingClientRect();
  ocr.overlay.width = Math.max(1, Math.round(rect.width));
  ocr.overlay.height = Math.max(1, Math.round(rect.height));
  drawOverlay();
}

function drawOverlay() {
  overlayContext.clearRect(0, 0, ocr.overlay.width, ocr.overlay.height);
  if (ocr.selectionMode) {
    overlayContext.fillStyle = "rgba(0, 0, 0, 0.18)";
    overlayContext.fillRect(0, 0, ocr.overlay.width, ocr.overlay.height);
  }
  if (!ocr.selection || ocr.selection.w < 4 || ocr.selection.h < 4) return;

  const { x, y, w, h } = ocr.selection;
  overlayContext.clearRect(x, y, w, h);
  overlayContext.strokeStyle = "#ff4d4f";
  overlayContext.lineWidth = 3;
  overlayContext.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3));
  overlayContext.fillStyle = "rgba(255, 77, 79, 0.16)";
  overlayContext.fillRect(x, y, w, h);
}

function setSelectionMode(isActive) {
  ocr.selectionMode = isActive;
  ocr.picker.classList.toggle("selecting", isActive);
  ocr.selectMode.textContent = isActive ? "完成框选" : "框选字幕区域";
  ocr.video.controls = !isActive;
  drawOverlay();
}

function pointerPoint(event) {
  const rect = ocr.overlay.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height)
  };
}

function requireOcrReady() {
  if (!window.Tesseract) {
    throw new Error("OCR 组件还没有加载完成，请稍后再试。");
  }
  if (!ocr.video.src || !Number.isFinite(ocr.video.duration)) {
    throw new Error("请先选择一个本地视频。");
  }
  if (!ocr.selection || ocr.selection.w < 20 || ocr.selection.h < 20) {
    throw new Error("请先在视频画面上框选字幕区域。");
  }
}

function setOcrBusy(isBusy, text) {
  ocr.preview.disabled = isBusy;
  ocr.start.disabled = isBusy;
  ocr.cancel.disabled = !isBusy;
  ocr.file.disabled = isBusy;
  ocr.language.disabled = isBusy;
  ocr.interval.disabled = isBusy;
  ocr.endTime.disabled = isBusy;
  ocr.selectMode.disabled = isBusy;
  if (text) statusEl.textContent = text;
}

function createOcrJob() {
  const job = {
    cancelled: false,
    worker: null,
    language: ocr.language.value
  };
  ocr.activeJob = job;
  return job;
}

async function finishOcrJob(job) {
  if (job.worker) {
    await job.worker.terminate().catch(() => {});
    job.worker = null;
  }
  if (ocr.activeJob === job) {
    ocr.activeJob = null;
  }
}

function cancelOcrJob(message) {
  const job = ocr.activeJob;
  if (!job) return;
  job.cancelled = true;
  statusEl.textContent = message;
  if (job.worker) {
    job.worker.terminate().catch(() => {});
    job.worker = null;
  }
}

async function getOcrWorker(job) {
  throwIfCancelled(job);
  if (!job.worker) {
    statusEl.textContent = "加载 OCR 模型中";
    job.worker = await Tesseract.createWorker(job.language, 1, {
      logger: (message) => {
        if (job.cancelled) return;
        if (message.status === "recognizing text") {
          statusEl.textContent = `OCR ${Math.round((message.progress || 0) * 100)}%`;
        } else if (message.status) {
          statusEl.textContent = message.status;
        }
      }
    });
  }
  throwIfCancelled(job);
  return job.worker;
}

function throwIfCancelled(job) {
  if (job?.cancelled) {
    throw new Error("任务已取消。");
  }
}

async function recognizeCurrentFrame(job) {
  const canvas = captureSelection();
  const worker = await getOcrWorker(job);
  throwIfCancelled(job);
  const result = await worker.recognize(canvas);
  throwIfCancelled(job);
  return cleanOcrText(result.data.text);
}

async function buildOcrCues(job) {
  const interval = Number(ocr.interval.value);
  const duration = Math.min(
    Number(ocr.endTime.value) || ocr.video.duration,
    ocr.video.duration
  );
  const rawCues = [];

  for (let time = 0; time < duration; time += interval) {
    throwIfCancelled(job);
    await seekVideo(time);
    statusEl.textContent = `OCR ${Math.min(duration, time).toFixed(1)} / ${duration.toFixed(1)} 秒`;
    const text = await recognizeCurrentFrame(job);
    if (text) {
      rawCues.push({
        start: time,
        end: Math.min(time + interval, duration),
        text
      });
    }
  }

  return mergeCues(rawCues, interval);
}

function updateOcrTimeReadout() {
  const current = Number.isFinite(ocr.video.currentTime) ? ocr.video.currentTime : 0;
  const duration = Number.isFinite(ocr.video.duration) ? ocr.video.duration : 0;
  ocr.timeReadout.textContent = `${formatClock(current)} / ${formatClock(duration)}`;
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function captureSelection() {
  const crop = selectionToVideoPixels();
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const context = canvas.getContext("2d");
  context.drawImage(
    ocr.video,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    0,
    0,
    canvas.width,
    canvas.height
  );
  boostContrast(context, canvas.width, canvas.height);
  return canvas;
}

function selectionToVideoPixels() {
  const display = videoDisplayRect();
  const sx = clamp(ocr.selection.x - display.x, 0, display.w);
  const sy = clamp(ocr.selection.y - display.y, 0, display.h);
  const sw = clamp(ocr.selection.w, 1, display.w - sx);
  const sh = clamp(ocr.selection.h, 1, display.h - sy);

  return {
    x: (sx / display.w) * ocr.video.videoWidth,
    y: (sy / display.h) * ocr.video.videoHeight,
    w: (sw / display.w) * ocr.video.videoWidth,
    h: (sh / display.h) * ocr.video.videoHeight
  };
}

function videoDisplayRect() {
  const canvasRatio = ocr.overlay.width / ocr.overlay.height;
  const videoRatio = ocr.video.videoWidth / ocr.video.videoHeight;
  if (videoRatio > canvasRatio) {
    const h = ocr.overlay.width / videoRatio;
    return { x: 0, y: (ocr.overlay.height - h) / 2, w: ocr.overlay.width, h };
  }
  const w = ocr.overlay.height * videoRatio;
  return { x: (ocr.overlay.width - w) / 2, y: 0, w, h: ocr.overlay.height };
}

function boostContrast(context, width, height) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = gray > 150 ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

function seekVideo(time) {
  return new Promise((resolve, reject) => {
    const target = Math.min(time, Math.max(0, ocr.video.duration - 0.1));
    if (Math.abs(ocr.video.currentTime - target) < 0.05) {
      window.setTimeout(resolve, 80);
      return;
    }
    const done = () => {
      ocr.video.removeEventListener("seeked", done);
      resolve();
    };
    const fail = () => {
      ocr.video.removeEventListener("error", fail);
      reject(new Error("视频跳转失败。"));
    };
    ocr.video.addEventListener("seeked", done, { once: true });
    ocr.video.addEventListener("error", fail, { once: true });
    ocr.video.currentTime = target;
  });
}

function cleanOcrText(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[|＿_]{2,}/g, "")
    .trim();
}

function mergeCues(cues, interval) {
  const merged = [];
  for (const cue of cues) {
    const last = merged[merged.length - 1];
    if (last && normalizeText(last.text) === normalizeText(cue.text) && cue.start - last.end <= interval + 0.1) {
      last.end = cue.end;
    } else {
      merged.push({ ...cue });
    }
  }
  return merged;
}

function normalizeText(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function cuesToSrt(cues) {
  return cues
    .map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`)
    .join("\n\n");
}

function formatTimestamp(seconds) {
  const ms = Math.floor((seconds % 1) * 1000);
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function renderOcrText(text, srt) {
  ocr.output.hidden = false;
  ocr.lastSrt = srt || "";
  ocr.output.innerHTML = `
    <textarea spellcheck="false">${escapeHtml(text)}</textarea>
    ${srt ? `<button class="downloadButton" type="button" id="ocrDownloadSrt">下载 SRT</button>` : ""}
  `;
  document.querySelector("#ocrDownloadSrt")?.addEventListener("click", downloadOcrSrt);
}

function downloadOcrSrt() {
  if (!ocr.lastSrt) return;
  const blob = new Blob([ocr.lastSrt], { type: "application/x-subrip;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ocr-subtitles.srt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
