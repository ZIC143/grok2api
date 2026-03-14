import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


RESOURCE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,62}[A-Za-z0-9]$")


class WranglerCommandError(RuntimeError):
    """Raised when a Wrangler command fails."""


def validate_resource_name(value: str, label: str) -> str:
    if not value or not value.strip():
        raise ValueError(f"{label} must not be empty")
    normalized = value.strip()
    if len(normalized) < 3 or len(normalized) > 64:
        raise ValueError(f"{label} must be between 3 and 64 characters")
    if not RESOURCE_NAME_PATTERN.fullmatch(normalized):
        raise ValueError(
            f"{label} contains invalid characters: {normalized!r}. "
            "Use letters, numbers, dot, underscore or dash."
        )
    return normalized


def parse_json_output(output: str) -> list | dict:
    text = (output or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = min(
            [idx for idx in (text.find("{"), text.find("[")) if idx != -1],
            default=-1,
        )
        if start == -1:
            raise
        return json.loads(text[start:])


def run_wrangler(args: list[str]) -> str:
    env = os.environ.copy()
    env.setdefault("WRANGLER_LOG", "error")
    try:
        result = subprocess.run(
            ["wrangler", *args],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        detail = stderr or stdout or str(exc)
        raise WranglerCommandError(
            f"Wrangler command failed: wrangler {' '.join(args)}\n{detail}"
        ) from exc
    return result.stdout.strip()


def find_d1_id(name: str) -> str:
    output = run_wrangler(["d1", "list", "--json"])
    for item in parse_json_output(output) or []:
        if item.get("name") == name:
            return item.get("uuid", "") or item.get("id", "")
    return ""


def create_d1(name: str) -> str:
    output = run_wrangler(["d1", "create", name, "--json"])
    data = parse_json_output(output)
    if isinstance(data, dict):
        result = data.get("result", data)
        return result.get("uuid", "") or result.get("database_id", "") or result.get("id", "")
    return ""


def find_kv_id(name: str) -> str:
    output = run_wrangler(["kv", "namespace", "list", "--json"])
    for item in parse_json_output(output) or []:
        if item.get("title") == name:
            return item.get("id", "")
    return ""


def create_kv(name: str) -> str:
    output = run_wrangler(["kv", "namespace", "create", name, "--json"])
    data = parse_json_output(output)
    if isinstance(data, dict):
        if "id" in data:
            return data["id"]
        result = data.get("result", {})
        return result.get("id", "")
    return ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        worker_name = validate_resource_name(os.environ["CF_WORKER_NAME"], "CF_WORKER_NAME")
        d1_name = validate_resource_name(os.environ["CF_D1_NAME"], "CF_D1_NAME")
        kv_name = validate_resource_name(os.environ["CF_KV_NAME"], "CF_KV_NAME")
        environment = os.environ.get("CF_ENVIRONMENT", "production").strip() or "production"
        account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
        api_token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
        if not account_id:
            raise ValueError("CLOUDFLARE_ACCOUNT_ID must not be empty")
        if not api_token:
            raise ValueError("CLOUDFLARE_API_TOKEN must not be empty")

        d1_id = find_d1_id(d1_name) or create_d1(d1_name)
        kv_id = find_kv_id(kv_name) or create_kv(kv_name)
    except (KeyError, ValueError, WranglerCommandError, json.JSONDecodeError) as exc:
        print(f"Cloudflare resource preparation failed: {exc}", file=sys.stderr)
        return 1

    if not d1_id or not kv_id:
        print("Failed to resolve Cloudflare resources", file=sys.stderr)
        return 1

    payload = {
        "worker_name": worker_name,
        "environment": environment,
        "d1": {"name": d1_name, "id": d1_id},
        "kv": {"name": kv_name, "id": kv_id},
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
