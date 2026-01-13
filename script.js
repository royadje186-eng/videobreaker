// script.js (REPLACE ENTIRE FILE)

const videoInput = document.getElementById("videoInput");
const processButton = document.getElementById("processButton");
const downloadZipButton = document.getElementById("downloadZipButton");
const clipDurationSelect = document.getElementById("clipDuration");
const maxFramesInput = document.getElementById("maxFrames");

const outputDiv = document.getElementById("output");
const statusDiv = document.getElementById("status");

const hiddenVideo = document.getElementById("hiddenVideo");
const hiddenCanvas = document.getElementById("hiddenCanvas");
const ctx = hiddenCanvas.getContext("2d", { willReadFrequently: false });

let extracted = []; // { time, blob, url, filename }

function setStatus(msg) {
  statusDiv.textContent = msg;
}

function waitForEvent(target, eventName) {
  return new Promise((resolve) => {
    const handler = () => {
      target.removeEventListener(eventName, handler);
      resolve();
    };
    target.addEventListener(eventName, handler);
  });
}

async function loadVideoFromFile(file) {
  // Clean up old URLs
  if (hiddenVideo.src && hiddenVideo.src.startsWith("blob:")) {
    URL.revokeObjectURL(hiddenVideo.src);
  }

  const url = URL.createObjectURL(file);
  hiddenVideo.src = url;

  // Wait for metadata so we know duration + dimensions
  await waitForEvent(hiddenVideo, "loadedmetadata");

  // Set canvas to video dimensions
  hiddenCanvas.width = hiddenVideo.videoWidth || 1280;
  hiddenCanvas.height = hiddenVideo.videoHeight || 720;

  return url;
}

async function seekTo(timeSec) {
  // Clamp time
  const t = Math.max(0, Math.min(timeSec, hiddenVideo.duration || timeSec));
  hiddenVideo.currentTime = t;

  // "seeked" fires when the browser finishes seeking
  await waitForEvent(hiddenVideo, "seeked");
}

function canvasToBlob(type = "image/png", quality = 0.92) {
  return new Promise((resolve) => {
    hiddenCanvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function clearOldResults() {
  for (const item of extracted) {
    if (item.url) URL.revokeObjectURL(item.url);
  }
  extracted = [];
  outputDiv.innerHTML = "";
  downloadZipButton.disabled = true;
}

function renderCard({ time, url, filename }) {
  const card = document.createElement("div");
  card.className = "card";

  const img = document.createElement("img");
  img.src = url;
  img.alt = filename;

  const meta = document.createElement("div");
  meta.className = "meta";

  const left = document.createElement("span");
  left.textContent = `${time.toFixed(2)}s`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.textContent = "Download";

  meta.appendChild(left);
  meta.appendChild(link);

  card.appendChild(img);
  card.appendChild(meta);

  outputDiv.appendChild(card);
}

processButton.addEventListener("click", async () => {
  try {
    if (!videoInput.files || videoInput.files.length === 0) {
      alert("Please select a video file.");
      return;
    }

    clearOldResults();

    const file = videoInput.files[0];
    const step = parseFloat(clipDurationSelect.value);
    const maxFrames = Math.max(1, parseInt(maxFramesInput.value || "300", 10));

    setStatus("Loading video...");
    await loadVideoFromFile(file);

    if (!hiddenVideo.duration || !isFinite(hiddenVideo.duration)) {
      setStatus("Could not read video duration. Try a different video format.");
      return;
    }

    // Estimate frames count
    const estCount = Math.floor(hiddenVideo.duration / step) + 1;
    const total = Math.min(estCount, maxFrames);

    if (estCount > maxFrames) {
      setStatus(
        `Video is long for ${step}s steps. Limiting to ${maxFrames} frames (you can increase Max frames).`
      );
    } else {
      setStatus(`Extracting ${total} frames...`);
    }

    // Warm up decoding (reduces blank frames on some browsers)
    try {
      await hiddenVideo.play();
      hiddenVideo.pause();
    } catch (_) {
      // Ignore autoplay restrictions
    }

    const mimeType = "image/png"; // change to "image/jpeg" for smaller files if desired

    for (let i = 0; i < total; i++) {
      const t = i * step;

      await seekTo(t);
      ctx.drawImage(hiddenVideo, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

      const blob = await canvasToBlob(mimeType, 0.92);
      if (!blob) continue;

      const url = URL.createObjectURL(blob);
      const filename = `frame_${String(i).padStart(5, "0")}_${t.toFixed(2)}s.png`;

      const item = { time: t, blob, url, filename };
      extracted.push(item);
      renderCard(item);

      if ((i + 1) % 10 === 0 || i === total - 1) {
        setStatus(`Extracted ${i + 1}/${total} frames...`);
      }
    }

    setStatus(`Done. Extracted ${extracted.length} frames.`);
    downloadZipButton.disabled = extracted.length === 0;
  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err?.message || String(err)));
  }
});

downloadZipButton.addEventListener("click", async () => {
  if (!extracted.length) return;

  try {
    setStatus("Building ZIP...");
    downloadZipButton.disabled = true;

    const zip = new JSZip();

    // Put frames inside a folder (cleaner in Files app)
    const folder = zip.folder("frames");

    for (const item of extracted) {
      folder.file(item.filename, item.blob);
    }

    // iOS Safari tends to be more stable with lower compression level
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 3 },
    });

    // ✅ Best path: FileSaver (very iPhone/Safari-friendly)
    if (typeof saveAs === "function") {
      saveAs(zipBlob, "videobreaker_frames.zip");
      setStatus("ZIP saved. Check Files → Downloads.");
      return;
    }

    // Fallback: anchor download
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "videobreaker_frames.zip";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Give Safari time before revoking
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    setStatus("ZIP downloaded. Check Files → Downloads.");
  } catch (err) {
    console.error(err);
    setStatus("ZIP error: " + (err?.message || String(err)));
  } finally {
    downloadZipButton.disabled = extracted.length === 0;
  }
});