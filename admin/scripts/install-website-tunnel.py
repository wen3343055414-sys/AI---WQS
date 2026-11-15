"""Install a checksum-verified official cloudflared binary in a stable admin home.

No service, firewall, account, credentials or public tunnel is created by this script.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request


API = "https://api.github.com/repos/cloudflare/cloudflared/releases/"
DOWNLOAD = "https://github.com/cloudflare/cloudflared/releases/download/"
MAX_DOWNLOAD = 200 * 1024 * 1024
RELEASE_VERSION = re.compile(r"\d{4}\.\d{1,2}\.\d{1,3}")
SHA256 = re.compile(r"[a-f0-9]{64}")
DOWNLOAD_HOSTS = {"api.github.com", "github.com", "release-assets.githubusercontent.com",
                  "objects.githubusercontent.com", "github-releases.githubusercontent.com"}


class InstallError(Exception):
    pass


class OfficialRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        url = urllib.parse.urlsplit(new_url)
        if url.scheme != "https" or url.hostname not in DOWNLOAD_HOSTS or url.username or url.password:
            raise InstallError("The official release redirected to an unexpected download host.")
        return super().redirect_request(request, file, code, message, headers, new_url)


def official_open(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in DOWNLOAD_HOSTS:
        raise InstallError("An official HTTPS release URL is required.")
    request = urllib.request.Request(url, headers={"User-Agent": "AI-WQS-Website-Tunnel-Installer",
                                                  "Accept": "application/vnd.github+json"})
    try:
        return urllib.request.build_opener(OfficialRedirects()).open(request, timeout=40)
    except urllib.error.HTTPError as error:
        raise InstallError(f"Official release download failed (HTTP {error.code}).") from None
    except (urllib.error.URLError, TimeoutError):
        raise InstallError("The official release could not be reached; check the network and retry.") from None


def target_asset(system=None, machine=None):
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    architectures = {"amd64": "amd64", "x86_64": "amd64", "x86": "386", "i386": "386",
                     "i686": "386", "aarch64": "arm64", "arm64": "arm64", "armv7l": "arm"}
    architecture = architectures.get(machine)
    if system == "Windows" and architecture in {"amd64", "386"}:
        return f"cloudflared-windows-{architecture}.exe", "cloudflared.exe"
    if system == "Linux" and architecture:
        return f"cloudflared-linux-{architecture}", "cloudflared"
    raise InstallError("This installer supports official Windows x64/x86 and Linux binaries only.")


def stable_home(value):
    root = Path(value).expanduser()
    if not root.is_absolute():
        raise InstallError("--root must be an absolute path to the installed admin home.")
    root = root.resolve()
    if any((ancestor / ".git").exists() for ancestor in (root, *root.parents)):
        raise InstallError("Use the stable installed admin home, not a Git checkout.")
    if any(part.lower() in {"releases", "integrated"} for part in root.parts):
        raise InstallError("Do not install tools in an immutable release directory.")
    try:
        config = json.loads((root / "config.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raise InstallError("The installed admin home must contain its existing config.json.") from None
    if not isinstance(config, dict) or type(config.get("port")) is not int or not 1024 <= config["port"] <= 65535:
        raise InstallError("The installed admin home has no valid administration port.")
    tools = (root / "tools").resolve()
    if not tools.is_relative_to(root):
        raise InstallError("The tools directory must remain inside the installed admin home.")
    return root, tools


def release_asset(release, asset_name):
    version = release.get("tag_name", "")
    if not isinstance(version, str) or not RELEASE_VERSION.fullmatch(version) or release.get("draft") or release.get("prerelease"):
        raise InstallError("The official response did not identify a stable cloudflared release.")
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise InstallError("The official release has no asset catalog.")
    matching = [item for item in assets if isinstance(item, dict) and item.get("name") == asset_name]
    if len(matching) != 1:
        raise InstallError("The official release has no unique binary for this platform.")
    asset = matching[0]
    url = DOWNLOAD + version + "/" + asset_name
    if asset.get("browser_download_url") != url:
        raise InstallError("The binary download URL did not match the official release.")
    size = asset.get("size")
    if type(size) is not int or not 0 < size <= MAX_DOWNLOAD:
        raise InstallError("The official binary has an invalid or excessive size.")
    digest = asset.get("digest")
    digest = digest.removeprefix("sha256:") if isinstance(digest, str) and digest.startswith("sha256:") else None
    if digest is not None and not SHA256.fullmatch(digest):
        raise InstallError("The official asset checksum is invalid.")
    body = release.get("body", "")
    documented = re.search(r"^" + re.escape(asset_name) + r":\s*([a-f0-9]{64})\s*$", body if isinstance(body, str) else "", re.MULTILINE)
    documented = documented.group(1) if documented else None
    if digest and documented and digest != documented:
        raise InstallError("The official checksum declarations disagree; installation was refused.")
    digest = digest or documented
    if not digest:
        raise InstallError("The official release supplies no SHA256 checksum; installation was refused.")
    return {"version": version, "asset": asset_name, "url": url, "size": size, "sha256": digest}


def file_digest(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_binary(metadata, output):
    digest = hashlib.sha256()
    total = 0
    with official_open(metadata["url"]) as response, output.open("wb") as stream:
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > metadata["size"] or total > MAX_DOWNLOAD:
                raise InstallError("The binary exceeded its declared size; installation was refused.")
            digest.update(chunk)
            stream.write(chunk)
    if total != metadata["size"] or digest.hexdigest() != metadata["sha256"]:
        raise InstallError("Binary size or SHA256 verification failed; installation was refused.")
    output.chmod(0o700)


def atomic_json(file, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=file.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, file)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def install(root, version=None):
    root, tools = stable_home(root)
    asset_name, executable_name = target_asset()
    if version is not None and not RELEASE_VERSION.fullmatch(version):
        raise InstallError("--version must use the official YYYY.M.N release format.")
    with official_open(API + ("tags/" + version if version else "latest")) as response:
        payload = response.read(4 * 1024 * 1024 + 1)
    if len(payload) > 4 * 1024 * 1024:
        raise InstallError("The official release response was too large.")
    try:
        release = json.loads(payload)
    except ValueError:
        raise InstallError("The official release response was not valid JSON.") from None
    if not isinstance(release, dict) or version and release.get("tag_name") != version:
        raise InstallError("The official release did not match the requested version.")
    metadata = release_asset(release, asset_name)
    tools.mkdir(mode=0o700, parents=True, exist_ok=True)
    executable = tools / executable_name
    if executable.is_symlink():
        raise InstallError("The installed executable must not be a symbolic link.")
    if executable.is_file() and file_digest(executable) == metadata["sha256"]:
        return {"status": "already-installed", "version": metadata["version"], "executable": str(executable), "sha256": metadata["sha256"]}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix="cloudflared-", dir=tools, delete=False) as stream:
            temporary = Path(stream.name)
        download_binary(metadata, temporary)
        os.replace(temporary, executable)
        atomic_json(tools / "cloudflared-install.json", {"schemaVersion": 1, "version": metadata["version"],
                                                       "asset": metadata["asset"], "sha256": metadata["sha256"]})
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {"status": "installed", "version": metadata["version"], "executable": str(executable), "sha256": metadata["sha256"]}


def main():
    parser = argparse.ArgumentParser(description="Install the official SHA256-verified website public tunnel binary.")
    parser.add_argument("--root", required=True, help="Absolute stable installed admin home (contains config.json).")
    parser.add_argument("--version", help="Optional exact official release, for example 2026.10.7; defaults to latest stable.")
    arguments = parser.parse_args()
    try:
        print(json.dumps(install(arguments.root, arguments.version), ensure_ascii=False))
    except InstallError as error:
        print(f"Installation failed: {error}", file=sys.stderr)
        return 1
    except (OSError, TimeoutError):
        print("Installation failed: could not read, download or replace the binary. Stop the public tunnel and retry.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
