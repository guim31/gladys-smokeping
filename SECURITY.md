# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **user and password** of the web server of SmokePing (optional),
  stored by Gladys in the integration configuration (never written to
  `/data`, never logged); they are only sent, in the `Authorization` header,
  to the addresses configured (the web interface and the RRD files), and
  redirects are not followed so they never reach another host;
- `/data/smokeping-state.json`: the last state and alerts of each target
  and since when (no secret);
- network: HTTP(S) GET requests to the SmokePing web interface and to the
  folder of its RRD files, nothing else; no port is opened. The RRD files are
  parsed as untrusted input (sizes and layout checked before any read).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
SmokePing itself, and the exposure of its RRD files by its web server (the
setup guide suggests restricting it like the SmokePing page).
