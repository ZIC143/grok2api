import argparse
import json
from pathlib import Path


PLACEHOLDERS = {
    "__CF_WORKER_NAME__": lambda data: data["worker_name"],
    "__CF_D1_NAME__": lambda data: data["d1"]["name"],
    "__CF_D1_ID__": lambda data: data["d1"]["id"],
    "__CF_KV_ID__": lambda data: data["kv"]["id"],
    "__CF_ENVIRONMENT__": lambda data: data["environment"],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--resources", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    template_path = Path(args.template)
    resources_path = Path(args.resources)

    if not template_path.exists():
        raise SystemExit(f"Wrangler template not found: {template_path}")
    if not resources_path.exists():
        raise SystemExit(f"Resources file not found: {resources_path}")

    template = template_path.read_text(encoding="utf-8")
    data = json.loads(resources_path.read_text(encoding="utf-8"))

    rendered = template
    for placeholder, getter in PLACEHOLDERS.items():
        value = getter(data)
        if not value:
            raise SystemExit(f"Missing value for placeholder {placeholder}")
        rendered = rendered.replace(placeholder, value)

    unresolved = [key for key in PLACEHOLDERS if key in rendered]
    if unresolved:
        raise SystemExit(f"Unresolved placeholders remain: {', '.join(unresolved)}")

    Path(args.output).write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
