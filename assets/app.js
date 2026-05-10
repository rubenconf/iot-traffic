// SPDX-FileCopyrightText: Copyright (C) ARDUINO SRL (http://www.arduino.cc)
//
// SPDX-License-Identifier: MPL-2.0

// const recentDetectionsElement = document.getElementById("recentDetections");
// const feedbackContentElement = document.getElementById("feedback-content");
const MAX_RECENT_SCANS = 5;
let scans = [];
const socket = io(`http://${window.location.host}`); // Initialize socket.io connection

const detectionStreamOrigin = `http://${window.location.hostname || "localhost"}:4912`;

/** Socket to Edge Impulse runner (:4912); used for live threshold-override. */
let detectionCamSocket = null;
/** { id, key } from runner hello.thresholds (e.g. min_score on object detection). */
let edgeImpulseThresholdTarget = null;

function pickEdgeImpulseThresholdTarget(thresholds) {
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    return null;
  }
  for (const t of thresholds) {
    if (t && typeof t.min_score === "number") {
      return { id: t.id, key: "min_score" };
    }
  }
  for (const t of thresholds) {
    if (!t || typeof t !== "object") {
      continue;
    }
    for (const k of Object.keys(t)) {
      if (k === "id" || k === "type") {
        continue;
      }
      if (typeof t[k] === "number") {
        return { id: t.id, key: k };
      }
    }
  }
  return null;
}

function emitEdgeImpulseThresholdOverride(numericValue) {
  if (!detectionCamSocket || !edgeImpulseThresholdTarget) {
    return;
  }
  if (!detectionCamSocket.connected) {
    return;
  }
  const v = Number(numericValue);
  if (Number.isNaN(v)) {
    return;
  }
  detectionCamSocket.emit("threshold-override", {
    id: edgeImpulseThresholdTarget.id,
    key: edgeImpulseThresholdTarget.key,
    value: v,
  });
}

// let errorContainer = document.getElementById("error-container");
let lighting_status = false;
let trafficLightTimer = null;
let trafficLightCountdownInterval = null;

/**
 * One full cycle when someone is detected (repeat from step 1 on each new walk):
 * 1. PEDESTRIAN_WALK — walk signal on, vehicles stopped
 * 2. VEHICLE_MIN_GREEN — vehicles go; fixed minimum time (new detections do not interrupt)
 * 3. VEHICLE_CLEAR — same lights; next person detection starts yellow-then-walk
 * 4. CAR_YELLOW_BEFORE_WALK — vehicle yellow before red + walk (fixed duration)
 */
const TrafficPhase = Object.freeze({
  PEDESTRIAN_WALK: "PEDESTRIAN_WALK",
  VEHICLE_MIN_GREEN: "VEHICLE_MIN_GREEN",
  VEHICLE_CLEAR: "VEHICLE_CLEAR",
  CAR_YELLOW_BEFORE_WALK: "CAR_YELLOW_BEFORE_WALK",
});

let trafficLightPhase = TrafficPhase.PEDESTRIAN_WALK;

/** Duration of the walk signal (pedestrian green, vehicles red) */
const PEDESTRIAN_MS = 15000;
/** Minimum time vehicles stay green after a walk (pedestrians stay red) */
const MIN_VEHICLE_GREEN_MS = 10000;
/** Vehicle yellow before car red when starting a walk from a green vehicle phase */
const CAR_YELLOW_BEFORE_RED_MS = 2000;
/** Time to wait before starting the pedestrian walk phase */
const PEDESTRIAN_WAIT_MS = 1000;

//================================================================================
//to do, make the lighting red at the start always
changeCarLightingColor("red");
// Sleep for 1 second no await because it's not asynchronous
setTimeout(() => {
  changePedastrianLightingColor("green");
}, PEDESTRIAN_WAIT_MS);
const countdownText = document.getElementById("countdown-text");

// Start the application
document.addEventListener("DOMContentLoaded", () => {
  initSocketIO();
  initCameraPreviewStream();
  initializeConfidenceSlider();
  updateFeedback(null);
  renderDetections();

  //TODO:
  //DELETE
  //testing offile
  // setTimeout(() => {
  //   const fakeDetection = {
  //     content: "person",
  //     count: 2,
  //     people: [{ confidence: 0.92 }, { confidence: 0.87 }],
  //     timestamp: new Date().toISOString(),
  //   };
  //   printDetection(fakeDetection);
  //   renderDetections();
  //   updateTrafficLight(fakeDetection);
  // }, 15000);
  startGreenPedestrianPhase();
});

function initCameraPreviewStream() {
  const img = document.getElementById("cameraStreamImg");
  const placeholder = document.getElementById("videoPlaceholder");
  const wrap = document.getElementById("cameraStreamWrap");
  if (!img || !placeholder || !wrap) return;

  const bboxColors = [
    "#e6194B",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#42d4f4",
    "#f032e6",
    "#fabed4",
    "#469990",
    "#dcbeff",
    "#9A6324",
    "#fffac8",
    "#800000",
    "#aaffc3",
  ];
  let bboxColorIx = 0;
  const labelToColor = {};

  function clearBoundingBoxes() {
    for (const bx of wrap.querySelectorAll(".bounding-box-container")) {
      bx.remove();
    }
  }

  let lastClassificationOpts = null;

  function isPersonDetection(detection) {
    const raw = detection && detection.label;
    if (raw == null) {
      return false;
    }
    return String(raw).toLowerCase() === "person";
  }

  function renderDetectionOverlays(opts) {
    const result = opts && opts.result;
    const modelType = opts && opts.modelType;
    if (!result) {
      return;
    }
    if (img.naturalHeight === 0 || img.clientHeight === 0) {
      return;
    }

    clearBoundingBoxes();

    const factor = img.naturalHeight / img.clientHeight;

    const boxes = result.object_tracking || result.bounding_boxes;
    if (boxes && boxes.length) {
      for (const b of boxes) {
        if (!isPersonDetection(b)) {
          continue;
        }
        const bb = {
          x: b.x / factor,
          y: b.y / factor,
          width: b.width / factor,
          height: b.height / factor,
          label:
            "object_id" in b ? `${b.label} (ID ${b.object_id})` : b.label,
          value: "value" in b ? b.value : undefined,
        };

        if (!labelToColor[bb.label]) {
          labelToColor[bb.label] =
            bboxColors[bboxColorIx++ % bboxColors.length];
        }
        const color = labelToColor[bb.label];

        const el = document.createElement("div");
        el.className = "bounding-box-container";
        el.style.position = "absolute";
        el.style.border = `solid 3px ${color}`;
        el.style.boxSizing = "border-box";
        el.style.pointerEvents = "none";

        if (modelType === "object_detection") {
          el.style.width = `${bb.width}px`;
          el.style.height = `${bb.height}px`;
          el.style.left = `${bb.x}px`;
          el.style.top = `${bb.y}px`;
        } else if (modelType === "constrained_object_detection") {
          const centerX = bb.x + bb.width / 2;
          const centerY = bb.y + bb.height / 2;
          el.style.borderRadius = "10px";
          el.style.width = "20px";
          el.style.height = "20px";
          el.style.left = `${centerX - 10}px`;
          el.style.top = `${centerY - 10}px`;
        } else {
          el.style.width = `${bb.width}px`;
          el.style.height = `${bb.height}px`;
          el.style.left = `${bb.x}px`;
          el.style.top = `${bb.y}px`;
        }

        const labelEl = document.createElement("div");
        labelEl.className = "bounding-box-label";
        labelEl.style.background = color;
        labelEl.style.color = "#fff";
        labelEl.style.fontSize = "11px";
        labelEl.style.lineHeight = "1.2";
        labelEl.style.padding = "2px 6px";
        labelEl.style.position = "absolute";
        labelEl.style.left = "0";
        labelEl.style.top = "0";
        labelEl.style.transform = "translateY(-100%)";
        if (modelType === "constrained_object_detection") {
          el.style.whiteSpace = "nowrap";
        }
        labelEl.textContent = bb.label;
        if (typeof bb.value === "number") {
          labelEl.textContent += ` (${bb.value.toFixed(2)})`;
        }

        el.appendChild(labelEl);
        wrap.appendChild(el);
      }
    }

    if (result.visual_anomaly_grid && result.visual_anomaly_grid.length) {
      for (const b of result.visual_anomaly_grid) {
        if (!isPersonDetection(b)) {
          continue;
        }
        const bb = {
          x: b.x / factor,
          y: b.y / factor,
          width: b.width / factor,
          height: b.height / factor,
          value: b.value,
        };

        const el = document.createElement("div");
        el.className = "bounding-box-container";
        el.style.position = "absolute";
        el.style.background = "rgba(255, 0, 0, 0.5)";
        el.style.width = `${bb.width}px`;
        el.style.height = `${bb.height}px`;
        el.style.left = `${bb.x}px`;
        el.style.top = `${bb.y}px`;
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.boxSizing = "border-box";
        el.style.pointerEvents = "none";

        let scoreFontSize = "";
        let scoreText = bb.value.toFixed(2);
        if (bb.width < 15) {
          scoreFontSize = "4px";
          scoreText = bb.value.toFixed(1);
        } else if (bb.width < 20) {
          scoreFontSize = "6px";
          scoreText = bb.value.toFixed(1);
        } else if (bb.width < 32) {
          scoreFontSize = "9px";
        }

        const score = document.createElement("div");
        score.style.color = "white";
        if (scoreFontSize) {
          score.style.fontSize = scoreFontSize;
        }
        score.textContent = scoreText;
        el.appendChild(score);
        wrap.appendChild(el);
      }
    }
  }

  const camSocket = io(detectionStreamOrigin, {
    transports: ["websocket", "polling"],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  detectionCamSocket = camSocket;

  const showStream = () => {
    placeholder.style.display = "none";
    img.style.display = "block";
  };

  const hideStream = () => {
    placeholder.style.display = "";
    img.style.display = "none";
    img.removeAttribute("src");
    lastClassificationOpts = null;
    edgeImpulseThresholdTarget = null;
    clearBoundingBoxes();
  };

  camSocket.on("connect", () => {
    camSocket.emit("hello");
  });

  camSocket.on("hello", (opts) => {
    edgeImpulseThresholdTarget = pickEdgeImpulseThresholdTarget(
      opts && opts.thresholds,
    );
    showStream();
    const slider = document.getElementById("confidenceSlider");
    if (slider) {
      emitEdgeImpulseThresholdOverride(parseFloat(slider.value));
    }
  });

  camSocket.on("image", (opts) => {
    if (opts && opts.img) {
      img.src = opts.img;
    }
  });

  camSocket.on("classification", (opts) => {
    lastClassificationOpts = opts;
    renderDetectionOverlays(opts);
  });

  camSocket.on("disconnect", hideStream);

  img.addEventListener("load", () => {
    if (lastClassificationOpts) {
      renderDetectionOverlays(lastClassificationOpts);
    }
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(() => {
      if (lastClassificationOpts) {
        renderDetectionOverlays(lastClassificationOpts);
      }
    });
  });
}

function initSocketIO() {
  socket.on("connect", () => {
    console.log("connected to socket");
    // if (errorContainer) {
    //   errorContainer.style.display = "none";
    //   errorContainer.textContent = "";
    // }
  });

  socket.on("disconnect", () => {
    // if (errorContainer) {
    //   errorContainer.textContent =
    //     "Connection to the board lost. Please check the connection.";
    //   errorContainer.style.display = "block";
    // }
    console.log("disconnected from socket");
  });

  socket.on("detection", async (message) => {
    printDetection(message);
    renderDetections();
    if (message.content === "person") {
      console.log("person detected");
      updateTrafficLight(message);
    } else {
      updateFeedback(message);
    }
  });
}

function clearTrafficLightTimers() {
  if (trafficLightTimer !== null) {
    clearTimeout(trafficLightTimer);
    trafficLightTimer = null;
  }
  if (trafficLightCountdownInterval !== null) {
    clearInterval(trafficLightCountdownInterval);
    trafficLightCountdownInterval = null;
  }
  if (countdownText) {
    countdownText.classList.remove("text-green-500");
    countdownText.classList.remove("text-red-500");
    countdownText.classList.remove("text-yellow-500");
    countdownText.textContent = "00:00";
  }
}

function updateTrafficLight(message) {
  // console.log("updateTrafficLight", message);
  if (message.content !== "person") {
    return;
  }

  //stopping cars, making pedestrians able to walk
  if (trafficLightPhase === TrafficPhase.VEHICLE_CLEAR) {
    console.log("Person detected — yellow then walk phase");
    startVehicleYellowBeforePedWalk();
  } else if (trafficLightPhase === TrafficPhase.VEHICLE_MIN_GREEN) {
    console.log(
      "Person detected during minimum vehicle green — walk starts after this phase",
    );
  } else if (trafficLightPhase === TrafficPhase.PEDESTRIAN_WALK) {
    console.log("Person detected during walk phase — already crossing");
  } else if (trafficLightPhase === TrafficPhase.CAR_YELLOW_BEFORE_WALK) {
    console.log("Person detected — already in yellow before walk");
  }
}

function formatCountdownClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  if (minutes > 0) {
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `00:${seconds.toString().padStart(2, "0")}`;
}

function renderGreenPedestrianCountdown(secondsRemaining) {
  if (!countdownText) return;
  countdownText.textContent = formatCountdownClock(secondsRemaining);
}

function renderVehicleMinGreenCountdown(secondsRemaining) {
  if (!countdownText) return;
  countdownText.textContent = formatCountdownClock(secondsRemaining);
}

function renderCarYellowCountdown(secondsRemaining) {
  if (!countdownText) return;
  countdownText.textContent = formatCountdownClock(secondsRemaining);
}

/** Vehicle yellow (ped red), then {@link startGreenPedestrianPhase}. */
function startVehicleYellowBeforePedWalk() {
  clearTrafficLightTimers();
  trafficLightPhase = TrafficPhase.CAR_YELLOW_BEFORE_WALK;
  changePedastrianLightingColor("red");
  changeCarLightingColor("yellow");
  countdownText?.classList.remove("text-green-500");
  countdownText?.classList.remove("text-red-500");
  countdownText?.classList.add("text-yellow-500");

  const totalSec = Math.ceil(CAR_YELLOW_BEFORE_RED_MS / 1000);
  let secondsLeft = totalSec;
  renderCarYellowCountdown(secondsLeft);
  trafficLightCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      if (trafficLightCountdownInterval !== null) {
        clearInterval(trafficLightCountdownInterval);
        trafficLightCountdownInterval = null;
      }
      return;
    }
    renderCarYellowCountdown(secondsLeft);
  }, 1000);
  trafficLightTimer = setTimeout(() => {
    clearTrafficLightTimers();
    startGreenPedestrianPhase();
  }, CAR_YELLOW_BEFORE_RED_MS);
}

function startGreenPedestrianPhase() {
  clearTrafficLightTimers();
  trafficLightPhase = TrafficPhase.PEDESTRIAN_WALK;
  const totalSec = Math.ceil(PEDESTRIAN_MS / 1000);
  let secondsLeft = totalSec;
  changeCarLightingColor("red");
  setTimeout(() => {
    changePedastrianLightingColor("green");
  }, PEDESTRIAN_WAIT_MS);
  countdownText.classList.add("text-green-500");
  countdownText.classList.remove("text-red-500");
  renderGreenPedestrianCountdown(secondsLeft);
  trafficLightCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      if (trafficLightCountdownInterval !== null) {
        clearInterval(trafficLightCountdownInterval);
        trafficLightCountdownInterval = null;
      }
      return;
    }
    renderGreenPedestrianCountdown(secondsLeft);
  }, 1000);
  trafficLightTimer = setTimeout(() => {
    clearTrafficLightTimers();
    startVehicleMinimumGreenPhase();
  }, PEDESTRIAN_MS);
}

function startVehicleMinimumGreenPhase() {
  changePedastrianLightingColor("red");
  setTimeout(() => {
    changeCarLightingColor("green");
  }, 1000);
  clearTrafficLightTimers();
  trafficLightPhase = TrafficPhase.VEHICLE_MIN_GREEN;
  const totalSec = Math.ceil(MIN_VEHICLE_GREEN_MS / 1000);
  let secondsLeft = totalSec;
  countdownText?.classList.add("text-red-500");
  countdownText?.classList.remove("text-green-500");
  renderVehicleMinGreenCountdown(secondsLeft);
  trafficLightCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      if (trafficLightCountdownInterval !== null) {
        clearInterval(trafficLightCountdownInterval);
        trafficLightCountdownInterval = null;
      }
      return;
    }
    renderVehicleMinGreenCountdown(secondsLeft);
  }, 1000);
  trafficLightTimer = setTimeout(() => {
    clearTrafficLightTimers();
    trafficLightPhase = TrafficPhase.VEHICLE_CLEAR;
    changePedastrianLightingColor("red");
  }, MIN_VEHICLE_GREEN_MS);
}

function changePedastrianLightingColor(color) {
  if (color === "green") {
    document.getElementById("red-person").classList.add("hidden");
    document.getElementById("green-person").classList.remove("hidden");
  } else if (color === "red") {
    document.getElementById("red-person").classList.remove("hidden");
    document.getElementById("green-person").classList.add("hidden");
  }
}

function changeCarLightingColor(color) {
  if (color === "green") {
    document.getElementById("red-car").classList.add("hidden");
    document.getElementById("yellow-car").classList.add("hidden");
    document.getElementById("green-car").classList.remove("hidden");
  } else if (color === "yellow") {
    document.getElementById("red-car").classList.add("hidden");
    document.getElementById("yellow-car").classList.remove("hidden");
    document.getElementById("green-car").classList.add("hidden");
  } else if (color === "red") {
    document.getElementById("red-car").classList.remove("hidden");
    document.getElementById("yellow-car").classList.add("hidden");
    document.getElementById("green-car").classList.add("hidden");
  }
}

function updateFeedback(detection) {
  const objectInfo = {
    cat: { text: "Meow!", gif: "cat.webp" },
    "cell phone": { text: "Stay connected", gif: "phone.webp" },
    clock: { text: "Time to go", gif: "clock.webp" },
    cup: { text: "Need a break?", gif: "cup.webp" },
    dog: { text: "Walkies?", gif: "dog.webp" },
    "potted plant": { text: "Glow your ideas!", gif: "plant.webp" },
  };

  if (detection && objectInfo[detection.content]) {
    const info = objectInfo[detection.content];
    const confidence = Math.floor(detection.confidence * 100);
    // feedbackContentElement.innerHTML = `
    //         <div class="feedback-detection">
    //             <div class="percentage">${confidence}%</div>
    //             <img src="img/${info.gif}" alt="${detection.content}">
    //             <p>${info.text}</p>
    //         </div>
    //     `;
  } else {
    // feedbackContentElement.innerHTML = `
    //         <img src="img/stars.svg" alt="Stars">
    //         <p class="feedback-text">System response will appear here</p>
    //     `;
  }
}

function printDetection(newDetection) {
  scans.unshift(newDetection);
  if (scans.length > MAX_RECENT_SCANS) {
    scans.pop();
  }
}

// Function to render the list of scans
function renderDetections() {
  // Clear the list
  // recentDetectionsElement.innerHTML = ``;

  if (scans.length === 0) {
    // recentDetectionsElement.innerHTML = `
    //         <div class="no-recent-scans">
    //             <img src="./img/no-face.svg">
    //             No object detected yet
    //         </div>
    //     `;
    return;
  }

  scans.forEach((scan) => {
    const row = document.createElement("div");
    row.className = "scan-container";

    // Create a container for content and time
    const cellContainer = document.createElement("span");
    cellContainer.className = "scan-cell-container cell-border";

    // Content (text + icon)
    const contentText = document.createElement("span");
    contentText.className = "scan-content";
    let contentLabel;
    if (
      scan.content === "person" &&
      typeof scan.count === "number" &&
      Array.isArray(scan.people)
    ) {
      const percents = scan.people
        .map((p) => p.confidence)
        .filter((c) => typeof c === "number")
        .map((c) => Math.floor(c * 1000) / 10);
      const pctText =
        percents.length > 0 ? percents.map((p) => `${p}%`).join(", ") : "—";
      contentLabel = `${scan.count} person(s) — ${pctText}`;
    } else {
      const value = scan.confidence;
      const result = Math.floor(value * 1000) / 10;
      contentLabel = `${result}% - ${scan.content}`;
    }
    contentText.innerHTML = contentLabel;

    // Time
    const timeText = document.createElement("span");
    timeText.className = "scan-content-time";
    timeText.textContent = new Date(scan.timestamp)
      .toLocaleString("it-IT")
      .replace(",", " -");

    // Append content and time to the container
    cellContainer.appendChild(contentText);
    cellContainer.appendChild(timeText);

    row.appendChild(cellContainer);
    // recentDetectionsElement.appendChild(row);
  });
}

function initializeConfidenceSlider() {
  const confidenceSlider = document.getElementById("confidenceSlider");
  // const confidenceInput = document.getElementById("confidenceInput");
  // const confidenceResetButton = document.getElementById("confidenceResetButton");
  if (!confidenceSlider) {
    return;
  }

  confidenceSlider.addEventListener("input", updateConfidenceDisplay);
  // confidenceInput.addEventListener("input", handleConfidenceInputChange);
  // confidenceInput.addEventListener("blur", validateConfidenceInput);
  updateConfidenceDisplay();
}

function handleConfidenceInputChange() {
  // const confidenceInput = document.getElementById("confidenceInput");
  const confidenceSlider = document.getElementById("confidenceSlider");

  let value = parseFloat(confidenceSlider.value);

  if (isNaN(value)) value = 0.5;
  if (value < 0) value = 0;
  if (value > 1) value = 1;

  confidenceSlider.value = value;
  updateConfidenceDisplay();
}

function validateConfidenceInput() {
  // const confidenceInput = document.getElementById("confidenceInput");
  // let value = parseFloat(confidenceInput.value);

  if (isNaN(value)) value = 0.5;
  if (value < 0) value = 0;
  if (value > 1) value = 1;

  // confidenceInput.value = value.toFixed(2);

  handleConfidenceInputChange();
}

function updateConfidenceDisplay() {
  const confidenceSlider = document.getElementById("confidenceSlider");
  // const confidenceInput = document.getElementById("confidenceInput");
  // const confidenceValueDisplay = document.getElementById(
  //   "confidenceValueDisplay",
  // );
  // const sliderProgress = document.getElementById("sliderProgress");
  if (!confidenceSlider) {
    return;
  }

  const value = parseFloat(confidenceSlider.value);
  socket.emit("override_th", value); // Send confidence to backend
  emitEdgeImpulseThresholdOverride(value); // Edge Impulse runner on :4912
  const percentage =
    ((value - confidenceSlider.min) /
      (confidenceSlider.max - confidenceSlider.min)) *
    100;

  const displayValue = value.toFixed(2);
  // confidenceValueDisplay.textContent = displayValue;

  // if (document.activeElement !== confidenceInput) {
  //   confidenceInput.value = displayValue;
  // }

  // sliderProgress.style.width = percentage + "%";
  // confidenceValueDisplay.style.left = percentage + "%";
}

function resetConfidence() {
  const confidenceSlider = document.getElementById("confidenceSlider");
  // const confidenceInput = document.getElementById("confidenceInput");

  confidenceSlider.value = "0.5";
  // confidenceInput.value = "0.50";
  updateConfidenceDisplay();
}
