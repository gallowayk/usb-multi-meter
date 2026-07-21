const UUID_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb";
const UUID_CHARACTERISTIC = "0000ffe1-0000-1000-8000-00805f9b34fb";

const START_OF_FRAME_BYTE1 = 0xFF;
const START_OF_FRAME_BYTE2 = 0x55;
const REPORT_PACKET_LEN = 36;

export enum MessageType {
  REPORT = 0x01,
  REPLY = 0x02,
  COMMAND = 0x11,
}

export enum DeviceType {
  AC = 0x01,
  DC = 0x02,
  USB = 0x03,
}

export interface MeterReading {
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
  resistance: number;
  capacity: number;
  energy: number;
  temperature: number;
  duration: string;
  durationSeconds: number;
  dataPlus: number | null;
  dataMinus: number | null;
  deviceType: DeviceType;
  deviceTypeName: string;
}

export type MeterEventType = "reading" | "connected" | "disconnected" | "error";

export interface MeterEvent {
  type: MeterEventType;
  meterId: string;
  deviceName: string;
  data?: MeterReading;
  error?: string;
}

type MeterEventCallback = (event: MeterEvent) => void;

// Extend DataView with getUint24
function getUint24(view: DataView, offset: number): number {
  return (view.getUint16(offset) << 8) | view.getUint8(offset + 2);
}

function parsePacket(data: DataView): MeterReading | null {
  if (data.byteLength < 2 || data.getUint8(0) !== START_OF_FRAME_BYTE1 || data.getUint8(1) !== START_OF_FRAME_BYTE2) {
    return null;
  }
  if (data.byteLength !== REPORT_PACKET_LEN) {
    return null;
  }

  const msgType = data.getUint8(2) as MessageType;
  if (msgType !== MessageType.REPORT) {
    return null;
  }

  const deviceType = data.getUint8(3) as DeviceType;
  const deviceTypeName = DeviceType[deviceType] || "UNKNOWN";

  let voltage: number;
  let current: number;
  let capacity: number;
  let energy: number;
  let dataPlus: number | null = null;
  let dataMinus: number | null = null;
  let temperature: number;
  let durationHours: number;
  let durationMinutes: number;
  let durationSeconds: number;

  if (deviceType === DeviceType.DC) {
    voltage = getUint24(data, 4) / 10;
    current = getUint24(data, 7) / 1000;
    capacity = getUint24(data, 10) * 10;
    energy = 0;
    temperature = data.getUint16(24);
    durationHours = data.getUint16(26);
    durationMinutes = data.getUint8(28);
    durationSeconds = data.getUint8(29);
  } else {
    voltage = getUint24(data, 4) / 100;
    current = getUint24(data, 7) / 100;
    capacity = getUint24(data, 10);
    energy = data.getUint32(13) / 100;
    temperature = data.getUint16(21);
    durationHours = data.getUint16(23);
    durationMinutes = data.getUint8(25);
    durationSeconds = data.getUint8(26);

    if (deviceType === DeviceType.USB) {
      dataMinus = data.getUint16(17) / 100;
      dataPlus = data.getUint16(19) / 100;
    }
  }

  const power = Math.round(100 * voltage * current) / 100;
  const resistance = current > 0 ? Math.round(100 * voltage / current) / 100 : Infinity;
  const totalSeconds = durationHours * 3600 + durationMinutes * 60 + durationSeconds;
  const duration = `${String(durationHours).padStart(3, "0")}:${String(durationMinutes).padStart(2, "0")}:${String(durationSeconds).padStart(2, "0")}`;

  return {
    timestamp: Date.now(),
    voltage,
    current,
    power,
    resistance,
    capacity,
    energy,
    temperature,
    duration,
    durationSeconds: totalSeconds,
    dataPlus,
    dataMinus,
    deviceType,
    deviceTypeName,
  };
}

export { UUID_SERVICE, UUID_CHARACTERISTIC };

export class Meter {
  id: string;
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private callback: MeterEventCallback | null = null;
  private _connected = false;
  private _label: string;

  constructor(id: string, label: string) {
    this.id = id;
    this._label = label;
  }

  get label(): string {
    return this._label;
  }

  set label(val: string) {
    this._label = val;
  }

  get connected(): boolean {
    return this._connected;
  }

  get deviceName(): string {
    return this.device?.name || "Unknown Device";
  }

  get bleDeviceId(): string {
    return this.device?.id || "";
  }

  onEvent(callback: MeterEventCallback) {
    this.callback = callback;
  }

  private emit(event: MeterEvent) {
    if (this.callback) {
      this.callback(event);
    }
  }

  async connect(): Promise<void> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UUID_SERVICE] }],
      });

      if (!this.device.gatt) {
        throw new Error("Device has no GATT server");
      }

      this.device.addEventListener("gattserverdisconnected", this.onDisconnect.bind(this));

      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(UUID_SERVICE);
      this.characteristic = await service.getCharacteristic(UUID_CHARACTERISTIC);
      await this.characteristic.startNotifications();
      this.characteristic.addEventListener("characteristicvaluechanged", this.onData.bind(this));

      this._connected = true;
      this.emit({
        type: "connected",
        meterId: this.id,
        deviceName: this.deviceName,
      });
    } catch (err: any) {
      this.emit({
        type: "error",
        meterId: this.id,
        deviceName: this.deviceName,
        error: err.message || String(err),
      });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.characteristic) {
      try {
        await this.characteristic.stopNotifications();
      } catch (_) {}
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  private onDisconnect(_event: Event) {
    this._connected = false;
    this.characteristic = null;
    this.emit({
      type: "disconnected",
      meterId: this.id,
      deviceName: this.deviceName,
    });
  }

  private onData(event: Event) {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    if (!char.value) return;

    const reading = parsePacket(char.value);
    if (reading) {
      this.emit({
        type: "reading",
        meterId: this.id,
        deviceName: this.deviceName,
        data: reading,
      });
    }
  }

  async sendCommand(hexString: string): Promise<void> {
    if (!this.characteristic) return;
    const bytes = new Uint8Array(
      hexString.replace(/\./g, "").match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16))
    );
    await this.characteristic.writeValueWithoutResponse(bytes);
  }

  async resetCounters(): Promise<void> {
    await this.sendCommand("FF.55.11.01.05.00.00.00.00.53");
  }
}
