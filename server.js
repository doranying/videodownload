import express from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 4173;
const downloadsDir = path.join(__dirname, "downloads");
const ytDlpBin = path.join(__dirname, ".venv", "bin", "yt-dlp");
const youtubeExtractorArgs = "youtube:player_client=tv";
const cookiePath =
  process.env.YOUTUBE_COOKIES_PATH || path.join(__dirname, "cookies", "youtube.txt");

fs.mkdirSync(downloadsDir, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(downloadsDir));

function isYoutubeUrl(value) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname);
  } catch {
    return false;
  }
}

function runYtDlp(args, onLine) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ytDlpBin)) {
      reject(new Error("yt-dlp is not installed. Run setup first."));
      return;
    }

    const finalArgs = fs.existsSync(cookiePath)
      ? ["--cookies", cookiePath, ...args]
      : args;
    const child = spawn(ytDlpBin, finalArgs, { cwd: downloadsDir });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onLine?.(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onLine?.(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

function collectFilesBefore() {
  return new Map(
    fs.readdirSync(downloadsDir).map((name) => {
      const stat = fs.statSync(path.join(downloadsDir, name));
      return [name, `${stat.size}:${stat.mtimeMs}`];
    })
  );
}

function collectNewFiles(before) {
  return fs
    .readdirSync(downloadsDir)
    .filter((name) => {
      const stat = fs.statSync(path.join(downloadsDir, name));
      return before.get(name) !== `${stat.size}:${stat.mtimeMs}`;
    })
    .map((name) => {
      const stat = fs.statSync(path.join(downloadsDir, name));
      return {
        name,
        size: stat.size,
        url: `/downloads/${encodeURIComponent(name)}`
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getVideoInfo(url) {
  const { stdout, stderr } = await runYtDlp([
    "--dump-single-json",
    "--skip-download",
    "--ignore-no-formats",
    "--no-warnings",
    "--no-playlist",
    "--extractor-args",
    youtubeExtractorArgs,
    url
  ]);
  const data = JSON.parse(stdout);
  return {
    raw: data,
    warnings: stderr
      .split("\n")
      .filter((line) => line.includes("WARNING"))
      .slice(-6)
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    downloaderReady: fs.existsSync(ytDlpBin)
  });
});

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!isYoutubeUrl(url)) {
    res.status(400).json({ error: "请输入有效的 YouTube 链接。" });
    return;
  }

  try {
    const { raw: data, warnings } = await getVideoInfo(url);
    const subtitles = Object.keys(data.subtitles || {});
    const automaticCaptions = Object.keys(data.automatic_captions || {});
    res.json({
      id: data.id,
      title: data.title,
      uploader: data.uploader,
      duration: data.duration,
      thumbnail: data.thumbnail,
      subtitles,
      automaticCaptions,
      warnings
    });
  } catch (error) {
    res.status(500).json({ error: cleanError(error.message) });
  }
});

app.post("/api/download", async (req, res) => {
  const {
    url,
    language = "zh-Hans",
    useAutoCaptions = true,
    subtitleOnly = false,
    subtitleFormat = "srt"
  } = req.body;

  if (!isYoutubeUrl(url)) {
    res.status(400).json({ error: "请输入有效的 YouTube 链接。" });
    return;
  }

  const before = collectFilesBefore();
  const subtitleLanguage = normalizeSubtitleLanguage(language);
  const output = "%(title).180B [%(id)s].%(ext)s";

  try {
    if (!subtitleOnly) {
      await runYtDlp([
        "--no-playlist",
        "--restrict-filenames",
        "--windows-filenames",
        "-f",
        "b[ext=mp4]/b",
        "-o",
        output,
        url
      ]);
    }

    const subtitleNotice = await downloadSubtitleFile({
      url,
      language: subtitleLanguage,
      subtitleFormat,
      useAutoCaptions
    });

    const files = collectNewFiles(before);
    const diagnosis = files.length ? null : await buildNoFileDiagnosis(url, subtitleLanguage);
    res.json({ files, diagnosis, notice: subtitleNotice });
  } catch (error) {
    res.status(500).json({ error: cleanError(error.message) });
  }
});

async function buildNoFileDiagnosis(url, language) {
  try {
    const { raw } = await getVideoInfo(url);
    const subtitles = Object.keys(raw.subtitles || {});
    const automaticCaptions = Object.keys(raw.automatic_captions || {});
    if (!subtitles.length && !automaticCaptions.length) {
      return "这个视频没有向下载工具公开外挂字幕轨；画面里的字幕可能是视频内嵌文字，无法直接下载成字幕文件。";
    }
    if (!subtitles.includes(language) && !automaticCaptions.includes(language)) {
      return `没有找到 ${language} 字幕。可用字幕语言：${[...new Set([...subtitles, ...automaticCaptions])].slice(0, 40).join(", ")}`;
    }
    return "下载工具完成了处理，但没有写出新文件；可能是同名文件已经存在且内容未变化。";
  } catch {
    return "下载工具完成了处理，但没有写出新文件。";
  }
}

async function downloadSubtitleFile({ url, language, subtitleFormat, useAutoCaptions }) {
  const { raw } = await getVideoInfo(url);
  try {
    await writeSubtitleWithYtDlp({ url, language, subtitleFormat, useAutoCaptions });
    return null;
  } catch (error) {
    const originalLanguage = findOriginalCaptionLanguage(raw);
    if (!originalLanguage || originalLanguage === language) {
      throw error;
    }

    await writeSubtitleWithYtDlp({
      url,
      language: originalLanguage,
      subtitleFormat,
      useAutoCaptions
    });
    return `${language} 自动翻译字幕下载失败，已改为保存原始字幕 ${originalLanguage}。YouTube 对自动翻译字幕接口有时会限流。`;
  }
}

async function writeSubtitleWithYtDlp({ url, language, subtitleFormat, useAutoCaptions }) {
  const args = [
    "--no-playlist",
    "--skip-download",
    "--ignore-no-formats",
    "--sub-langs",
    language,
    "--sub-format",
    `${subtitleFormat}/vtt/best`,
    "--extractor-args",
    youtubeExtractorArgs,
    "--restrict-filenames",
    "--windows-filenames",
    "-o",
    "%(title).180B [%(id)s].%(ext)s"
  ];

  if (useAutoCaptions) {
    args.push("--write-auto-subs");
  } else {
    args.push("--write-subs");
  }

  if (subtitleFormat === "srt") {
    args.push("--convert-subs", "srt");
  }

  args.push(url);
  await runYtDlp(args);
}

async function writeSubtitleFromInfo({ raw, language, subtitleFormat, useAutoCaptions }) {
  const groups = [];
  if (raw.subtitles?.[language]) groups.push(raw.subtitles[language]);
  if (useAutoCaptions && raw.automatic_captions?.[language]) groups.push(raw.automatic_captions[language]);

  const candidates = groups.flat();
  if (!candidates.length) throw new Error(`没有找到 ${language} 字幕。`);

  const source =
    candidates.find((item) => item.ext === "vtt") ||
    candidates.find((item) => item.ext === subtitleFormat) ||
    candidates.find((item) => item.ext === "json3") ||
    candidates[0];

  const response = await fetch(source.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`字幕下载失败：HTTP ${response.status}`);
  }

  const text = await response.text();
  const ext = subtitleFormat === "srt" ? "srt" : "vtt";
  const content =
    ext === "srt"
      ? source.ext === "json3"
        ? json3ToSrt(JSON.parse(text))
        : vttToSrt(text)
      : source.ext === "json3"
        ? json3ToVtt(JSON.parse(text))
        : text;

  const base = sanitizeFileName(`${raw.title || raw.id || "youtube-video"} [${raw.id}]`);
  const fileName = `${base}.${language}.${ext}`;
  fs.writeFileSync(path.join(downloadsDir, fileName), content);
  return fileName;
}

function findOriginalCaptionLanguage(raw) {
  const captions = raw.automatic_captions || {};
  return (
    Object.keys(captions).find((lang) => lang.endsWith("-orig")) ||
    Object.keys(captions).find((lang) => lang === "ko") ||
    Object.keys(captions)[0]
  );
}

function sanitizeFileName(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function vttToSrt(vtt) {
  const blocks = vtt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !block.startsWith("WEBVTT") && !block.startsWith("Kind:") && !block.startsWith("Language:"));

  let index = 1;
  return (
    blocks
      .map((block) => {
        const lines = block.split("\n").filter((line) => !/^\d+$/.test(line.trim()));
        const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
        if (timeLineIndex === -1) return null;
        const timeLine = lines[timeLineIndex].replace(
          /(\d{2}:\d{2}:\d{2})\.(\d{3})/g,
          "$1,$2"
        );
        const textLines = lines.slice(timeLineIndex + 1).map(cleanCaptionText).filter(Boolean);
        if (!textLines.length) return null;
        return `${index++}\n${timeLine}\n${textLines.join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}

function json3ToSrt(json) {
  let index = 1;
  return (
    (json.events || [])
      .map((event) => {
        const text = (event.segs || []).map((seg) => seg.utf8 || "").join("").trim();
        if (!text) return null;
        const start = event.tStartMs || 0;
        const end = start + (event.dDurationMs || 2000);
        return `${index++}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${cleanCaptionText(text)}`;
      })
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}

function json3ToVtt(json) {
  return "WEBVTT\n\n" + json3ToSrt(json).replace(/,/g, ".");
}

function formatSrtTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function cleanCaptionText(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeSubtitleLanguage(language) {
  const aliases = {
    "zh-CN": "zh-Hans",
    "zh-TW": "zh-Hant"
  };
  return aliases[language] || language;
}

function cleanError(message) {
  return message
    .split("\n")
    .filter((line) => line.trim())
    .slice(-8)
    .join("\n");
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
