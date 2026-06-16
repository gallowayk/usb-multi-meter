# USB Multi Meter

Multi-device USB BLE power meter dashboard that synchronizes readings from two Atorch-compatible power meters — one on the power supply side and one on the device under test.

## Purpose

When testing USB power delivery, cable quality, or device power consumption, you often need to measure both sides simultaneously. This app connects to two BLE power meters and provides:

- **Synchronized live readings** from both supply and device sides
- **Delta calculations** showing voltage drop, current difference, power loss, and efficiency
- **Cable resistance estimation** derived from voltage drop and current
- **Real-time charts** with selectable metrics (voltage, current, power, energy, temperature)
- **Statistics** tracking min/avg/max for each meter
- **CSV export** of all synchronized data for further analysis

## Hardware

This works with Atorch-compatible BLE power meters including:

- Atorch J7-C (USB meter)
- Atorch UD18 (USB meter)
- Atorch AT24 (USB meter)
- DL24 electronic load (DC meter mode)
- Any device compatible with the [E-test](https://play.google.com/store/apps/details?id=com.tang.etest.e_test) app

You'll need **two meters** — one placed between the power supply and cable, and one between the cable and device.

## Browser Requirements

Requires a browser with [WebBluetooth](https://web.dev/bluetooth/) support:

- Chrome (desktop + Android)
- Edge (desktop)
- Opera (desktop)

Safari and Firefox do not currently support WebBluetooth.

## Usage

1. Open `public/index.html` in a supported browser
2. Click **Connect** on "Power Supply Side" and pair with the meter near your power source
3. Click **Connect** on "Device Under Test" and pair with the meter near your device
4. Click **Start Recording** to begin capturing synchronized data
5. Use the chart tabs to switch between metrics
6. Click **Export CSV** to download all captured data

## Building

```shell
npm install
npm run build
```

For development with auto-rebuild:

```shell
npm run dev
```

## Serving Locally

Since this uses ES modules, you'll need to serve the files via HTTP (not `file://`):

```shell
npx serve public
```

Or with Python:

```shell
cd public && python3 -m http.server 8000
```

## Architecture

```
src/
├── meter.ts          # BLE protocol handler for Atorch meters
├── sync-manager.ts   # Synchronization logic pairing readings from two devices
└── app.ts            # UI controller with Chart.js integration
public/
├── index.html        # Single-page dashboard
└── js/               # Compiled JavaScript output
```

## Protocol

Uses the Atorch BLE UART protocol:

- Service UUID: `0000FFE0-0000-1000-8000-00805F9B34FB`
- Characteristic UUID: `0000FFE1-0000-1000-8000-00805F9B34FB`

Packets are 36 bytes with voltage, current, capacity, energy, temperature, and duration fields encoded as big-endian integers with known divisors.

## References

- [Atorch protocol documentation](https://github.com/CursedHardware/atorch-console/blob/master/docs/protocol-design.md)
- [Original single-meter app](https://github.com/lanrat/usb-meter)
- [ESPHome Atorch integration](https://github.com/syssi/esphome-atorch-dl24)
