from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".svg"}


def require(value: str, name: str) -> str:
    if not value.strip():
        raise RuntimeError(f"{name} is required for R2 publishing")
    return value.strip()


def run(command: list[str], env: dict[str, str]) -> None:
    print("Running:", " ".join(command[:5]), "…")
    subprocess.run(command, check=True, env=env)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    registry_path = source / "projects.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    known_projects = {str(item["slug"]) for item in registry.get("projects", [])}
    if args.project not in known_projects:
        raise ValueError(f"Unknown project requested for material publishing: {args.project}")

    assets_dir = source / "projects" / args.project / "assets"
    if not assets_dir.is_dir():
        raise FileNotFoundError(f"Project assets are missing: {assets_dir}")

    plan = {
        "project": args.project,
        "assets": sorted(
            path.relative_to(assets_dir).as_posix()
            for path in assets_dir.rglob("*")
            if path.is_file()
            and path.suffix.lower() in SUPPORTED_EXTENSIONS
            and path.relative_to(assets_dir).parts[0] != "uploads"
        ),
        "registry": str(registry_path),
    }
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return

    bucket = require(os.environ.get("R2_BUCKET", ""), "R2_BUCKET")
    account_id = require(os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""), "CLOUDFLARE_ACCOUNT_ID")
    endpoint = os.environ.get("R2_ENDPOINT", "").strip() or (
        f"https://{account_id}.r2.cloudflarestorage.com"
    )
    aws = os.environ.get("AWS_CLI", "aws").strip() or "aws"
    if shutil.which(aws) is None and not Path(aws).is_file():
        raise RuntimeError("AWS CLI is unavailable")

    process_env = os.environ.copy()
    process_env["AWS_DEFAULT_REGION"] = "auto"
    process_env["AWS_EC2_METADATA_DISABLED"] = "true"

    run([
        aws,
        "s3",
        "sync",
        str(assets_dir),
        f"s3://{bucket}/media/projects/{args.project}/assets",
        "--exclude",
        "*",
        "--include",
        "*.jpg",
        "--include",
        "*.jpeg",
        "--include",
        "*.png",
        "--include",
        "*.webp",
        "--include",
        "*.svg",
        "--exclude",
        "uploads/*",
        "--delete",
        "--size-only",
        "--cache-control",
        "public, max-age=300, must-revalidate",
        "--endpoint-url",
        endpoint,
        "--only-show-errors",
        "--no-progress",
    ], process_env)
    run([
        aws,
        "s3",
        "cp",
        str(registry_path),
        f"s3://{bucket}/published/projects.json",
        "--content-type",
        "application/json; charset=utf-8",
        "--cache-control",
        "no-store, max-age=0",
        "--endpoint-url",
        endpoint,
        "--only-show-errors",
        "--no-progress",
    ], process_env)
    print(json.dumps(plan, ensure_ascii=False))


if __name__ == "__main__":
    main()
