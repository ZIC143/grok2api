import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request


RESOURCE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,62}[A-Za-z0-9]$")


class WranglerCommandError(RuntimeError):
    """Raised when a Cloudflare API request fails."""


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


def get_api_base(account_id: str) -> str:
    return f"https://api.cloudflare.com/client/v4/accounts/{account_id}"


def call_cloudflare_api(
    account_id: str,
    api_token: str,
    method: str,
    path: str,
    payload: dict | None = None,
    query: dict[str, str] | None = None,
) -> dict:
    url = f"{get_api_base(account_id)}{path}"
    if query:
        url = f"{url}?{parse.urlencode(query)}"

    data = None
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise WranglerCommandError(
            f"Cloudflare API request failed: {method} {path}\n{body}"
        ) from exc
    except error.URLError as exc:
        raise WranglerCommandError(
            f"Cloudflare API request failed: {method} {path}\n{exc}"
        ) from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise WranglerCommandError(
            f"Cloudflare API returned non-JSON response for {method} {path}: {body}"
        ) from exc

    if not data.get("success", False):
        errors = data.get("errors") or []
        raise WranglerCommandError(
            f"Cloudflare API reported failure for {method} {path}: {errors}"
        )
    return data


def list_d1_databases(account_id: str, api_token: str) -> list[dict]:
    data = call_cloudflare_api(account_id, api_token, "GET", "/d1/database")
    return data.get("result", [])


def find_d1_id(account_id: str, api_token: str, name: str) -> str:
    for item in list_d1_databases(account_id, api_token):
        if item.get("name") == name:
            return item.get("uuid", "") or item.get("id", "")
    return ""


def create_d1(account_id: str, api_token: str, name: str) -> str:
    data = call_cloudflare_api(
        account_id,
        api_token,
        "POST",
        "/d1/database",
        payload={"name": name},
    )
    result = data.get("result", {})
    return result.get("uuid", "") or result.get("database_id", "") or result.get("id", "")


def list_kv_namespaces(account_id: str, api_token: str) -> list[dict]:
    namespaces: list[dict] = []
    page = 1
    while True:
        data = call_cloudflare_api(
            account_id,
            api_token,
            "GET",
            "/storage/kv/namespaces",
            query={"page": str(page), "per_page": "100"},
        )
        batch = data.get("result", [])
        namespaces.extend(batch)
        result_info = data.get("result_info", {})
        total_pages = int(result_info.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1
    return namespaces


def find_kv_id(account_id: str, api_token: str, name: str) -> str:
    for item in list_kv_namespaces(account_id, api_token):
        if item.get("title") == name:
            return item.get("id", "")
    return ""


def create_kv(account_id: str, api_token: str, name: str) -> str:
    data = call_cloudflare_api(
        account_id,
        api_token,
        "POST",
        "/storage/kv/namespaces",
        payload={"title": name},
    )
    result = data.get("result", {})
    return result.get("id", "")


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

        d1_id = find_d1_id(account_id, api_token, d1_name) or create_d1(account_id, api_token, d1_name)
        kv_id = find_kv_id(account_id, api_token, kv_name) or create_kv(account_id, api_token, kv_name)
    except (KeyError, ValueError, WranglerCommandError) as exc:
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
