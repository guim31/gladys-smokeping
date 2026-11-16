# SmokePing

[SmokePing](https://oss.oetiker.ch/smokeping/) measures the latency and the
packet loss of your connection towards chosen targets, and draws its famous
"smoke" graphs. This integration brings its targets into Gladys: each target
becomes a device with its median latency, packet loss, jitter and graph, scenes
react when a target becomes unreachable or degraded, and a dashboard widget
shows them all.

Gladys reads SmokePing: it does not ping your targets itself. Everything stays
on your network (no cloud).

Tested against a real SmokePing in Docker (SmokePing 2.9.0, image
`lscr.io/linuxserver/smokeping`): targets reachable, unreachable and with
packet loss caused on purpose. Feedback welcome on
[the issues](https://github.com/guim31/gladys-smokeping/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- SmokePing 2.7 or later, its web interface reachable from Gladys.
- One line in the configuration of its web server, so that Gladys can read
  the measurements (below). SmokePing has no API: its figures are only in its
  RRD files.

## Getting started

### 1. Serve the RRD files

SmokePing keeps one RRD file per target in its `data` folder. Serve this
folder read-only at `/smokeping-data/` on the same web server.

**Docker image `lscr.io/linuxserver/smokeping`**: create the file
`site-confs/gladys.conf` in the folder mounted on `/config`, then restart the
container:

```apache
Alias /smokeping-data /data
<Directory "/data">
    Options -Indexes
    Require all granted
</Directory>
```

**Debian or Ubuntu package (Apache)**: same lines with `/var/lib/smokeping`
instead of `/data`, in `/etc/apache2/conf-available/smokeping-data.conf`, then
`a2enconf smokeping-data` and reload Apache.

**Nginx**: `location /smokeping-data/ { alias /var/lib/smokeping/; }`.

Check it: `http://<your SmokePing>/smokeping-data/<Group>/<Target>.rrd` must
download a file. These files hold the same figures as the SmokePing page;
restrict them like it (`Require ip 192.168.1.0/24`, a login) if needed.

### 2. Configure the integration

In Gladys, open the integration and fill in:

- **SmokePing address**: the address of its web page, for example
  `http://192.168.1.2/smokeping/`, or of its `smokeping.cgi`
  (`http://192.168.1.2/cgi-bin/smokeping.cgi` with the Debian package).
- **RRD files address**: leave it empty if you followed step 1.
- **User** and **Password**: only if the web server asks for a login. They
  are never sent to an RRD files address on another server.
- **Packet loss threshold** (10 % by default) and **Latency threshold**
  (100 ms): beyond them, a target is degraded.
- **Measurements in a row**: how many SmokePing measurements in a row beyond
  a threshold, or with every ping lost, before an alert (2 by default).
  SmokePing measures every 5 minutes by default: 2 means 10 minutes.
- **Refresh interval**: 1 to 5 minutes (1 minute by default). A few small
  requests per target each time.
- **Graph period**: 3 hours, 30 hours or 10 days.
- **Language of the names**: language of the feature names and of the scene
  results (French by default).

Then click **Test the connection**: it reads SmokePing and counts the targets.

### 3. Add the targets

Open the **Discover** tab of the integration: one device per SmokePing
target, named as in its menu (the groups are not devices). Add the ones you
want to follow. The scene triggers and the widget work for every target,
added or not.

## The devices

Each target:

- **Reachable**: yes when at least one ping answered in the last measurement,
  no after the chosen number of measurements with every ping lost.
- **Median latency**: the median round trip time, in milliseconds.
- **Packet loss**: the share of pings lost, in percent.
- **Jitter**: the standard deviation of the round trip times, in
  milliseconds.
- **Last measurement**: when SmokePing last measured, in the time zone of
  Gladys.
- **SmokePing graph**: the SmokePing graph of the target, as a camera image,
  refreshed every 5 minutes and on demand.

The measurements are sent at most every 5 minutes, at once when the state
changes. A target SmokePing stopped measuring shows the unreachable badge and
sends nothing.

## Dashboard

The **SmokePing** widget shows three tiles (targets unreachable, degraded,
median latency) and one row per target, the unreachable and degraded ones
first, with their latency and loss. In its settings, choose a group, or
targets added to Gladys, and hide the tiles or the **Refresh** button. The
**Refresh** button reads SmokePing at once.

The dashboard **Camera** widget shows the graph of a target.

## Scenes

### Triggers

- **A target becomes unreachable**: every ping to a target is lost, as many
  measurements in a row as set. Variables: target name, group.
- **A target is reachable again**: an unreachable target answers again.
  Variables: target name, group, outage length in minutes.
- **Packet loss above the threshold**: the loss of a reachable target reaches
  the threshold, measurements in a row. Variables: target name, group, packet
  loss.
- **Latency above the threshold**: the median latency reaches the threshold,
  measurements in a row. Variables: target name, group, median latency.

All can be limited to some targets. No event is sent at the first reading:
only real changes. An alert fires again only after the value went back below
the threshold. A target that became unreachable while Gladys was restarting
is still announced, once.

### Actions

- **State of a target**: reachable or not, state in words, median latency,
  packet loss, jitter, and a ready-made sentence such as "Box: Reachable,
  23.4 ms, 12 % loss, jitter 3.1 ms".
- **Count the unreachable targets**: how many are unreachable, degraded and
  in total, on the server or in one group, and the names of the unreachable
  ones.

### Scene ideas

- **A target becomes unreachable** (your Internet box, 8.8.8.8) → a message,
  or restart the box with a smart plug.
- **Packet loss above the threshold** → a message with the loss, then the
  action "Send a camera image" with the SmokePing graph.
- Every morning, **Count the unreachable targets** → a message if more than
  zero.

To watch hosts without SmokePing, see
[gladys-ping-wol](https://github.com/guim31/gladys-ping-wol); for HTTP
services, [gladys-gatus](https://github.com/guim31/gladys-gatus).

## Troubleshooting

- **"SmokePing does not answer"**: check the address and the port from the
  machine of Gladys, and that a firewall does not block it.
- **"The RRD files are not served at the data address"**: step 1 is missing,
  or the address of the files differs: open
  `…/smokeping-data/<Group>/<Target>.rrd` in a browser.
- **"No SmokePing interface at this address"**: enter the address of the
  SmokePing page or of `smokeping.cgi`.
- **"The address redirects"**: enter the full address of `smokeping.cgi`,
  with `https://` if the server redirects to it.
- **"RRD file not understood"**: the files come from a machine the
  integration cannot read (big-endian, or 32-bit x86); tell us in the issues.
- **A target is missing**: it must be in the SmokePing menu (not hidden) and
  have an RRD file; click Search in the Discover tab after a change of the
  SmokePing configuration.

## Limits

- The measurements of the master SmokePing only, not of its slaves.
- Gladys reads the newest measurement: an outage shorter than one SmokePing
  step can be missed, like on its graphs.
- Targets with several hosts (multi-host graphs) have no file: not offered.
- The graph is sent as a PNG image; Gladys shows it, a channel that only
  takes JPEG images may not.
- Not affiliated with SmokePing or its authors.
