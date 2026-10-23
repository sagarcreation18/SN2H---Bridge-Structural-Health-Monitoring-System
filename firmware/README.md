# ESP32 + ADXL345 preparation

For timestamped remote uploads and persistent offline buffering, use the separate `remote_monitor` sketch and its own `config.h`. See [the advanced guide](../ADVANCED_FEATURES.md#esp32-offline-preparation). The older sketch below uses direct `/api/sensor-data` ingestion. Both are preparation code requiring physical compilation and validation.

**Untested:** firmware compilation, physical sensing, electrical wiring, calibration, LEDs, and buzzer operation. No hardware is connected. This is a bench demonstration, not a certified alarm or structural safety system.

Use Arduino IDE with the official Espressif ESP32 board package. Open `bridge_monitor/bridge_monitor.ino` and copy `bridge_monitor/config.example.h` to `bridge_monitor/config.h`. Fill Wi-Fi, the HTTPS ingestion endpoint, DEVICE_TOKEN from the backend `.env`, and the endpoint's trusted root CA. Select ESP32 Dev Module and verify/compile before upload. Core Wire/WiFi/HTTPClient libraries are used; no sensor library is required. TLS certificate verification is retained.

## Proposed connections (confirm your board pinout)

| ESP32  | ADXL345 / peripheral                             |
| ------ | ------------------------------------------------ |
| 3V3    | sensor VCC and I/O supply, CS high for I²C       |
| GND    | sensor GND; SDO/ALT ADDRESS low for address 0x53 |
| GPIO21 | SDA, pulled up to 3.3 V                          |
| GPIO22 | SCL, pulled up to 3.3 V                          |
| GPIO18 | green LED through a suitable series resistor     |
| GPIO19 | red LED through a suitable series resistor       |
| GPIO23 | transistor/MOSFET driver input for active buzzer |

Use common ground. Verify breakout-board regulators and pull-ups; do not apply 5 V to ESP32 I/O. Size the buzzer supply and driver for its rating; do not power an unknown buzzer directly from a GPIO. Add a flyback diode if required by an inductive buzzer/load. The proposed code drives an active buzzer with HIGH/LOW.

## Calibration and processing

1. Mount the sensor rigidly with +Z upward. Confirm the ADXL345 device ID (0xE5 at register 0x00) with an I²C scan/read before enabling measurement.
2. Keep it stationary and average at least 500 samples. Set `offsetX=meanX`, `offsetY=meanY`, `offsetZ=meanZ-1`. Verify corrected stationary acceleration is approximately (0, 0, 1) g.
3. Verify orientation, scale, noise floor, and known gentle movement. Record calibration offsets and mounting orientation. The backend assumes this fixed calibrated baseline; tilted mounting or changing orientation needs a different baseline model.
4. Local firmware RMS uses 25 locally sampled values. Backend RMS uses 25 received values. They have different time windows and are intentionally not claimed identical. HTTP is blocking in this preparation example, so sampling cadence is not guaranteed while sending; use separate tasks and buffered acquisition for hardware validation.
5. Firmware has fixed demo thresholds 0.15/0.35 g, independent of backend settings. Synchronize and validate them before a bench alarm demonstration. Physical alarm operation remains untested.

## Switching to a hardware demonstration

Stop the simulator in the UI. Keep `esp32-01` enabled. The backend is bound to loopback by default; place an authenticated HTTPS reverse proxy in front of it for the ESP32 to reach. Configure the proxy for REST and Socket.IO upgrades, keep MySQL private, and set the CA and reachable hostname in `config.h`. Do not disable certificate validation. Device credentials permit ingestion only; never flash ADMIN_TOKEN.

POST payload (acceleration in g):

```json
{ "device_id": "esp32-01", "x": 0.01, "y": -0.01, "z": 1.002 }
```

Use `Authorization: Bearer <DEVICE_TOKEN>`. The backend supplies receive timestamps, validates the registered hardware identity, computes magnitude/RMS and persists data through the same pipeline as simulation. Historical Analytics and Reports support an explicit hardware source filter; the demonstration Overview and Live Monitoring views remain visibly SIMULATION.

References: [Analog Devices ADXL345 datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/ADXL345.pdf) for voltage, register configuration and full-resolution scale; [Espressif secure-client example](https://github.com/espressif/arduino-esp32/blob/master/libraries/NetworkClientSecure/examples/WiFiClientSecure/WiFiClientSecure.ino) for verified TLS connections.

## New device configuration
Set DEVICE_ID in config.h to the registered hardware identity. Register additional esp32-prefixed identities in Devices and choose their bridge location. Overview and Live Monitoring can select hardware directly. Optional health metadata reports RSSI, uptimeMs and firmware; battery is omitted unless measured. If using saved backend calibration, leave firmware offsets at zero to avoid applying correction twice. Physical firmware validation is still required.

