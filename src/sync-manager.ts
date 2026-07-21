import { Meter, MeterEvent, MeterReading } from "./meter.js";

export interface SyncedReadingPair {
  timestamp: number;
  supply: MeterReading | null;
  device: MeterReading | null;
  delta: {
    voltage: number | null;
    current: number | null;
    power: number | null;
  };
}

export interface DeviceStats {
  min: Partial<MeterReading>;
  max: Partial<MeterReading>;
  avg: Partial<MeterReading>;
  sampleCount: number;
}

type SyncCallback = (pair: SyncedReadingPair) => void;
type DeviceEventCallback = (event: MeterEvent) => void;

export class SyncManager {
  private supplyMeter: Meter;
  private deviceMeter: Meter;
  private lastSupplyReading: MeterReading | null = null;
  private lastDeviceReading: MeterReading | null = null;
  private syncCallback: SyncCallback | null = null;
  private deviceEventCallback: DeviceEventCallback | null = null;
  private _history: SyncedReadingPair[] = [];
  private _supplyHistory: MeterReading[] = [];
  private _deviceHistory: MeterReading[] = [];
  private _supplyStats: DeviceStats;
  private _deviceStats: DeviceStats;
  private syncWindow = 500; // ms tolerance for pairing readings
  private maxHistory = 3600;
  private _recording = false;
  private _startTime: number | null = null;

  constructor() {
    this.supplyMeter = new Meter("supply", "Power Supply");
    this.deviceMeter = new Meter("device", "Device Under Test");
    this._supplyStats = this.emptyStats();
    this._deviceStats = this.emptyStats();

    this.supplyMeter.onEvent(this.handleEvent.bind(this));
    this.deviceMeter.onEvent(this.handleEvent.bind(this));
  }

  private emptyStats(): DeviceStats {
    return { min: {}, max: {}, avg: {}, sampleCount: 0 };
  }

  get supplyConnected(): boolean {
    return this.supplyMeter.connected;
  }

  get deviceConnected(): boolean {
    return this.deviceMeter.connected;
  }

  get supplyName(): string {
    return this.supplyMeter.deviceName;
  }

  get deviceName(): string {
    return this.deviceMeter.deviceName;
  }

  get supplyDeviceId(): string {
    return this.supplyMeter.bleDeviceId;
  }

  get deviceDeviceId(): string {
    return this.deviceMeter.bleDeviceId;
  }

  swapMeters() {
    const temp = this.supplyMeter;
    this.supplyMeter = this.deviceMeter;
    this.deviceMeter = temp;
    this.supplyMeter.id = "supply";
    this.deviceMeter.id = "device";
    this.supplyMeter.onEvent(this.handleEvent.bind(this));
    this.deviceMeter.onEvent(this.handleEvent.bind(this));
    const tempReading = this.lastSupplyReading;
    this.lastSupplyReading = this.lastDeviceReading;
    this.lastDeviceReading = tempReading;
  }

  get history(): SyncedReadingPair[] {
    return this._history;
  }

  get supplyHistory(): MeterReading[] {
    return this._supplyHistory;
  }

  get deviceHistory(): MeterReading[] {
    return this._deviceHistory;
  }

  get supplyStats(): DeviceStats {
    return this._supplyStats;
  }

  get deviceStats(): DeviceStats {
    return this._deviceStats;
  }

  get recording(): boolean {
    return this._recording;
  }

  get startTime(): number | null {
    return this._startTime;
  }

  onSync(callback: SyncCallback) {
    this.syncCallback = callback;
  }

  onDeviceEvent(callback: DeviceEventCallback) {
    this.deviceEventCallback = callback;
  }

  async connectSupply(): Promise<void> {
    await this.supplyMeter.connect();
  }

  async connectDevice(): Promise<void> {
    await this.deviceMeter.connect();
  }

  async disconnectSupply(): Promise<void> {
    await this.supplyMeter.disconnect();
  }

  async disconnectDevice(): Promise<void> {
    await this.deviceMeter.disconnect();
  }

  async resetMeters(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.supplyMeter.connected) {
      promises.push(this.supplyMeter.resetCounters());
    }
    if (this.deviceMeter.connected) {
      promises.push(this.deviceMeter.resetCounters());
    }
    await Promise.all(promises);
  }

  startRecording() {
    this._recording = true;
    this._startTime = Date.now();
    this.reset();
  }

  stopRecording() {
    this._recording = false;
  }

  reset() {
    this._history = [];
    this._supplyHistory = [];
    this._deviceHistory = [];
    this._supplyStats = this.emptyStats();
    this._deviceStats = this.emptyStats();
    this.lastSupplyReading = null;
    this.lastDeviceReading = null;
    this._startTime = Date.now();
  }

  private handleEvent(event: MeterEvent) {
    if (this.deviceEventCallback) {
      this.deviceEventCallback(event);
    }

    if (event.type === "reading" && event.data && this._recording) {
      if (event.meterId === "supply") {
        this.lastSupplyReading = event.data;
        this._supplyHistory.push(event.data);
        if (this._supplyHistory.length > this.maxHistory) {
          this._supplyHistory.shift();
        }
        this.updateStats(this._supplyStats, event.data);
      } else {
        this.lastDeviceReading = event.data;
        this._deviceHistory.push(event.data);
        if (this._deviceHistory.length > this.maxHistory) {
          this._deviceHistory.shift();
        }
        this.updateStats(this._deviceStats, event.data);
      }

      this.trySync();
    }
  }

  private trySync() {
    const supply = this.lastSupplyReading;
    const device = this.lastDeviceReading;

    let pair: SyncedReadingPair;

    if (supply && device && Math.abs(supply.timestamp - device.timestamp) <= this.syncWindow) {
      pair = {
        timestamp: Math.max(supply.timestamp, device.timestamp),
        supply,
        device,
        delta: {
          voltage: Math.round((supply.voltage - device.voltage) * 100) / 100,
          current: Math.round((supply.current - device.current) * 100) / 100,
          power: Math.round((supply.power - device.power) * 100) / 100,
        },
      };
    } else {
      pair = {
        timestamp: Date.now(),
        supply: supply || null,
        device: device || null,
        delta: {
          voltage: supply && device ? Math.round((supply.voltage - device.voltage) * 100) / 100 : null,
          current: supply && device ? Math.round((supply.current - device.current) * 100) / 100 : null,
          power: supply && device ? Math.round((supply.power - device.power) * 100) / 100 : null,
        },
      };
    }

    this._history.push(pair);
    if (this._history.length > this.maxHistory) {
      this._history.shift();
    }

    if (this.syncCallback) {
      this.syncCallback(pair);
    }
  }

  private updateStats(stats: DeviceStats, reading: MeterReading) {
    stats.sampleCount++;
    const fields: (keyof MeterReading)[] = ["voltage", "current", "power", "energy", "capacity", "temperature"];

    for (const field of fields) {
      const val = reading[field] as number;
      if (typeof val !== "number" || !isFinite(val)) continue;

      const min = stats.min as any;
      const max = stats.max as any;
      const avg = stats.avg as any;

      if (min[field] === undefined || val < min[field]) min[field] = val;
      if (max[field] === undefined || val > max[field]) max[field] = val;

      if (avg[field] === undefined) {
        avg[field] = val;
      } else {
        avg[field] = avg[field] + (val - avg[field]) / stats.sampleCount;
        avg[field] = Math.round(avg[field] * 100) / 100;
      }
    }
  }

  exportCSV(): string {
    const headers = [
      "timestamp",
      "supply_voltage", "supply_current", "supply_power", "supply_energy", "supply_capacity", "supply_temp",
      "device_voltage", "device_current", "device_power", "device_energy", "device_capacity", "device_temp",
      "delta_voltage", "delta_current", "delta_power",
    ];

    let csv = headers.join(",") + "\n";

    for (const pair of this._history) {
      const row = [
        new Date(pair.timestamp).toISOString(),
        pair.supply?.voltage ?? "",
        pair.supply?.current ?? "",
        pair.supply?.power ?? "",
        pair.supply?.energy ?? "",
        pair.supply?.capacity ?? "",
        pair.supply?.temperature ?? "",
        pair.device?.voltage ?? "",
        pair.device?.current ?? "",
        pair.device?.power ?? "",
        pair.device?.energy ?? "",
        pair.device?.capacity ?? "",
        pair.device?.temperature ?? "",
        pair.delta.voltage ?? "",
        pair.delta.current ?? "",
        pair.delta.power ?? "",
      ];
      csv += row.join(",") + "\n";
    }

    return csv;
  }
}
