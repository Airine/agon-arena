from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
import venv
from pathlib import Path
from typing import Any, Dict, Tuple


DEFAULT_MANIFEST_URL = "http://agon.win/.well-known/agon-agent/manifest.json"
DEFAULT_STATE_DIR = "./.agon-agent"


def ensure_python_version() -> None:
    if sys.version_info < (3, 10):
        raise SystemExit("Agon hosted skill requires Python 3.10+")


def fetch_json(url: str) -> Dict[str, Any]:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def download_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode("utf-8")


def sync_bundle(manifest_url: str, state_dir: str) -> Tuple[Dict[str, Any], Path]:
    manifest = fetch_json(manifest_url)
    download_root = Path(state_dir).resolve() / "downloaded"
    download_root.mkdir(parents=True, exist_ok=True)

    scripts = manifest["scripts"]
    root_url = scripts["root"].rstrip("/")
    for relative_path in scripts["files"]:
        content = download_text(root_url + "/" + relative_path)
        destination = download_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")

    return manifest, download_root


def virtualenv_python(venv_dir: Path) -> Path:
    posix_path = venv_dir / "bin" / "python"
    if posix_path.exists():
        return posix_path
    return venv_dir / "Scripts" / "python.exe"


def ensure_venv(state_dir: str, download_root: Path) -> Path:
    venv_dir = Path(state_dir).resolve() / "venv"
    requirements_path = download_root / "requirements.txt"
    fallback = os.environ.get("AGON_HOSTED_SKILL_USE_CURRENT_PYTHON") == "1"

    if not fallback:
        try:
            if not venv_dir.exists():
                venv.EnvBuilder(with_pip=True).create(venv_dir)
            python_bin = virtualenv_python(venv_dir)
            requirements_hash = hashlib.sha256(requirements_path.read_bytes()).hexdigest()
            stamp_path = venv_dir / ".requirements.sha256"

            if not stamp_path.exists() or stamp_path.read_text(encoding="utf-8").strip() != requirements_hash:
                subprocess.run(
                    [str(python_bin), "-m", "pip", "install", "-r", str(requirements_path)],
                    check=True,
                )
                stamp_path.write_text(requirements_hash + "\n", encoding="utf-8")
            return python_bin
        except Exception:
            fallback = True

    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements_path)], check=True)
    except subprocess.CalledProcessError:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--break-system-packages", "-r", str(requirements_path)],
            check=True,
        )
    return Path(sys.executable)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    parser.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
    args = parser.parse_args()

    ensure_python_version()
    manifest, download_root = sync_bundle(args.manifest_url, args.state_dir)
    python_bin = ensure_venv(args.state_dir, download_root)

    print(
        json.dumps(
            {
                "manifest_url": args.manifest_url,
                "api_base": manifest["apiBase"],
                "state_dir": str(Path(args.state_dir).resolve()),
                "download_root": str(download_root),
                "python": str(python_bin),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
