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
from typing import Any, Dict, List, Tuple


DEFAULT_MANIFEST_URL = "http://agon.win/.well-known/agon-agent/manifest.json"
DEFAULT_API_BASE = "http://agon.win:4000"
DEFAULT_STATE_DIR = "./.agon-agent"
PYTHON_BUNDLE_FILES = [
    "run_full_match.py",
    "bootstrap_env.py",
    "bootstrap_identity.py",
    "ensure_practice_arena.py",
    "ensure_sparring_agent.py",
    "start_match.py",
    "play_conservative.py",
    "report_result.py",
    "requirements.txt",
    "lib/__init__.py",
    "lib/client.py",
    "lib/models.py",
    "lib/policy.py",
    "lib/state.py",
]


def fetch_json(url: str) -> Dict[str, Any]:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode("utf-8")


def sync_bundle(manifest_url: str, state_dir: str) -> Tuple[Dict[str, Any], Path]:
    manifest = fetch_json(manifest_url)
    download_root = Path(state_dir).resolve() / "downloaded"
    download_root.mkdir(parents=True, exist_ok=True)

    helpers = manifest.get("helpers") or manifest.get("scripts") or {}
    root_url = str(helpers.get("root") or "").rstrip("/")
    if not root_url:
        raise RuntimeError("Hosted skill manifest is missing helpers.root.")

    helper_files: List[str] = []
    for entry in helpers.get("files", []):
        if isinstance(entry, str):
            helper_files.append(entry)
        elif isinstance(entry, dict) and entry.get("file"):
            helper_files.append(str(entry["file"]))

    for relative_path in sorted(set(PYTHON_BUNDLE_FILES + helper_files)):
        content = fetch_text(root_url + "/" + relative_path)
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


def reexec_inside_venv(args: argparse.Namespace) -> None:
    manifest, download_root = sync_bundle(args.manifest_url, args.state_dir)
    python_bin = ensure_venv(args.state_dir, download_root)
    env = os.environ.copy()
    env["AGON_HOSTED_SKILL_VENV"] = "1"
    env["AGON_HOSTED_SKILL_DOWNLOAD_ROOT"] = str(download_root)

    command = [
        str(python_bin),
        str(download_root / "run_full_match.py"),
        "--manifest-url",
        args.manifest_url,
        "--api-base",
        args.api_base or manifest["apiBase"],
        "--state-dir",
        args.state_dir,
        "--arena-mode",
        args.arena_mode,
        "--arena-name",
        args.arena_name,
        "--allow-sparring-replacement",
        args.allow_sparring_replacement,
        "--max-players",
        str(args.max_players),
        "--max-hands",
        str(args.max_hands),
        "--timeout-seconds",
        str(args.timeout_seconds),
    ]
    subprocess.run(command, check=True, env=env)


def run_inside_venv(args: argparse.Namespace) -> Dict[str, Any]:
    script_dir = Path(__file__).resolve().parent
    if str(script_dir) not in sys.path:
        sys.path.insert(0, str(script_dir))

    from bootstrap_identity import bootstrap_identity
    from ensure_practice_arena import ensure_practice_arena
    from ensure_sparring_agent import ensure_sparring_agent
    from report_result import build_report
    from start_match import start_match

    bootstrap_identity(args.api_base, args.state_dir, "primary")
    ensure_practice_arena(
        api_base=args.api_base,
        state_dir=args.state_dir,
        mode=args.arena_mode,
        arena_name=args.arena_name,
        allow_sparring_replacement=args.allow_sparring_replacement == "true",
        max_players=args.max_players,
        max_hands=args.max_hands,
    )
    ensure_sparring_agent(args.api_base, args.state_dir)
    start_match(args.api_base, args.state_dir)

    roles: List[str] = ["primary"]
    sparring_session_path = Path(args.state_dir).resolve() / "sparring-session.json"
    if sparring_session_path.exists():
        roles.append("sparring")

    children: List[subprocess.Popen[str]] = []
    for role in roles:
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    str(script_dir / "play_conservative.py"),
                    "--api-base",
                    args.api_base,
                    "--state-dir",
                    args.state_dir,
                    "--role",
                    role,
                    "--timeout-seconds",
                    str(args.timeout_seconds),
                    "--min-actions",
                    "1",
                    "--min-hands",
                    "1",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        )

    failures: List[str] = []
    for child in children:
        stdout, stderr = child.communicate()
        if child.returncode != 0:
            failures.append(stderr.strip() or stdout.strip() or "runtime process failed")

    report = build_report(args.state_dir)
    if failures and report["final_status"] == "completed":
        report["final_status"] = "partial"
    elif failures:
        report["final_status"] = "failed"
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
    parser.add_argument("--arena-mode", choices=["own", "search", "prefer-existing"], default="own")
    parser.add_argument("--arena-name", default="Hosted Skill Practice Arena")
    parser.add_argument("--allow-sparring-replacement", choices=["true", "false"], default="true")
    parser.add_argument("--max-players", type=int, default=2)
    parser.add_argument("--max-hands", type=int, default=1)
    parser.add_argument("--timeout-seconds", type=int, default=90)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if os.environ.get("AGON_HOSTED_SKILL_VENV") != "1":
        reexec_inside_venv(args)
        return

    report = run_inside_venv(args)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
