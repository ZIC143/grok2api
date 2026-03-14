import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resources", required=True)
    parser.add_argument("--worker-name", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--worker-url", required=False, default="")
    args = parser.parse_args()

    resources_path = Path(args.resources)
    if not resources_path.exists():
        raise SystemExit(f"Resources file not found: {resources_path}")

    data = json.loads(resources_path.read_text(encoding="utf-8"))
    worker_url = args.worker_url.strip() or f"https://{args.worker_name}.workers.dev"

    print("Deployment summary")
    print(f"- environment: {args.environment}")
    print(f"- worker: {args.worker_name}")
    print(f"- url: {worker_url}")
    print(f"- d1: {data['d1']['name']} ({data['d1']['id']})")
    print(f"- kv: {data['kv']['name']} ({data['kv']['id']})")
    print("- next check: open /health on the worker URL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
