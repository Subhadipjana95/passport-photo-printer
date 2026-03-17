let API_KEY = "";
const API_ENDPOINT = "https://api.remove.bg/v1.0/removebg";

const DPI = 300;
const MM_PER_INCH = 25.4;
const MAX_QTY = 20;
const MIN_QTY = 1;

const SIZE_PRESETS = {
  "35x45": { label: "35 x 45 mm", widthMm: 35, heightMm: 45 },
  "51x51": { label: "51 x 51 mm", widthMm: 51, heightMm: 51 },
};

const SHEET_PRESETS = {
  "4x6": { label: "4 x 6 in", widthIn: 6, heightIn: 4, preferredCols: 3 },
  "5x7": { label: "5 x 7 in", widthIn: 7, heightIn: 5, preferredCols: null },
  a4: { label: "A4", widthMm: 210, heightMm: 297, preferredCols: null },
};

const elements = {
  upload: document.getElementById("upload"),
  qty: document.getElementById("qty"),
  sizePreset: document.getElementById("sizePreset"),
  sheetPreset: document.getElementById("sheetPreset"),
  showGuides: document.getElementById("showGuides"),
  process: document.getElementById("process"),
  download: document.getElementById("download"),
  copy: document.getElementById("copy"),
  print: document.getElementById("print"),
  loading: document.getElementById("loading"),
  status: document.getElementById("status"),
  canvas: document.getElementById("sheet"),
  originalPreview: document.getElementById("originalPreview"),
  processedPreview: document.getElementById("processedPreview"),
  originalPlaceholder: document.getElementById("originalPlaceholder"),
  processedPlaceholder: document.getElementById("processedPlaceholder"),
  sheetTitle: document.getElementById("sheetTitle"),
};

const ctx = elements.canvas.getContext("2d");

const appState = {
  originalObjectUrl: "",
  processedObjectUrl: "",
  processedImage: null,
  generated: false,
  sheetPx: { width: 1800, height: 1200 },
};

async function getRemoveBgApiKey() {
  if (API_KEY) {
    return API_KEY;
  }

  const envText = await fetch(".env", { cache: "no-store" }).then((response) => response.text());
  const match = envText.match(/^\s*REMOVE_BG_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
  API_KEY = match ? match[1].trim() : "";
  return API_KEY;
}

function mmToPx(mm) {
  return Math.round((mm / MM_PER_INCH) * DPI);
}

function inToPx(inches) {
  return Math.round(inches * DPI);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function setLoading(isLoading) {
  elements.loading.classList.toggle("hidden", !isLoading);
  elements.process.disabled = isLoading;
}

function setActionsEnabled(enabled) {
  elements.download.disabled = !enabled;
  elements.copy.disabled = !enabled;
  elements.print.disabled = !enabled;
}

function getSelectedSheetPreset() {
  const presetKey = elements.sheetPreset ? elements.sheetPreset.value : "4x6";
  return SHEET_PRESETS[presetKey] || SHEET_PRESETS["4x6"];
}

function getSheetPixelSize(sheetPreset) {
  if (typeof sheetPreset.widthIn === "number" && typeof sheetPreset.heightIn === "number") {
    return { width: inToPx(sheetPreset.widthIn), height: inToPx(sheetPreset.heightIn) };
  }
  return { width: mmToPx(sheetPreset.widthMm), height: mmToPx(sheetPreset.heightMm) };
}

function updateCanvasSize() {
  const sheetPreset = getSelectedSheetPreset();
  const sheetPx = getSheetPixelSize(sheetPreset);
  appState.sheetPx = sheetPx;
  elements.canvas.width = sheetPx.width;
  elements.canvas.height = sheetPx.height;
  if (elements.sheetTitle) {
    elements.sheetTitle.textContent = `Printable ${sheetPreset.label} Sheet Preview`;
  }
}

function resetSheet() {
  ctx.clearRect(0, 0, appState.sheetPx.width, appState.sheetPx.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, appState.sheetPx.width, appState.sheetPx.height);
  appState.generated = false;
  setActionsEnabled(false);
}

function drawSheetBackground() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, appState.sheetPx.width, appState.sheetPx.height);
  ctx.strokeStyle = "#d7deea";
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, appState.sheetPx.width - 4, appState.sheetPx.height - 4);
}

function parseQuantity() {
  const rawValue = Number.parseInt(elements.qty.value, 10);
  const safeValue = Number.isFinite(rawValue) ? rawValue : 3;
  const qty = clamp(safeValue, MIN_QTY, MAX_QTY);
  elements.qty.value = String(qty);
  return qty;
}

function getSelectedPhotoSizePx() {
  const preset = SIZE_PRESETS[elements.sizePreset.value] || SIZE_PRESETS["35x45"];
  return {
    ...preset,
    widthPx: mmToPx(preset.widthMm),
    heightPx: mmToPx(preset.heightMm),
  };
}

function revokeIfExists(url) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function loadImageFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to load generated image."));
    img.src = url;
  });
}

async function removeBackground(file) {
  const apiKey = await getRemoveBgApiKey();

  const formData = new FormData();
  formData.append("image_file", file);
  formData.append("size", "auto");
  formData.append("format", "png");

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`remove.bg error (${response.status}): ${errorText || "Unknown error"}`);
  }

  return response.blob();
}

async function detectFaceCenter(imageElement) {
  if (!("FaceDetector" in window)) {
    return null;
  }

  try {
    const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    const faces = await detector.detect(imageElement);
    if (!faces.length || !faces[0].boundingBox) {
      return null;
    }
    const box = faces[0].boundingBox;
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  } catch {
    return null;
  }
}

function calculateCropRect(sourceWidth, sourceHeight, targetAspect, focusPoint) {
  const sourceAspect = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceAspect > targetAspect) {
    cropWidth = sourceHeight * targetAspect;
  } else {
    cropHeight = sourceWidth / targetAspect;
  }

  const defaultFocus = {
    x: sourceWidth / 2,
    y: sourceHeight * 0.45,
  };
  const focus = focusPoint || defaultFocus;

  const x = clamp(focus.x - cropWidth / 2, 0, sourceWidth - cropWidth);
  const y = clamp(focus.y - cropHeight / 2, 0, sourceHeight - cropHeight);

  return { x, y, width: cropWidth, height: cropHeight };
}

function chooseWrapLayout(
  qty,
  photoWidth,
  photoHeight,
  availableWidth,
  availableHeight,
  gap,
  preferredCols,
) {
  let cols = Math.max(1, Math.floor((availableWidth + gap) / (photoWidth + gap)));
  if (preferredCols && cols >= preferredCols) {
    cols = Math.min(preferredCols, qty);
  }

  const rows = Math.ceil(qty / cols);
  const requiredHeight = rows * photoHeight + (rows - 1) * gap;

  if (requiredHeight > availableHeight) {
    throw new Error("Selected size and quantity overflow selected sheet height. Reduce quantity or size.");
  }

  return { cols, rows };
}

async function renderSheet() {
  if (!appState.processedImage) {
    return;
  }

  const qty = parseQuantity();
  const selectedSize = getSelectedPhotoSizePx();
  const selectedSheet = getSelectedSheetPreset();
  const targetAspect = selectedSize.widthPx / selectedSize.heightPx;

  const sheetWidth = appState.sheetPx.width;
  const sheetHeight = appState.sheetPx.height;
  const edgePadding = Math.max(10, Math.round(sheetWidth * 0.02));
  const availableWidth = sheetWidth - edgePadding * 2;
  const availableHeight = sheetHeight - edgePadding * 2;

  let gap = Math.max(8, Math.round(sheetWidth / 60));
  if (selectedSheet.preferredCols === 3) {
    const maxGapForThreeCols = Math.floor((availableWidth - selectedSize.widthPx * 3) / 2);
    gap = clamp(Math.min(gap, maxGapForThreeCols), 8, 80);
  }

  const layout = chooseWrapLayout(
    qty,
    selectedSize.widthPx,
    selectedSize.heightPx,
    availableWidth,
    availableHeight,
    gap,
    selectedSheet.preferredCols,
  );

  drawSheetBackground();

  const faceCenter = await detectFaceCenter(appState.processedImage);
  const crop = calculateCropRect(
    appState.processedImage.naturalWidth,
    appState.processedImage.naturalHeight,
    targetAspect,
    faceCenter,
  );

  const showGuides = elements.showGuides.checked;
  for (let i = 0; i < qty; i += 1) {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const x = Math.round(edgePadding + col * (selectedSize.widthPx + gap));
    const y = Math.round(edgePadding + row * (selectedSize.heightPx + gap));

    ctx.drawImage(
      appState.processedImage,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      x,
      y,
      selectedSize.widthPx,
      selectedSize.heightPx,
    );

    if (showGuides) {
      ctx.strokeStyle = "#adb8c8";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, selectedSize.widthPx, selectedSize.heightPx);
    }
  }

  appState.generated = true;
  setActionsEnabled(true);
  setStatus(`Generated ${qty} photo${qty > 1 ? "s" : ""} at ${selectedSize.label} on ${selectedSheet.label}.`);
}

function updateOriginalPreview(file) {
  revokeIfExists(appState.originalObjectUrl);
  appState.originalObjectUrl = URL.createObjectURL(file);
  elements.originalPreview.src = appState.originalObjectUrl;
  elements.originalPreview.classList.add("show");
  elements.originalPlaceholder.style.display = "none";
}

function updateProcessedPreview(url) {
  elements.processedPreview.src = url;
  elements.processedPreview.classList.add("show");
  elements.processedPlaceholder.style.display = "none";
}

async function processAndGenerate() {
  const file = elements.upload.files[0];
  if (!file) {
    setStatus("Please upload a JPG or PNG image first.", true);
    return;
  }

  setStatus("");
  setLoading(true);
  try {
    const resultBlob = await removeBackground(file);
    revokeIfExists(appState.processedObjectUrl);
    appState.processedObjectUrl = URL.createObjectURL(resultBlob);
    appState.processedImage = await loadImageFromObjectUrl(appState.processedObjectUrl);
    updateProcessedPreview(appState.processedObjectUrl);
    await renderSheet();
  } catch (error) {
    resetSheet();
    setStatus(error.message || "Failed to process image.", true);
  } finally {
    setLoading(false);
  }
}

async function regenerateIfReady() {
  if (!appState.processedImage) {
    return;
  }
  try {
    await renderSheet();
  } catch (error) {
    resetSheet();
    setStatus(error.message || "Unable to regenerate sheet.", true);
  }
}

async function copySheetToClipboard() {
  if (!appState.generated) {
    return;
  }

  const blob = await new Promise((resolve) => elements.canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    setStatus("Unable to copy sheet right now. Try again.", true);
    return;
  }

  try {
    if (
      window.isSecureContext &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === "function" &&
      typeof ClipboardItem !== "undefined"
    ) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("Sheet copied to clipboard.");
      return;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      const dataUrl = elements.canvas.toDataURL("image/png");
      await navigator.clipboard.writeText(dataUrl);
      setStatus("Image data URL copied (clipboard image copy is limited in this browser).");
      return;
    }

    setStatus("Clipboard is not available in this browser context.", true);
  } catch (error) {
    setStatus(`Copy failed: ${error.message || "Clipboard permission denied."}`, true);
  }
}

function downloadSheet() {
  if (!appState.generated) {
    return;
  }
  const link = document.createElement("a");
  const qty = parseQuantity();
  link.download = `passport-sheet-${qty}.png`;
  link.href = elements.canvas.toDataURL("image/png");
  link.click();
}

function printSheet() {
  if (!appState.generated) {
    return;
  }

  const selectedSheet = getSelectedSheetPreset();
  const pageSize = selectedSheet.widthIn
    ? `${selectedSheet.widthIn}in ${selectedSheet.heightIn}in`
    : `${selectedSheet.widthMm}mm ${selectedSheet.heightMm}mm`;
  const imageWidth = selectedSheet.widthIn
    ? `${selectedSheet.widthIn}in`
    : `${selectedSheet.widthMm}mm`;
  const imageHeight = selectedSheet.heightIn
    ? `${selectedSheet.heightIn}in`
    : `${selectedSheet.heightMm}mm`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    setStatus("Popup blocked. Please allow popups and try again.", true);
    return;
  }

  printWindow.document.write("<!doctype html><title>Preparing print...</title><p>Preparing print...</p>");
  printWindow.document.close();

  elements.canvas.toBlob((blob) => {
    if (!blob) {
      printWindow.close();
      setStatus("Unable to prepare print image.", true);
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const cleanup = () => {
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        if (!printWindow.closed) {
          printWindow.close();
        }
      }, 300);
    };

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <title>Print Passport Sheet</title>
  <style>
    @page { size: ${pageSize}; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .page { width: ${imageWidth}; height: ${imageHeight}; }
    img { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <div class="page">
    <img id="printImage" src="${blobUrl}" alt="Passport sheet" />
  </div>
</body>
</html>`);
    printWindow.document.close();

    const img = printWindow.document.getElementById("printImage");
    if (!img) {
      cleanup();
      setStatus("Unable to prepare printable image.", true);
      return;
    }

    const runPrint = () => {
      printWindow.focus();
      printWindow.print();
    };

    img.addEventListener("load", () => {
      setTimeout(runPrint, 120);
    });

    printWindow.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(() => {
      cleanup();
    }, 60000);

    setStatus("Print dialog opened.");
  }, "image/png");
}

function validateAndRenderQuantity() {
  const qty = parseQuantity();
  if (qty < MIN_QTY || qty > MAX_QTY) {
    setStatus(`Quantity must be between ${MIN_QTY} and ${MAX_QTY}.`, true);
    return;
  }
  regenerateIfReady();
}

function handleFileChange() {
  const file = elements.upload.files[0];
  if (!file) {
    return;
  }

  const isValidType = ["image/jpeg", "image/png", "image/jpg"].includes(file.type);
  if (!isValidType) {
    setStatus("Unsupported file format. Please upload JPG or PNG.", true);
    elements.upload.value = "";
    return;
  }

  setStatus("Photo selected. Click 'Remove Background & Generate'.");
  updateOriginalPreview(file);
}

function handleSheetPresetChange() {
  updateCanvasSize();
  if (appState.processedImage) {
    regenerateIfReady();
  } else {
    resetSheet();
    const selectedSheet = getSelectedSheetPreset();
    setStatus(`Sheet set to ${selectedSheet.label}. Upload and generate to continue.`);
  }
}

elements.upload.addEventListener("change", handleFileChange);
elements.process.addEventListener("click", processAndGenerate);
elements.qty.addEventListener("input", validateAndRenderQuantity);
elements.sizePreset.addEventListener("change", regenerateIfReady);
if (elements.sheetPreset) {
  elements.sheetPreset.addEventListener("change", handleSheetPresetChange);
}
elements.showGuides.addEventListener("change", regenerateIfReady);
elements.download.addEventListener("click", downloadSheet);
elements.copy.addEventListener("click", copySheetToClipboard);
elements.print.addEventListener("click", printSheet);

updateCanvasSize();
resetSheet();
setStatus("Upload a photo and generate your 4 x 6 in passport sheet.");
