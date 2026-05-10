// SPDX-FileCopyrightText: Copyright (C) ARDUINO SRL (http://www.arduino.cc)
//
// SPDX-License-Identifier: MPL-2.0

const recentDetectionsElement = document.getElementById("recentDetections");
const feedbackContentElement = document.getElementById("feedback-content");
const MAX_RECENT_SCANS = 5;
let scans = [];
const socket = io(`http://${window.location.host}`); // Initialize socket.io connection
let errorContainer = document.getElementById("error-container");
let lighting_status = false;
let trafficLightState = "RED_PEDESTRIAN";
let trafficLightTimer = null;
let trafficLightCountdownInterval = null;

/** Pedestrians may cross (green) */
const GREEN_PEDESTRIAN_MS = 15000;
/** Minimum red for cars / no pedestrian green after a green phase */
const MIN_RED_AFTER_GREEN_MS = 10000;
//================================================================================
//to do, make the lighting red at the start always
changePedastrianLightingColor("red");

// Start the application
document.addEventListener("DOMContentLoaded", () => {
  initSocketIO();
  initializeConfidenceSlider();
  updateFeedback(null);
  renderDetections();

  // Popover logic
  const confidencePopoverText =
    "Minimum confidence score for detected objects. Lower values show more results but may include false positives.";
  const feedbackPopoverText =
    "When the camera detects an object like cat, cell phone, clock, cup, dog or potted plant, a picture and a message will be shown here.";

  document.querySelectorAll(".info-btn.confidence").forEach((img) => {
    const popover = img.nextElementSibling;
    img.addEventListener("mouseenter", () => {
      popover.textContent = confidencePopoverText;
      popover.style.display = "block";
    });
    img.addEventListener("mouseleave", () => {
      popover.style.display = "none";
    });
  });

  document.querySelectorAll(".info-btn.feedback").forEach((img) => {
    const popover = img.nextElementSibling;
    img.addEventListener("mouseenter", () => {
      popover.textContent = feedbackPopoverText;
      popover.style.display = "block";
    });
    img.addEventListener("mouseleave", () => {
      popover.style.display = "none";
    });
  });
  //TODO:
  //DELETE
  //testing offile
  setTimeout(() => {
    const fakeDetection = {
      content: "person",
      count: 2,
      people: [{ confidence: 0.92 }, { confidence: 0.87 }],
      timestamp: new Date().toISOString(),
    };
    printDetection(fakeDetection);
    renderDetections();
    updateTrafficLight(fakeDetection);
  }, 15000);
});

function initSocketIO() {
  socket.on("connect", () => {
    if (errorContainer) {
      errorContainer.style.display = "none";
      errorContainer.textContent = "";
    }
  });

  socket.on("disconnect", () => {
    if (errorContainer) {
      errorContainer.textContent =
        "Connection to the board lost. Please check the connection.";
      errorContainer.style.display = "block";
    }
  });

  socket.on("detection", async (message) => {
    printDetection(message);
    renderDetections();
    if (message.content === "person") {
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
}

function updateTrafficLight(message) {
  if (message.content !== "person") {
    return;
  }

  //stopping cars, making pedestrians able to walk
  if (trafficLightState === "RED_PEDESTRIAN") {
    startGreenPedestrianPhase();
  } else if (trafficLightState === "COOLDOWN") {
    console.log("waiting...");
  }
}

function renderGreenPedestrianCountdown(secondsRemaining) {
  const statusText = document.getElementById("feedback-content");
  const s = Math.max(0, secondsRemaining);
  statusText.innerHTML = `
            <div style="text-align: center; color: green; font-weight: bold; font-size: 1.5rem;">
                🟢 GREEN LIGHT<br>
                <span style="font-size: 1rem; color: #555;">Pedestrians crossing...</span><br>
                <span style="font-size: 2.25rem; margin-top: 0.4rem; display: inline-block; font-variant-numeric: tabular-nums;">${s}</span>
                <span style="font-size: 1rem; color: #555; display: block;">seconds left</span>
            </div>
        `;
}

function renderCarMinimumRedCountdown(secondsRemaining) {
  const statusText = document.getElementById("feedback-content");
  const s = Math.max(0, secondsRemaining);
  statusText.innerHTML = `
            <div style="text-align: center; color: red; font-weight: bold; font-size: 1.5rem;">
                🔴 RED LIGHT<br>
                <span style="font-size: 1rem; color: #555;">Cars moving!</span><br>
                <span style="font-size: 2.25rem; margin-top: 0.4rem; display: inline-block; font-variant-numeric: tabular-nums;">${s}</span>
                <span style="font-size: 1rem; color: #555; display: block;">seconds — minimum car time</span>
            </div>
        `;
}

function startGreenPedestrianPhase() {
  clearTrafficLightTimers();
  trafficLightState = "GREEN_PEDESTRIAN";
  const totalSec = Math.ceil(GREEN_PEDESTRIAN_MS / 1000);
  let secondsLeft = totalSec;
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
    iniciarFaseCooldown();
  }, GREEN_PEDESTRIAN_MS);
}

function iniciarFaseCooldown() {
  clearTrafficLightTimers();
  trafficLightState = "COOLDOWN";
  const totalSec = Math.ceil(MIN_RED_AFTER_GREEN_MS / 1000);
  let secondsLeft = totalSec;
  renderCarMinimumRedCountdown(secondsLeft);
  trafficLightCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      if (trafficLightCountdownInterval !== null) {
        clearInterval(trafficLightCountdownInterval);
        trafficLightCountdownInterval = null;
      }
      return;
    }
    renderCarMinimumRedCountdown(secondsLeft);
  }, 1000);
  trafficLightTimer = setTimeout(() => {
    clearTrafficLightTimers();
    trafficLightState = "RED_PEDESTRIAN";
    changePedastrianLightingColor("red");
  }, MIN_RED_AFTER_GREEN_MS);
}

function changePedastrianLightingColor(color) {
  const statusText = document.getElementById("feedback-content");

  if (color === "red") {
    statusText.innerHTML = `
            <div style="text-align: center; color: red; font-weight: bold; font-size: 1.5rem;">
                🔴 RED LIGHT<br>
                <span style="font-size: 1rem; color: #555;">Cars moving!</span>
            </div>
        `;
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
    feedbackContentElement.innerHTML = `
            <div class="feedback-detection">
                <div class="percentage">${confidence}%</div>
                <img src="img/${info.gif}" alt="${detection.content}">
                <p>${info.text}</p>
            </div>
        `;
  } else {
    feedbackContentElement.innerHTML = `
            <img src="img/stars.svg" alt="Stars">
            <p class="feedback-text">System response will appear here</p>
        `;
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
  recentDetectionsElement.innerHTML = ``;

  if (scans.length === 0) {
    recentDetectionsElement.innerHTML = `
            <div class="no-recent-scans">
                <img src="./img/no-face.svg">
                No object detected yet
            </div>
        `;
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
    recentDetectionsElement.appendChild(row);
  });
}

function initializeConfidenceSlider() {
  const confidenceSlider = document.getElementById("confidenceSlider");
  const confidenceInput = document.getElementById("confidenceInput");
  const confidenceResetButton = document.getElementById(
    "confidenceResetButton",
  );

  confidenceSlider.addEventListener("input", updateConfidenceDisplay);
  confidenceInput.addEventListener("input", handleConfidenceInputChange);
  confidenceInput.addEventListener("blur", validateConfidenceInput);
  updateConfidenceDisplay();

  confidenceResetButton.addEventListener("click", (e) => {
    if (
      e.target.classList.contains("reset-icon") ||
      e.target.closest(".reset-icon")
    ) {
      resetConfidence();
    }
  });
}

function handleConfidenceInputChange() {
  const confidenceInput = document.getElementById("confidenceInput");
  const confidenceSlider = document.getElementById("confidenceSlider");

  let value = parseFloat(confidenceInput.value);

  if (isNaN(value)) value = 0.5;
  if (value < 0) value = 0;
  if (value > 1) value = 1;

  confidenceSlider.value = value;
  updateConfidenceDisplay();
}

function validateConfidenceInput() {
  const confidenceInput = document.getElementById("confidenceInput");
  let value = parseFloat(confidenceInput.value);

  if (isNaN(value)) value = 0.5;
  if (value < 0) value = 0;
  if (value > 1) value = 1;

  confidenceInput.value = value.toFixed(2);

  handleConfidenceInputChange();
}

function updateConfidenceDisplay() {
  const confidenceSlider = document.getElementById("confidenceSlider");
  const confidenceInput = document.getElementById("confidenceInput");
  const confidenceValueDisplay = document.getElementById(
    "confidenceValueDisplay",
  );
  const sliderProgress = document.getElementById("sliderProgress");

  const value = parseFloat(confidenceSlider.value);
  socket.emit("override_th", value); // Send confidence to backend
  const percentage =
    ((value - confidenceSlider.min) /
      (confidenceSlider.max - confidenceSlider.min)) *
    100;

  const displayValue = value.toFixed(2);
  confidenceValueDisplay.textContent = displayValue;

  if (document.activeElement !== confidenceInput) {
    confidenceInput.value = displayValue;
  }

  sliderProgress.style.width = percentage + "%";
  confidenceValueDisplay.style.left = percentage + "%";
}

function resetConfidence() {
  const confidenceSlider = document.getElementById("confidenceSlider");
  const confidenceInput = document.getElementById("confidenceInput");

  confidenceSlider.value = "0.5";
  confidenceInput.value = "0.50";
  updateConfidenceDisplay();
}
