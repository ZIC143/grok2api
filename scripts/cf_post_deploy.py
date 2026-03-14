import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resources", required=True)
    parser.add_argument("--worker-name", required=True)
    parser.add_argument("--environment", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.resources).read_text(encoding="utf-8"))
    worker_url = f"https://{args.worker_name}.workers.dev"

    print("Deployment summary")
    print(f"- environment: {args.environment}")
    print(f"- worker: {args.worker_name}")
    print(f"- url: {worker_url}")
    print(f"- d1: {data['d1']['name']} ({data['d1']['id']})")
    print(f"- kv: {data['kv']['name']} ({data['kv']['id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
