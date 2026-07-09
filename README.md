# Reslab DL24 Monitor

[![Download](https://img.shields.io/github/v/release/andrewchuev/reslab-dl24-monitor?label=download&style=for-the-badge&color=2f81f7)](https://github.com/andrewchuev/reslab-dl24-monitor/releases/latest)

A desktop and Android instrument panel for the **Atorch DL24 / PX-100**
electronic DC load: real-time voltage/current/power telemetry,
capacity/energy/temperature/runtime metrics, CSV session export, and a
Control Center for driving the load directly — set current, cut-off
voltage, timeout, on/off, and counter reset. Connects over USB-serial,
Bluetooth-SPP, or Bluetooth LE.

## Screenshots

| Live telemetry | Settings | Light theme | Compact layout |
| --- | --- | --- | --- |
| ![Dashboard](docs/screenshots/screenshot_01.png) | ![Settings](docs/screenshots/screenshot_02.png) | ![Light theme](docs/screenshots/screenshot_03.png) | ![Compact layout](docs/screenshots/screenshot_04.png) |

## Features

- Two transports, same protocol either way: **Serial** (USB or
  Bluetooth-SPP) on desktop, and **Bluetooth LE** on both desktop and
  Android. Desktop remembers the last COM port that worked and probes
  every available port from the highest number down if it's gone (the
  DL24 typically enumerates as the last or second-to-last serial port);
  either platform remembers the last successful connection (port or BLE
  device) and reconnects to it automatically on launch
- Android hides the Serial option entirely (there's no such thing as a
  COM port on a phone) rather than showing an option that can't work
- Real-time voltage / current / power, each on its own auto-scaled chart
  with a real wall-clock time axis (not time elapsed since the app was
  opened) and full-session history (the "30s/5m/15m" range only zooms the
  live view; "All" and exports always cover the whole session, not just
  what's currently rendered). All three charts share a `syncId`, so
  tapping or hovering any one of them shows the cursor/tooltip at the same
  instant on all three
- Capacity (Ah), energy (Wh), temperature and runtime readouts
- CSV export of a monitoring session: a real timestamp plus elapsed
  seconds per row, full-precision voltage/current/power, unbounded by the
  chart's render settings
- Excel (.xlsx) export with the same session, V/A/W rounded to 3 decimals
  for readability, plus native editable charts plotted against real time
  on their own sheet
- Control Center: load on/off, set current, set cut-off voltage, set
  timeout, reset accumulated counters
- Dark/light theme, configurable poll interval and chart history
- UI in English, Russian or Ukrainian (Settings → Language), detected from
  the OS locale on first launch with English as the fallback; measurement
  units (V/A/W/Ah/Wh) and numeric formatting stay locale-neutral throughout
  the UI, charts and exports for consistency and easier data interchange
- Type-safe Rust ↔ TypeScript bridge — the UI never drifts from the backend

**Note:** the PX-100 only operates in fixed constant-current (CC) mode —
there is no mode-switch command in the protocol, so the Control Center shows
a static "Mode: CC" badge rather than a CC/CV/CR/CP selector.

## Tech Stack

- **Backend:** Rust, [Tauri v2](https://v2.tauri.app/), [`serialport`](https://crates.io/crates/serialport) (desktop Serial), [`tauri-plugin-blec`](https://github.com/MnlPhlp/tauri-plugin-blec) (BLE, desktop + Android), [`tauri-specta`](https://github.com/specta-rs/tauri-specta), [`rust_xlsxwriter`](https://crates.io/crates/rust_xlsxwriter)
- **Frontend:** React 19, TypeScript, [shadcn/ui](https://ui.shadcn.com/) (Radix + Tailwind v4), [Recharts](https://recharts.org/), [react-i18next](https://react.i18next.com/)
- **Platforms:** Windows, macOS, Linux, Android (Tauri Mobile)
- **Release automation:** GitHub Actions, [`tauri-action`](https://github.com/tauri-apps/tauri-action) (Windows/macOS/Linux installers - Android is built and signed manually, see [Android](#android))

## Protocol

The PX-100 exposes a binary command protocol over a 9600 8N1 UART link
(USB-serial, Bluetooth-SPP, or Bluetooth LE). Every exchange is
host-initiated: the app sends a 6-byte request frame and the device
replies with either a 1-byte acknowledgement (write commands) or a 7-byte
data frame (queries).

### BLE transport

The device exposes the same protocol over BLE via the standard
"transparent UART" GATT profile - service `0000FFE0`, characteristic
`0000FFE1` (`Write | WriteWithoutResponse | Notify`). `BleSerialPort`
(`src-tauri/src/ble.rs`) implements the `serialport::SerialPort` trait
over it, so every protocol function above runs unmodified regardless of
transport - reads go over `Notify`, writes go out as
`WriteWithoutResponse` (not `WithResponse`: `tauri-plugin-blec`'s Android
backend misreads a successful GATT write callback as a failure and
retries up to 100 times before giving up, even though the device already
answered - confirmed via `adb logcat` against a real phone).

The device also broadcasts its own native `FF 55`-framed telemetry
unprompted over the same characteristic (a different, unrelated protocol
family - see `src-tauri/examples/atorch_ff55.rs` for a decoder, validated
field-by-field against this app's own readings including a live
reset-counters transition). The app doesn't use it; `clear_buffer` just
drains it as stale bytes ahead of each request, exactly like it already
did for whatever noise showed up on the SPP link.

Connecting reliably needs one more thing on Android:
`tauri-plugin-blec`'s own `connect()` only auto-scans for 1s if its
internal device cache is empty, which isn't always enough to catch the
advertisement on a marginal link (e.g. right after a cold app launch).
`BleSerialPort::connect` front-loads a real ~3s scan (with an actual
channel drained to completion - passing `tx: None` returns almost
immediately without scanning at all, since there's nothing to relay
results to) before attempting to connect, which is what makes
auto-reconnect-on-launch reliable rather than a coin flip.

**Request frame**

| Offset | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Value | `0xB1` | `0xB2` | command | data1 | data2 | `0xB6` |

**Query response frame** (commands ≥ `0x10`)

| Offset | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Value | `0xCA` | `0xCB` | data1 | data2 | data3 | `0xCE` | `0xCF` |

**Write acknowledgement** (commands < `0x10`): a single `0x6F` byte.

### Write commands

| Code | Command | data1 | data2 | Effect |
| --- | --- | --- | --- | --- |
| `0x01` | On/off | `1` = on, `0` = off | `0` | Enables or disables the load |
| `0x02` | Set current | integer amps | fractional amps × 100 | Sets the CC current, e.g. 2.50 A → `(2, 50)` |
| `0x03` | Set cut-off voltage | integer volts | fractional volts × 100 | Under-voltage protection threshold |
| `0x04` | Set timeout | seconds (high byte) | seconds (low byte) | Auto-off timer as a 16-bit value; `0` disables it |
| `0x05` | Reset counters | `0` | `0` | Clears the accumulated capacity/energy counters |

### Query commands

data1..data3 form a 24-bit big-endian integer that is divided by the scale
factor below to get the physical value, except the two time fields, which
are the `HH`, `MM`, `SS` bytes directly.

| Code | Command | Scale | Unit |
| --- | --- | --- | --- |
| `0x10` | Load on/off state | ÷ 1 | `0`/`1` |
| `0x11` | Measured voltage | ÷ 1000 | V |
| `0x12` | Measured current | ÷ 1000 | A |
| `0x13` | Elapsed time | — | `HH:MM:SS` |
| `0x14` | Capacity | ÷ 1000 | Ah |
| `0x15` | Energy | ÷ 1000 | Wh |
| `0x16` | Temperature | ÷ 1 | °C |
| `0x17` | Set current (readback) | ÷ 100 | A |
| `0x18` | Set cut-off voltage (readback) | ÷ 100 | V |
| `0x19` | Set timeout (readback) | — | `HH:MM:SS` |

### Polling and reliability

- `0x10`–`0x14` are queried every poll cycle; `0x15`–`0x19` are queried
  round-robin, one per cycle, to keep each cycle short.
- Every query/write is retried up to 3 times with a ~1.2 s response deadline
  and a ~200 ms backoff between attempts.
- Reads and writes watch a shared stop flag, so disconnecting doesn't have
  to wait out an in-flight timeout.
- If 5 consecutive poll cycles read nothing at all (e.g. the USB-serial
  adapter was unplugged), the app auto-reconnects: it reopens the port and
  re-probes it, up to 5 attempts with a 2 s backoff. Success resumes polling
  transparently; exhausting all attempts reports a connection error and
  stops, instead of the UI silently freezing on stale readings.
- The UI's poll interval slider allows down to 300 ms, but that floor isn't
  actually reachable: a full cycle (6 queries: 5 frequent + 1 round-robin)
  measured 529-678 ms end to end on real hardware (DL24P, Bluetooth-serial
  bridge, 20 clean cycles, no retries) - roughly 47 ms per query just for
  the pre-read buffer clear, plus 29-104 ms (51 ms average) of the device's
  own response latency, which is well above what 9600 baud transmission
  time alone would suggest. Setting the interval below ~550-600 ms doesn't
  poll any faster; the protocol round-trip is the bottleneck, not the
  configured interval.

Reverse-engineered from the [`misdoro/Electronic_load_px100`](https://github.com/misdoro/Electronic_load_px100)
protocol notes; see `dl24_reference.py` for the original Python reference
implementation this app's Rust protocol layer is ported from.

## Logs

Every launch writes a fresh `session-YYYYMMDD-HHMMSS.log` (UTC) to the app's
log directory - decoded telemetry per poll cycle, every serial retry/failure,
and every user action (connect/disconnect, Control Center commands, chart
controls, settings changes), so a session can be replayed after the fact
instead of only reasoning from what's currently on screen.

| OS | Location |
| --- | --- |
| Windows | `%LOCALAPPDATA%\dev.reslab.dl24monitor\logs\` |
| macOS | `~/Library/Logs/dev.reslab.dl24monitor/` |
| Linux | `~/.local/share/dev.reslab.dl24monitor/logs/` |

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/)
- Platform build tools per the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Development

```sh
npm install
npm run tauri dev
```

### Adding translations

UI strings live in `src/i18n/locales/{en,ru,uk}.json`, one flat-ish key tree
shared across all three - add a key to all three files when adding new UI
text (`en.json` is the reference). Rust-originated error messages are only
partially localized: `src/utils/backendErrors.ts` maps the fixed set of known
backend error strings to translation keys and falls back to the raw English
text for anything else (e.g. OS-level I/O errors), since the backend doesn't
send error codes.

### Build

```sh
npm run tauri build
```

The frontend bundle is ~760 kB minified (~230 kB gzip), mostly `recharts` and
its Redux-based internals - well past Vite's default 500 kB chunk-size
warning, which is raised in `vite.config.ts` since that threshold targets
assets fetched over a network, not a Tauri bundle loaded from disk.

### Testing

```sh
cd src-tauri && cargo test    # protocol parsing + mocked serial framing
cd src-tauri && cargo clippy  # Rust lints
npx tsc --noEmit              # frontend type-checking
```

## Android

### Prerequisites

- Android Studio, with the **NDK (Side by side)** package installed via its
  SDK Manager (SDK Tools tab) - not installed by default, and `cargo`
  can't cross-compile for Android without it
- Windows only: symlinking the built `.so` into the Android project needs
  [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development)
  enabled, or the build fails with `Creation symbolic link is not allowed`
- `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
- `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` environment variables (the last
  can point at Android Studio's bundled JBR, e.g.
  `C:\Program Files\Android\Android Studio\jbr` on Windows)

### Development

```sh
npx tauri android dev
```

Targets whichever emulator or USB-debugging-enabled device `adb` sees
connected. **BLE does not reliably work on emulators** - they don't have
real Bluetooth radio support - so BLE testing needs a physical device.

### Release build

Signing needs a keystore, generated once and kept outside the repo (the
signing password lives in plaintext in the properties file that
references it):

```sh
keytool -genkey -v -keystore /path/to/upload-keystore.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then a `keystore.properties` file (also outside the repo -
`src-tauri/gen/android/app/build.gradle.kts` reads it from a hardcoded
absolute path) with:

```properties
keyAlias=upload
storeFile=/path/to/upload-keystore.jks
password=<the keystore password>
```

```sh
npx tauri android build --apk
```

Produces an unsigned-by-default build unless the signing config above is
present, in which case the release APK/AAB is signed automatically. Output:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.

This local build is for testing signing manually; the CI release build
(below) produces the actual published APK.

## Releasing

Development happens on the private GitLab repo; GitHub only hosts the public
README/screenshots/releases. The app version lives in `package.json`;
`src-tauri/tauri.conf.json` points at it directly and `src-tauri/Cargo.toml` is
kept in sync automatically by `scripts/sync-version.cjs`, which runs as npm's
`version` lifecycle script:

```sh
npm version patch   # or minor / major
git push origin main
git push origin "v$(node -p "require('./package.json').version")"
```

Push the tag as its own step, not bundled into the branch push via
`--follow-tags` — GitLab only fires a pipeline per tag when it lands as its
own ref update.

Pushing the tag runs GitLab CI's `trigger-github-release` job, which asks
`.github/workflows/release.yml` on GitHub to build installers for Windows,
macOS (Intel + Apple Silicon), Linux, and the signed Android APK, cloning that
exact tag from GitLab. Everything lands as a GitHub Release tagged
`app-v<version>` — no manual GitHub-side step involved.
