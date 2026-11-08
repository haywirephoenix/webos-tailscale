#!/usr/bin/env python3
"""Build dist/com.homebrew.tailscalectl_<version>_all.ipk and its release manifest.

Needs only Python 3. Usage: tools/build.py [--out dist]

The manifest's checksum is of this build, so publish the IPK of the same run. The Homebrew Channel
listing that points at the release is in https://github.com/haywirephoenix/webos-homebrew.
"""
import argparse
import hashlib
import io
import json
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = "com.homebrew.tailscalectl"
REPOSITORY = "https://github.com/haywirephoenix/webos-tailscale"
ICON = "https://raw.githubusercontent.com/haywirephoenix/webos-tailscale/main/tailscale-ctl/largeIcon.png"
SUMMARY = "Install, update and run Tailscale on a rooted TV, with a status page and console"
SKIP = {"README.md"}
EXECUTABLE = {"ctl.sh"}


def tgz(files):
    """A gzip tar of (path, bytes, mode), with its directories."""
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        dirs = set()
        for name, data, mode in files:
            parts = name.split("/")[:-1]
            for i in range(1, len(parts) + 1):
                d = "/".join(parts[:i])
                if d not in dirs:
                    dirs.add(d)
                    info = tarfile.TarInfo("./" + d)
                    info.type, info.mode, info.mtime = tarfile.DIRTYPE, 0o755, now
                    tar.addfile(info)
            info = tarfile.TarInfo("./" + name)
            info.size, info.mode, info.mtime = len(data), mode, now
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    out = b"!<arch>\n"
    for name, data in members:
        header = name.ljust(16) + "0".ljust(12) + "0".ljust(6) + "0".ljust(6) + "100644".ljust(8) + str(len(data)).ljust(10) + "`\n"
        out += header.encode() + data + (b"\n" if len(data) % 2 else b"")
    return out


def app_files():
    """(path in the app, bytes, mode) for the app's files. Text is packed with LF."""
    files = []
    base = ROOT / "tailscale-ctl"
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base).as_posix()
        if p.is_file() and rel not in SKIP:
            data = p.read_bytes()
            if p.suffix != ".png":
                data = data.replace(b"\r\n", b"\n")
            files.append((rel, data, 0o755 if rel in EXECUTABLE else 0o644))
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "dist"))
    args = parser.parse_args()
    info = json.loads((ROOT / "tailscale-ctl/appinfo.json").read_text())
    version = info["version"]
    prefix = "usr/palm/applications/%s/" % APP
    data = [(prefix + n, d, m) for n, d, m in app_files()]
    data.append(("usr/palm/packages/%s/packageinfo.json" % APP,
                 json.dumps({"id": APP, "version": version, "app": APP}, indent=1).encode(), 0o644))
    size = sum(len(f[1]) for f in data)
    control = ("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\n"
               "Maintainer: haywire\nDescription: %s\n" % (APP, version, size, SUMMARY)).encode()
    ipk = ar([("debian-binary", b"2.0\n"), ("control.tar.gz", tgz([("control", control, 0o644)])), ("data.tar.gz", tgz(data))])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    target = out / ("%s_%s_all.ipk" % (APP, version))
    target.write_bytes(ipk)
    manifest = {"id": APP, "version": version, "type": "web", "title": info["title"], "appDescription": SUMMARY,
                "iconUri": ICON, "sourceUrl": REPOSITORY, "rootRequired": True,
                "ipkUrl": "%s/releases/download/v%s/%s" % (REPOSITORY, version, target.name),
                "ipkHash": {"sha256": hashlib.sha256(ipk).hexdigest()}}
    (out / (APP + ".manifest.json")).write_bytes((json.dumps(manifest, indent=2) + "\n").encode())
    print("%s: %d bytes, sha256 %s" % (target, len(ipk), manifest["ipkHash"]["sha256"]))


if __name__ == "__main__":
    main()
