# Tailscale for LG webOS TVs

> **Not affiliated with Tailscale.** This is an unofficial community app. It is not made, endorsed or
> supported by Tailscale Inc. "Tailscale" is a trademark of Tailscale Inc. The app downloads the
> official Tailscale builds from `pkgs.tailscale.com`; it does not include or change them.

A Homebrew Channel app for running [Tailscale](https://tailscale.com) on a rooted LG webOS TV. It
installs and updates the official Tailscale build, signs the TV in to your tailnet with a QR code,
brings it up and down, picks an exit node, and shows the devices on your tailnet and what Tailscale
is doing.

Looking for testers! Built on an LG OLED55BX6LB (webOS 5.4.3, 32-bit ARM) with Homebrew Channel
0.7.3. If you try it on another TV, send a report from the app's **Compatibility** box: it's
anonymous, and the results go in [COMPATIBILITY.md](COMPATIBILITY.md). The wiki's
[Privacy](https://github.com/haywirephoenix/webos-tailscale/wiki/Privacy) page says what a report holds.

## Install

Needs a rooted LG webOS TV with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)
and a Tailscale account.

1. In Homebrew Channel, open **Settings**, choose **Add repository** and enter
   `https://haywirephoenix.github.io/webos-homebrew/apps.json`.
2. Install **Tailscale** from the list of apps.
3. Open **Tailscale**, choose **Install Tailscale**, then **Log in** and scan the QR code with a
   phone signed in to Tailscale.

## Documentation

The [wiki](https://github.com/haywirephoenix/webos-tailscale/wiki) covers [installing](https://github.com/haywirephoenix/webos-tailscale/wiki/Installing), [using the app](https://github.com/haywirephoenix/webos-tailscale/wiki/Using-Tailscale),
[files and settings](https://github.com/haywirephoenix/webos-tailscale/wiki/Files-and-settings) (including start at boot),
[remote keys and scripts](https://github.com/haywirephoenix/webos-tailscale/wiki/Remote-keys-and-scripts), [privacy](https://github.com/haywirephoenix/webos-tailscale/wiki/Privacy),
[how it works](https://github.com/haywirephoenix/webos-tailscale/wiki/How-it-works), and [demo mode and building](https://github.com/haywirephoenix/webos-tailscale/wiki/For-developers).

## Build

```sh
python tools/build.py
```

## Licence

MIT, see [LICENSE](LICENSE).
