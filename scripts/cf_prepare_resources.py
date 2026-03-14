import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run_wrangler(args: list[str]) -> str:
    env = os.environ.copy()
    env.setdefault("WRANGLER_LOG", "error")
    result = subprocess.run(
        ["wrangler", *args],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return result.stdout.strip()


def find_d1_id(name: str) -> str:
    output = run_wrangler(["d1", "list", "--json"])
    for item in json.loads(output or "[]"):
        if item.get("name") == name:
            return item.get("uuid", "")
    return ""


def create_d1(name: str) -> str:
    output = run_wrangler(["d1", "create", name, "--json"])
    data = json.loads(output or "{}")
    return data.get("uuid", "") or data.get("database_id", "")


def find_kv_id(name: str) -> str:
    output = run_wrangler(["kv", "namespace", "list", "--json"])
    for item in json.loads(output or "[]"):
        if item.get("title") == name:
            return item.get("id", "")
    return ""


def create_kv(name: str) -> str:
    output = run_wrangler(["kv", "namespace", "create", name, "--json"])
    data = json.loads(output or "{}")
    if "id" in data:
        return data["id"]
    result = data.get("result", {})
    return result.get("id", "")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    worker_name = os.environ["CF_WORKER_NAME"]
    d1_name = os.environ["CF_D1_NAME"]
    kv_name = os.environ["CF_KV_NAME"]
    environment = os.environ.get("CF_ENVIRONMENT", "production")

    d1_id = find_d1_id(d1_name) or create_d1(d1_name)
    kv_id = find_kv_id(kv_name) or create_kv(kv_name)

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
