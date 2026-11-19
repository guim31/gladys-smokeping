# SmokePing for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the targets of a [SmokePing](https://oss.oetiker.ch/smokeping/)
server into Gladys: the latency and packet loss of your connection towards
the hosts SmokePing pings.

- **One device per target**: reachable (green/red badge), median latency,
  packet loss, jitter, time of the last measurement, and the SmokePing graph
  as a camera image.
- **Scene triggers**: a target becomes unreachable, is reachable again (with
  the outage length), packet loss above the threshold, latency above the
  threshold — after a chosen number of measurements in a row, for any target,
  added to Gladys or not.
- **Scene actions**: state of a target (with a ready-made sentence), count the
  unreachable and degraded targets (in a group or everywhere).
- **Dashboard widget**: unreachable and degraded targets first, with their
  latency and loss.
- Texts in English, French, German and Spanish.

Tested against a real SmokePing in Docker (SmokePing 2.9.0,
`lscr.io/linuxserver/smokeping`): reachable and unreachable targets, packet
loss caused on purpose with `tc netem`. Feedback welcome on
[the issues](https://github.com/guim31/gladys-smokeping/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- SmokePing 2.7 or later, its web interface reachable from Gladys.
- Its RRD files served read-only by its web server: one `Alias` line, see
  [the guide](docs/en.md#1-serve-the-rrd-files). SmokePing has no API.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-smokeping`. Then open its configuration,
enter the address of SmokePing, and add the targets from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

SmokePing has no JSON API, so the container reads two things over HTTP:

- the web interface (`smokeping.cgi`): its menu (`?filter=.`) lists the
  targets with their labels, and `?displaymode=a` draws the graph of a target
  as a PNG — the camera image;
- the RRD file of each target (`data/<Group>/<Target>.rrd`), served by the
  same web server: a small reader in plain JavaScript (`src/smokeping/rrd.js`)
  fetches the header and the newest rows with HTTP Range requests, a few KB
  per target, instead of the 1.7 MB file. No `rrdtool` in the image.

At the chosen interval (1 minute by default), it publishes the states of the
devices added to Gladys when they change, pushes the graphs every 5 minutes,
and fires the scene events on the transitions of every target. The last state
of each target is kept in `/data`, so a target that went down during a
restart is announced once. Redirects are not followed, so the credentials are
never sent to another host.

Network monitoring neighbours: [gladys-ping-wol](https://github.com/guim31/gladys-ping-wol)
(ping hosts from Gladys) and [gladys-gatus](https://github.com/guim31/gladys-gatus)
(HTTP endpoints).

## Limits

- One SmokePing server per configuration, its master measurements only.
- RRD files written by a 64-bit little-endian machine (x86_64, arm64) or a
  32-bit ARM one; big-endian and 32-bit x86 files are refused.
- Multi-host targets have no RRD file: not offered.
- An outage shorter than one SmokePing step may not be seen.
- The graph is a PNG image (Gladys usually carries JPEG camera images): shown
  by the dashboard, not checked with every message channel.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on SmokePing
and the RRD format.

## Credits

- [SmokePing](https://oss.oetiker.ch/smokeping/) by Tobias Oetiker, Niko
  Tyni and contributors (GPL-2.0), and
  [RRDtool](https://oss.oetiker.ch/rrdtool/) by Tobias Oetiker: the RRD
  layout follows `rrd_format.h`; the menu page and the RRD files in
  `test/fixtures/smokeping` come from the `lscr.io/linuxserver/smokeping`
  image. No code of theirs is included.
- Home Assistant has no SmokePing integration to start from.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-gatus](https://github.com/guim31/gladys-gatus).

Not affiliated with SmokePing, RRDtool or their authors.

## License

Apache-2.0, see [LICENSE](LICENSE).
