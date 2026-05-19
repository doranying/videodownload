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
