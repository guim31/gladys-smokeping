# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-19

### Added

- One device per SmokePing target: reachable, median latency, packet loss,
  jitter, time of the last measurement, and the SmokePing graph as a camera
  image (3 hours, 30 hours or 10 days).
- Measurements read from the RRD files of SmokePing, served read-only by its
  web server (one `Alias` line, see the guide), with HTTP Range requests.
- Scene triggers "A target becomes unreachable", "A target is reachable again"
  (with the outage length), "Packet loss above the threshold" and "Latency
  above the threshold", after a chosen number of measurements in a row, for
  any target.
- Scene actions "State of a target" (with a ready-made sentence) and "Count
  the unreachable targets".
- Dashboard widget: unreachable and degraded targets first, with their latency
  and loss; tiles and Refresh button can be hidden.
- "Test the connection" action; texts in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-smokeping/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-smokeping/releases/tag/v1.0.0
