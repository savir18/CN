# Protocol Lab: Computer Networks project

Team 34. A browser dashboard of interactive experiments that follow the Computer Networks syllabus.
Plain HTML, CSS and JavaScript. No frameworks, no build step, no server, no internet needed.

## Run it

Open `f1_team34_index.html` in any modern browser (double click it). That is all.
Fonts load from Google Fonts when online and fall back to system fonts otherwise.

## What is inside

| Lab | Syllabus | What you can do |
|---|---|---|
| Error detection | Unit 3 | Hamming (SEC and SEC-DED), CRC with step-by-step division, internet checksum, Monte Carlo detection test |
| Flow control | Unit 3 | Stop-and-Wait, Go-Back-N, Selective Repeat on a lossy link, space-time diagram, efficiency sweeps |
| Multiple access | Unit 3 | Pure and slotted ALOHA, CSMA (1-persistent, non-persistent), CSMA/CD; throughput against load |
| TCP congestion | Unit 6 | Tahoe and Reno window lab; shared bottleneck with drop-tail or RED, fairness |
| Queuing and QoS | Unit 6 | FIFO, priority, WFQ; delay, jitter, loss, throughput for a voice call |

Units 1, 2, 4, 5 and 7 have no lab. `docs/f1_team34_syllabus_mapping.md` lists what is covered and the model assumptions.

## Files

All files are named `f1_team34_<what it is>`.

```
f1_team34_index.html                  page shell, loads everything
css/f1_team34_styles.css              theme, layout
js/f1_team34_core.js                  helpers, widgets, theme, router, random numbers
js/f1_team34_charts.js                small canvas chart library
js/f1_team34_overview.js              landing page and coverage table
js/f1_team34_error_detection.js       Hamming, CRC, checksum
js/f1_team34_flow_control.js          ARQ simulator
js/f1_team34_multiple_access.js       ALOHA / CSMA simulator
js/f1_team34_tcp_congestion.js        Tahoe, Reno, bottleneck model
js/f1_team34_queuing_qos.js           queuing disciplines
tests/f1_team34_tests*.js             automated tests
docs/                                    notes
```

Each `js` file keeps its calculations separate from its screen code, so the same logic runs in Node for testing.

## Run the tests

Needs Node 16 or newer. No packages to install.

```
node tests/f1_team34_tests.js
```

The tests check, among other things, that simulated ALOHA and CSMA throughput match the textbook formulas,
that every ARQ protocol delivers all frames in order despite random loss, that Reno beats Tahoe on the same
losses, and that priority queuing protects voice traffic.

## Known limits

- Pages were checked in headless Chromium (light, dark and phone width) and in a simulated browser, not on every real device. Report anything that looks off.
- The congestion and queuing labs are simplified models (a round-based window model, a fluid-flow bottleneck, a packet-level port), meant for understanding, not for measuring real networks.
