import { SyncManager, SyncedReadingPair } from "./sync-manager.js";
import { MeterEvent, MeterReading } from "./meter.js";

declare const Chart: any;

const syncMgr = new SyncManager();

// Device name registry: maps BLE device.id to user-assigned names
const DEVICE_REGISTRY_KEY = "usb-mm-device-registry";

interface DeviceRegistry {
  [deviceId: string]: string;
}

function getDeviceRegistry(): DeviceRegistry {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_REGISTRY_KEY) || "{}");
  } catch {
    return {};
  }
}

function setDeviceName(deviceId: string, name: string) {
  const registry = getDeviceRegistry();
  registry[deviceId] = name;
  localStorage.setItem(DEVICE_REGISTRY_KEY, JSON.stringify(registry));
}

function getDeviceName(deviceId: string, fallbackBleName: string): string {
  const registry = getDeviceRegistry();
  return registry[deviceId] || fallbackBleName;
}

function promptDeviceName(deviceId: string, bleName: string): string {
  const existing = getDeviceRegistry()[deviceId];
  if (existing) return existing;
  const name = prompt(`Assign a name for this device:\n\nBLE Name: ${bleName}\nID: ${deviceId.slice(0, 8)}...`, bleName);
  if (name && name.trim()) {
    setDeviceName(deviceId, name.trim());
    return name.trim();
  }
  return bleName;
}

// DOM elements
const bleWarning = document.getElementById("bleWarning")!;
const supplyStatus = document.getElementById("supplyStatus")!;
const deviceStatus = document.getElementById("deviceStatus")!;
const supplyNameEl = document.getElementById("supplyName")!;
const deviceNameEl = document.getElementById("deviceName")!;
const btnConnectSupply = document.getElementById("btnConnectSupply") as HTMLButtonElement;
const btnConnectDevice = document.getElementById("btnConnectDevice") as HTMLButtonElement;
const btnSwap = document.getElementById("btnSwap") as HTMLButtonElement;
const supplyLabelInput = document.getElementById("supplyLabel") as HTMLInputElement;
const deviceLabelInput = document.getElementById("deviceLabel") as HTMLInputElement;
const btnRecord = document.getElementById("btnRecord") as HTMLButtonElement;
const btnReset = document.getElementById("btnReset") as HTMLButtonElement;
const btnPause = document.getElementById("btnPause") as HTMLButtonElement;
const btnExport = document.getElementById("btnExport") as HTMLButtonElement;
const sampleCounter = document.getElementById("sampleCounter")!;
const elapsedEl = document.getElementById("elapsed")!;
const logEntries = document.getElementById("logEntries")!;

// Reading elements
const supplyReadings = {
  voltage: document.getElementById("supplyVoltage")!,
  current: document.getElementById("supplyCurrent")!,
  power: document.getElementById("supplyPower")!,
  energy: document.getElementById("supplyEnergy")!,
  capacity: document.getElementById("supplyCapacity")!,
  temp: document.getElementById("supplyTemp")!,
  usb: document.getElementById("supplyUsb")!,
  duration: document.getElementById("supplyDuration")!,
};

const deviceReadings = {
  voltage: document.getElementById("deviceVoltage")!,
  current: document.getElementById("deviceCurrent")!,
  power: document.getElementById("devicePower")!,
  energy: document.getElementById("deviceEnergy")!,
  capacity: document.getElementById("deviceCapacity")!,
  temp: document.getElementById("deviceTemp")!,
  usb: document.getElementById("deviceUsb")!,
  duration: document.getElementById("deviceDuration")!,
};

const deltaReadings = {
  voltage: document.getElementById("deltaVoltage")!,
  current: document.getElementById("deltaCurrent")!,
  power: document.getElementById("deltaPower")!,
  efficiency: document.getElementById("efficiency")!,
  cableResistance: document.getElementById("cableResistance")!,
  supplySamples: document.getElementById("supplySamples")!,
  deviceSamples: document.getElementById("deviceSamples")!,
  syncStatus: document.getElementById("syncStatus")!,
};

// Stats elements
const statEls = {
  supplyVoltage: document.getElementById("statSupplyVoltage")!,
  supplyCurrent: document.getElementById("statSupplyCurrent")!,
  supplyPower: document.getElementById("statSupplyPower")!,
  supplyTemp: document.getElementById("statSupplyTemp")!,
  deviceVoltage: document.getElementById("statDeviceVoltage")!,
  deviceCurrent: document.getElementById("statDeviceCurrent")!,
  devicePower: document.getElementById("statDevicePower")!,
  deviceTemp: document.getElementById("statDeviceTemp")!,
};

// Chart
let mainChart: any = null;
let activeChart = "voltage";
const maxChartPoints = 200;
const chartData: {
  labels: number[];
  supplyVoltage: number[];
  deviceVoltage: number[];
  supplyCurrent: number[];
  deviceCurrent: number[];
  supplyPower: number[];
  devicePower: number[];
  supplyEnergy: number[];
  deviceEnergy: number[];
  supplyTemp: number[];
  deviceTemp: number[];
} = {
  labels: [],
  supplyVoltage: [],
  deviceVoltage: [],
  supplyCurrent: [],
  deviceCurrent: [],
  supplyPower: [],
  devicePower: [],
  supplyEnergy: [],
  deviceEnergy: [],
  supplyTemp: [],
  deviceTemp: [],
};

let paused = false;
let elapsedInterval: ReturnType<typeof setInterval> | null = null;
let pausedDuration = 0;
let pauseStartedAt: number | null = null;

function initChart() {
  const canvas = document.getElementById("mainChart") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  mainChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Supply",
          data: [],
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        },
        {
          label: "Device",
          data: [],
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: {
        intersect: false,
        mode: "index",
      },
      scales: {
        x: {
          display: true,
          grid: { color: "rgba(46, 51, 69, 0.5)" },
          ticks: {
            color: "#8b90a0",
            maxTicksLimit: 10,
            callback: function (value: any, index: number) {
              const labels = (mainChart as any).data.labels;
              if (!labels[index]) return "";
              const elapsed = labels[index] - labels[0];
              const secs = Math.floor(elapsed / 1000);
              const mins = Math.floor(secs / 60);
              return mins > 0 ? `${mins}m${secs % 60}s` : `${secs}s`;
            },
          },
        },
        y: {
          display: true,
          grid: { color: "rgba(46, 51, 69, 0.5)" },
          ticks: { color: "#8b90a0" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#e4e6ed" },
        },
      },
    },
  });
}

function getChartDataForMode(): { supply: number[]; device: number[]; yLabel: string } {
  switch (activeChart) {
    case "voltage":
      return { supply: chartData.supplyVoltage, device: chartData.deviceVoltage, yLabel: "Volts (V)" };
    case "current":
      return { supply: chartData.supplyCurrent, device: chartData.deviceCurrent, yLabel: "Amps (A)" };
    case "power":
      return { supply: chartData.supplyPower, device: chartData.devicePower, yLabel: "Watts (W)" };
    case "energy":
      return { supply: chartData.supplyEnergy, device: chartData.deviceEnergy, yLabel: "Watt-hours (Wh)" };
    case "temperature":
      return { supply: chartData.supplyTemp, device: chartData.deviceTemp, yLabel: "°C" };
    default:
      return { supply: chartData.supplyVoltage, device: chartData.deviceVoltage, yLabel: "V" };
  }
}

function updateChart() {
  if (!mainChart) return;
  const { supply, device, yLabel } = getChartDataForMode();

  mainChart.data.labels = chartData.labels;
  mainChart.data.datasets[0].data = supply;
  mainChart.data.datasets[1].data = device;
  mainChart.options.scales.y.title = { display: true, text: yLabel, color: "#8b90a0" };
  mainChart.update("none");
}

function updateReadingDisplay(els: typeof supplyReadings, reading: MeterReading) {
  els.voltage.textContent = `${reading.voltage.toFixed(2)} V`;
  els.current.textContent = `${reading.current.toFixed(3)} A`;
  els.power.textContent = `${reading.power.toFixed(2)} W`;
  els.energy.textContent = `${reading.energy.toFixed(2)} Wh`;
  els.capacity.textContent = `${reading.capacity} mAh`;
  els.temp.textContent = `${reading.temperature} °C`;
  els.duration.textContent = reading.duration;

  if (reading.dataMinus !== null && reading.dataPlus !== null) {
    els.usb.textContent = `${reading.dataMinus.toFixed(2)} / ${reading.dataPlus.toFixed(2)} V`;
  } else {
    els.usb.textContent = "N/A";
  }
}

function formatStat(min: number | undefined, avg: number | undefined, max: number | undefined, decimals = 2): string {
  const f = (v: number | undefined) => v !== undefined ? v.toFixed(decimals) : "--";
  return `${f(min)} / ${f(avg)} / ${f(max)}`;
}

function updateStats() {
  const ss = syncMgr.supplyStats;
  const ds = syncMgr.deviceStats;

  statEls.supplyVoltage.textContent = formatStat((ss.min as any).voltage, (ss.avg as any).voltage, (ss.max as any).voltage);
  statEls.supplyCurrent.textContent = formatStat((ss.min as any).current, (ss.avg as any).current, (ss.max as any).current, 3);
  statEls.supplyPower.textContent = formatStat((ss.min as any).power, (ss.avg as any).power, (ss.max as any).power);
  statEls.supplyTemp.textContent = formatStat((ss.min as any).temperature, (ss.avg as any).temperature, (ss.max as any).temperature, 0);

  statEls.deviceVoltage.textContent = formatStat((ds.min as any).voltage, (ds.avg as any).voltage, (ds.max as any).voltage);
  statEls.deviceCurrent.textContent = formatStat((ds.min as any).current, (ds.avg as any).current, (ds.max as any).current, 3);
  statEls.devicePower.textContent = formatStat((ds.min as any).power, (ds.avg as any).power, (ds.max as any).power);
  statEls.deviceTemp.textContent = formatStat((ds.min as any).temperature, (ds.avg as any).temperature, (ds.max as any).temperature, 0);
}

function onSyncPair(pair: SyncedReadingPair) {
  if (paused) return;

  // Delta
  if (pair.delta.voltage !== null) {
    deltaReadings.voltage.textContent = `${pair.delta.voltage.toFixed(3)} V`;
  }
  if (pair.delta.current !== null) {
    deltaReadings.current.textContent = `${pair.delta.current.toFixed(3)} A`;
  }
  if (pair.delta.power !== null) {
    deltaReadings.power.textContent = `${pair.delta.power.toFixed(3)} W`;
  }

  // Efficiency = device_power / supply_power * 100
  if (pair.supply && pair.device && pair.supply.power > 0) {
    const eff = (pair.device.power / pair.supply.power) * 100;
    deltaReadings.efficiency.textContent = `${eff.toFixed(1)} %`;
  }

  // Cable resistance estimation (V_drop / I)
  if (pair.delta.voltage !== null && pair.supply && pair.supply.current > 0.01) {
    const cableR = Math.abs(pair.delta.voltage) / pair.supply.current;
    deltaReadings.cableResistance.textContent = `${cableR.toFixed(3)} Ω`;
  }

  deltaReadings.supplySamples.textContent = String(syncMgr.supplyHistory.length);
  deltaReadings.deviceSamples.textContent = String(syncMgr.deviceHistory.length);

  const bothConnected = syncMgr.supplyConnected && syncMgr.deviceConnected;
  deltaReadings.syncStatus.textContent = bothConnected ? "Synced" : "Partial";

  // Chart data
  chartData.labels.push(pair.timestamp);
  chartData.supplyVoltage.push(pair.supply?.voltage ?? NaN);
  chartData.deviceVoltage.push(pair.device?.voltage ?? NaN);
  chartData.supplyCurrent.push(pair.supply?.current ?? NaN);
  chartData.deviceCurrent.push(pair.device?.current ?? NaN);
  chartData.supplyPower.push(pair.supply?.power ?? NaN);
  chartData.devicePower.push(pair.device?.power ?? NaN);
  chartData.supplyEnergy.push(pair.supply?.energy ?? NaN);
  chartData.deviceEnergy.push(pair.device?.energy ?? NaN);
  chartData.supplyTemp.push(pair.supply?.temperature ?? NaN);
  chartData.deviceTemp.push(pair.device?.temperature ?? NaN);

  if (chartData.labels.length > maxChartPoints) {
    chartData.labels.shift();
    chartData.supplyVoltage.shift();
    chartData.deviceVoltage.shift();
    chartData.supplyCurrent.shift();
    chartData.deviceCurrent.shift();
    chartData.supplyPower.shift();
    chartData.devicePower.shift();
    chartData.supplyEnergy.shift();
    chartData.deviceEnergy.shift();
    chartData.supplyTemp.shift();
    chartData.deviceTemp.shift();
  }

  updateChart();
  updateStats();

  sampleCounter.textContent = `Samples: ${syncMgr.supplyHistory.length} / ${syncMgr.deviceHistory.length}`;
}

function onDeviceEvent(event: MeterEvent) {
  const time = new Date().toLocaleTimeString();
  let msg = "";
  let cls = "";

  switch (event.type) {
    case "connected":
      msg = `[${time}] ${event.meterId.toUpperCase()} connected: ${event.deviceName}`;
      cls = "success";
      break;
    case "disconnected":
      msg = `[${time}] ${event.meterId.toUpperCase()} disconnected: ${event.deviceName}`;
      cls = "error";
      break;
    case "error":
      msg = `[${time}] ${event.meterId.toUpperCase()} error: ${event.error}`;
      cls = "error";
      break;
    case "reading":
      if (!paused && event.data) {
        if (event.meterId === "supply") {
          updateReadingDisplay(supplyReadings, event.data);
        } else {
          updateReadingDisplay(deviceReadings, event.data);
        }
      }
      return;
    default:
      return;
  }

  addLog(msg, cls);
  updateConnectionUI();
}

function addLog(msg: string, cls = "") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${cls}`;
  entry.textContent = msg;
  logEntries.prepend(entry);

  while (logEntries.children.length > 50) {
    logEntries.removeChild(logEntries.lastChild!);
  }
}

function updateConnectionUI() {
  const supplyReadingId = document.getElementById("supplyReadingId")!;
  const deviceReadingId = document.getElementById("deviceReadingId")!;

  if (syncMgr.supplyConnected) {
    supplyStatus.classList.add("connected");
    const id = syncMgr.supplyDeviceId;
    const customName = getDeviceName(id, syncMgr.supplyName);
    supplyNameEl.textContent = `${customName} [${id.slice(0, 8)}]`;
    supplyNameEl.classList.add("editable");
    supplyNameEl.title = "Click to rename";
    supplyReadingId.textContent = `— ${customName}`;
    btnConnectSupply.textContent = "Disconnect";
    btnConnectSupply.classList.add("btn-danger");
    btnConnectSupply.classList.remove("btn-supply");
  } else {
    supplyStatus.classList.remove("connected");
    supplyNameEl.textContent = "Not connected";
    supplyNameEl.classList.remove("editable");
    supplyNameEl.title = "";
    supplyReadingId.textContent = "";
    btnConnectSupply.textContent = "Connect";
    btnConnectSupply.classList.remove("btn-danger");
    btnConnectSupply.classList.add("btn-supply");
  }

  if (syncMgr.deviceConnected) {
    deviceStatus.classList.add("connected");
    const id = syncMgr.deviceDeviceId;
    const customName = getDeviceName(id, syncMgr.deviceName);
    deviceNameEl.textContent = `${customName} [${id.slice(0, 8)}]`;
    deviceNameEl.classList.add("editable");
    deviceNameEl.title = "Click to rename";
    deviceReadingId.textContent = `— ${customName}`;
    btnConnectDevice.textContent = "Disconnect";
    btnConnectDevice.classList.add("btn-danger");
    btnConnectDevice.classList.remove("btn-device");
  } else {
    deviceStatus.classList.remove("connected");
    deviceNameEl.textContent = "Not connected";
    deviceNameEl.classList.remove("editable");
    deviceNameEl.title = "";
    deviceReadingId.textContent = "";
    btnConnectDevice.textContent = "Connect";
    btnConnectDevice.classList.remove("btn-danger");
    btnConnectDevice.classList.add("btn-device");
  }
}

function startElapsedTimer() {
  if (elapsedInterval) clearInterval(elapsedInterval);
  pausedDuration = 0;
  pauseStartedAt = null;
  elapsedInterval = setInterval(() => {
    if (!syncMgr.startTime || paused) return;
    const elapsed = Date.now() - syncMgr.startTime - pausedDuration;
    const secs = Math.floor(elapsed / 1000) % 60;
    const mins = Math.floor(elapsed / 60000) % 60;
    const hrs = Math.floor(elapsed / 3600000);
    elapsedEl.textContent = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

function resetChartData() {
  chartData.labels = [];
  chartData.supplyVoltage = [];
  chartData.deviceVoltage = [];
  chartData.supplyCurrent = [];
  chartData.deviceCurrent = [];
  chartData.supplyPower = [];
  chartData.devicePower = [];
  chartData.supplyEnergy = [];
  chartData.deviceEnergy = [];
  chartData.supplyTemp = [];
  chartData.deviceTemp = [];
  updateChart();
}

// Rename device on click
supplyNameEl.addEventListener("click", () => {
  if (!syncMgr.supplyConnected) return;
  const id = syncMgr.supplyDeviceId;
  const current = getDeviceName(id, syncMgr.supplyName);
  const name = prompt(`Rename this device:\n\nBLE Name: ${syncMgr.supplyName}\nID: ${id.slice(0, 8)}...`, current);
  if (name && name.trim()) {
    setDeviceName(id, name.trim());
    updateConnectionUI();
  }
});

deviceNameEl.addEventListener("click", () => {
  if (!syncMgr.deviceConnected) return;
  const id = syncMgr.deviceDeviceId;
  const current = getDeviceName(id, syncMgr.deviceName);
  const name = prompt(`Rename this device:\n\nBLE Name: ${syncMgr.deviceName}\nID: ${id.slice(0, 8)}...`, current);
  if (name && name.trim()) {
    setDeviceName(id, name.trim());
    updateConnectionUI();
  }
});

// Event handlers
btnConnectSupply.addEventListener("click", async () => {
  if (syncMgr.supplyConnected) {
    await syncMgr.disconnectSupply();
    updateConnectionUI();
  } else {
    try {
      await syncMgr.connectSupply();
      const id = syncMgr.supplyDeviceId;
      if (id) promptDeviceName(id, syncMgr.supplyName);
    } catch (e: any) {
      if (e.message !== "User cancelled the requestDevice() chooser.") {
        addLog(`Connection failed: ${e.message}`, "error");
      }
    }
    updateConnectionUI();
  }
});

btnConnectDevice.addEventListener("click", async () => {
  if (syncMgr.deviceConnected) {
    await syncMgr.disconnectDevice();
    updateConnectionUI();
  } else {
    try {
      await syncMgr.connectDevice();
      const id = syncMgr.deviceDeviceId;
      if (id) promptDeviceName(id, syncMgr.deviceName);
    } catch (e: any) {
      if (e.message !== "User cancelled the requestDevice() chooser.") {
        addLog(`Connection failed: ${e.message}`, "error");
      }
    }
    updateConnectionUI();
  }
});

btnRecord.addEventListener("click", () => {
  if (syncMgr.recording) {
    syncMgr.stopRecording();
    btnRecord.textContent = "Start Recording";
    btnRecord.classList.remove("btn-danger");
    btnRecord.classList.add("btn-primary");
    if (elapsedInterval) clearInterval(elapsedInterval);
    addLog(`[${new Date().toLocaleTimeString()}] Recording stopped`);
  } else {
    syncMgr.startRecording();
    resetChartData();
    btnRecord.textContent = "Stop Recording";
    btnRecord.classList.add("btn-danger");
    btnRecord.classList.remove("btn-primary");
    startElapsedTimer();
    addLog(`[${new Date().toLocaleTimeString()}] Recording started`, "success");
  }
});

btnSwap.addEventListener("click", () => {
  syncMgr.swapMeters();
  updateConnectionUI();
  addLog(`[${new Date().toLocaleTimeString()}] Swapped supply and device meters`);
});

supplyLabelInput.addEventListener("change", saveLabels);
deviceLabelInput.addEventListener("change", saveLabels);

function saveLabels() {
  localStorage.setItem("usb-mm-supply-label", supplyLabelInput.value);
  localStorage.setItem("usb-mm-device-label", deviceLabelInput.value);
}

function loadLabels() {
  const supplyLabel = localStorage.getItem("usb-mm-supply-label");
  const deviceLabel = localStorage.getItem("usb-mm-device-label");
  if (supplyLabel) supplyLabelInput.value = supplyLabel;
  if (deviceLabel) deviceLabelInput.value = deviceLabel;
}

btnReset.addEventListener("click", async () => {
  await syncMgr.resetMeters();
  syncMgr.reset();
  resetChartData();
  sampleCounter.textContent = "Samples: 0 / 0";
  elapsedEl.textContent = "00:00:00";
  if (elapsedInterval) clearInterval(elapsedInterval);
  if (syncMgr.recording) {
    syncMgr.startRecording();
    startElapsedTimer();
  }
  addLog(`[${new Date().toLocaleTimeString()}] Data reset`);
});

btnPause.addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    pauseStartedAt = Date.now();
  } else if (pauseStartedAt) {
    pausedDuration += Date.now() - pauseStartedAt;
    pauseStartedAt = null;
  }
  btnPause.textContent = paused ? "Resume" : "Pause";
});

btnExport.addEventListener("click", () => {
  const csv = syncMgr.exportCSV();
  if (!csv || syncMgr.history.length === 0) {
    addLog("No data to export", "error");
    return;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `usb-multi-meter-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  addLog(`[${new Date().toLocaleTimeString()}] Exported ${syncMgr.history.length} samples`, "success");
});

// Chart tab switching
document.querySelectorAll(".chart-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".chart-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeChart = (tab as HTMLElement).dataset.chart || "voltage";
    updateChart();
  });
});

// Init
document.addEventListener("DOMContentLoaded", () => {
  if (!("bluetooth" in navigator)) {
    bleWarning.classList.add("visible");
  }

  // Clear stale swapped labels from previous version
  const storedSupply = localStorage.getItem("usb-mm-supply-label");
  const storedDevice = localStorage.getItem("usb-mm-device-label");
  if (storedSupply === "Device Under Test" || storedDevice === "Power Supply Side") {
    localStorage.removeItem("usb-mm-supply-label");
    localStorage.removeItem("usb-mm-device-label");
  }

  loadLabels();
  syncMgr.onSync(onSyncPair);
  syncMgr.onDeviceEvent(onDeviceEvent);
  initChart();

  addLog(`[${new Date().toLocaleTimeString()}] USB Multi Meter ready. Connect your meters to begin.`);
});
