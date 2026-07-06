# PX-100 Load Monitor

A Tauri desktop app for monitoring and controlling an Atorch/PX-100 electronic
load over a serial (USB) connection: live voltage/current/power telemetry,
device metrics (capacity, energy, temperature, runtime), CSV export of a
session, and a Control Center for setting the load current, cut-off voltage,
timeout, on/off state, and resetting the accumulated counters.

**PX-100 only supports a fixed constant-current (CC) mode** — the protocol has
no mode-switch command, so there's no CC/CV/CR/CP selector; the Control Center
shows a static "Mode: CC" badge instead.

## Architecture

**Backend** (`src-tauri/src`), Rust:

- `protocol.rs` — PX-100 frame format, command bytes, value decoding, and the
  `(integer, fraction)` byte-pair encoding used by the write commands (pure
  functions, unit tested).
- `serial.rs` — blocking serial I/O: framing, retries, response parsing for
  both queries (`get_val`) and writes (`set_current`, `set_cutoff`,
  `set_timeout`, `set_onoff`, `reset_counters`). Accepts a `stop: &AtomicBool`
  throughout so a disconnect request is noticed within ~100ms instead of only
  between poll cycles.
- `state.rs` — shared `AppState` holding the background polling worker and an
  `mpsc` command queue (`WorkerEvent`/`ControlCommand`) used to send hardware
  writes to the single thread that owns the serial port handle.
- `commands.rs` — Tauri commands (`list_ports`, `connect_port`,
  `disconnect_port`, `set_load_on`, `set_current`, `set_cutoff_voltage`,
  `set_timeout_seconds`, `reset_counters`) and the `device-data` /
  `connection-status` events.

Commands and events are annotated with `#[specta::specta]` /
`specta::Type` (via [tauri-specta](https://github.com/specta-rs/tauri-specta))
so `src/bindings.ts` is regenerated on every debug build — the frontend
never hand-maintains a duplicate of the Rust payload types. `bindings.ts`
is checked into version control so `npm run build` works without first
running a debug build.

**Frontend** (`src`), React + [shadcn/ui](https://ui.shadcn.com/) (Radix +
Tailwind v4) + [Recharts](https://recharts.org/):

- `Dashboard.tsx` — orchestrates connection state, the chart data buffer
  and settings; talks to the backend exclusively through
  `bindings.ts`'s `commands`/`events`.
- `components/StatusHeader.tsx` — device identity, connection state, port
  selection, and a gear icon opening Settings in a `Sheet`.
- `components/HeroMetrics.tsx` / `SecondaryMetrics.tsx` — the live readouts,
  split into primary (voltage/current/power) and secondary
  (capacity/energy/temperature/runtime) rows.
- `components/TelemetryCharts.tsx` / `MetricAreaChart.tsx` — three
  independent thin-line/gradient-area charts (one per channel, each
  auto-scaled to its own data) instead of one chart overlaying all three on a
  shared Y-axis.
- `components/ControlCenter.tsx` — load on/off, set current/cut-off/timeout,
  reset counters; every action reports success/failure via a `sonner` toast.
- `utils/settings.ts` — persists poll interval / chart refresh rate / max
  points to `localStorage`.

Logging goes through [`tauri-plugin-log`](https://v2.tauri.app/plugin/logging/)
(stdout + the OS log directory), replacing what used to be silently
swallowed serial I/O errors.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (see `package.json` for tested versions)
- Platform build tools per the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Development

```sh
npm install
npm run tauri dev
```

## Build

```sh
npm run tauri build
```

## Testing

```sh
cd src-tauri && cargo test    # protocol parsing + mocked serial framing
npx tsc --noEmit              # frontend type-checking
```

## Releasing

The app version lives in `package.json`; `src-tauri/tauri.conf.json` points at
it directly and `src-tauri/Cargo.toml` is kept in sync automatically by
`scripts/sync-version.cjs`, which runs as npm's `version` lifecycle script:

```sh
npm version patch   # or minor / major
git push origin main --follow-tags
```

To cut a release, push that commit to the `release` branch:

```sh
git push origin main:release
```

`.github/workflows/release.yml` then builds installers for Windows, macOS
(Intel + Apple Silicon) and Linux and publishes them as a GitHub Release
tagged `app-v<version>` — no pull request involved.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
