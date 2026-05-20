"use strict";

function getElm(selector) {
  return document.querySelector(selector);
}

const rgbThreshold = { rMin: 200, gMax: 100, bMax: 100 };
const minArea = 80;
const minRatio = 3;

const mats = {};

const canvas = getElm("#canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const inputFile = getElm("#inputFile");
const video = getElm("#video");
const taResult = getElm("#taResult");

let isRunning = false;

function initMats(width, height) {
  [canvas.width, canvas.height] = [width, height];

  mats.mask = new cv.Mat(height, width, cv.CV_8UC1);
  mats.hierarchy = new cv.Mat();
  mats.kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(8, 8));
}

inputFile.addEventListener("change", async () => {
  const file = inputFile.files[0];

  if (!file) return;

  clearResult();

  const type = file.type.split("/")[0];
  const src = URL.createObjectURL(file);

  if (type == "image") {
    const image = new Image();
    image.src = src;

    image.onload = () => {
      initMats(image.width, image.height);

      ctx.drawImage(image, 0, 0);

      const result = detectAngle();

      if (result) {
        taResult.value = result.angle;
        drawRect(result.vertices);

      } else console.log("Detection Failure.")
    }

  } else if (type == "video") {
    inputFile.disabled = true;

    video.src = src;

    await new Promise(resolve => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
    });

    initMats(video.videoWidth, video.videoHeight);

    const fd = await getFrameDuration();

    console.log(`Frame Duration: ${fd}`);
    console.log(`FPS: ${1 / fd}`);

    video.pause();

    let frame = 0;

    while (true) {
      const targetTime = frame * fd;

      if (targetTime >= video.duration) break;

      await new Promise(resolve => {
        function onSeeked() {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        }

        video.addEventListener("seeked", onSeeked);
        video.currentTime = targetTime;
      });

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const result = detectAngle();

      if (result) {
        const gameFrame = Math.round(video.currentTime * 60);
        taResult.value += `${frame}, ${video.currentTime}, ${gameFrame}, ${result.angle}\n`;

        drawRect(result.vertices);

      } else console.log(`Detection Failure at ${frame}.`);

      frame ++;
    }

    inputFile.disabled = false;
  }
});

async function getFrameDuration() {
  return new Promise(resolve => {
    const times = [];

    function callback(now, metadata) {
      times.push(metadata.mediaTime);

      if (times.length >= 30) {
        video.pause();

        let sum = 0;

        for (let i = 1; i < times.length; i ++) {
          sum += times[i] - times[i - 1];
        }

        const duration = sum / (times.length - 1);

        resolve(duration);
        return;
      }

      video.requestVideoFrameCallback(callback);
    }

    video.currentTime = 0;
    video.play();

    video.requestVideoFrameCallback(callback);
  });
}

function detectAngle() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const rgba = imageData.data;
  const mask = mats.mask.data;

  const { rMin, gMax, bMax } = rgbThreshold;

  for (let i = 0, p = 0; i < rgba.length; i += 4, p ++) {
    const [r, g, b] = rgba.slice(i, i + 3)

    mask[p] = (r >= rMin && g <= gMax && b <= bMax) ? 255 : 0;
  }

  cv.morphologyEx(
    mats.mask, mats.mask,
    cv.MORPH_CLOSE, mats.kernel
  );

  const contours = new cv.MatVector();
  cv.findContours(
    mats.mask, contours, mats.hierarchy,
    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE
  );

  let bestRect = null;
  let bestScore = 0;

  for (let i = 0; i < contours.size(); i ++) {
    const cnt = contours.get(i);

    const area = cv.contourArea(cnt);

    if (area < minArea) {
      cnt.delete();
      continue;
    }

    const hull = new cv.Mat();
    cv.convexHull(cnt, hull, false, true);

    const rect = cv.minAreaRect(hull);
    hull.delete();

    const w = rect.size.width;
    const h = rect.size.height;

    if (w == 0 || h == 0) {
      cnt.delete();
      continue;
    }

    const ratio = Math.max(w, h) / Math.min(w, h);

    if (ratio < minRatio) {
      cnt.delete();
      continue;
    }

    const score = area * ratio;

    if (score > bestScore) {
      bestScore = score;
      bestRect = rect;
    }

    cnt.delete();
  }

  contours.delete();

  if (!bestRect) return null;

  const vertices = cv.RotatedRect.points(bestRect);

  let longest = 0;

  let bestDX = 0;
  let bestDY = 0;

  for (let i = 0; i < 4; i ++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % 4];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    const len2 = dx ** 2 + dy **2;

    if (len2 > longest) {
      longest = len2;
      [bestDX, bestDY] = [dx, dy];
    }
  }

  const angle = Math.atan2(Math.abs(bestDY), Math.abs(bestDX));
  return { angle, vertices };
}

function drawRect(vertices) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "lime";

  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);

  for (let i = 1; i < 4; i ++) ctx.lineTo(vertices[i].x, vertices[i].y);

  ctx.closePath();
  ctx.stroke();
}

function clearResult() {
  taResult.value = "";
}

getElm("#buttonClear").addEventListener("click", clearResult);

getElm("#buttonCopy").addEventListener("click", () => {
  navigator.clipboard.writeText(taResult.value);
});

window.addEventListener("beforeunload", () => {
    Object.values(mats).forEach(mat => mat.delete());
  }
);
