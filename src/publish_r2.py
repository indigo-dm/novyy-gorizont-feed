from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


PROJECT_FILES = (
    "inventory.json",
    "settings.json",
    "status.json",
    "assets.json",
    "source-profitbase.xml",
    "avito.xml",
    "pilot-avito.xml",
)
MEDIA_FOLDERS = ("images", "previews", "thumbnails", "assets")


def require(value: str, name: str) -> str:
    if not value.strip():
        raise RuntimeError(f"{name} is required for R2 publishing")
    return value.strip()


def run(command: list[str], env: dict[str, str]) -> None:
    print("Running:", " ".join(command[:5]), "…")
    subprocess.run(command, check=True, env=env)


def common(aws: str) -> list[str]:
    return [aws, "s3"]


def sync_project_data(
    aws: str,
    endpoint: str,
    bucket: str,
    project_dir: Path,
    slug: str,
    env: dict[str, str],
) -> None:
    command = common(aws) + [
        "sync",
        str(project_dir),
        f"s3://{bucket}/published/projects/{slug}",
        "--exclude",
        "*",
    ]
    for filename in PROJECT_FILES:
        command.extend(["--include", filename])
    command.extend([
        "--delete",
        "--size-only",
        "--cache-control",
        "no-store, max-age=0",
        "--endpoint-url",
        endpoint,
        "--only-show-errors",
        "--no-progress",
    ])
    run(command, env)


def sync_project_media(
    aws: str,
    endpoint: str,
    bucket: str,
    project_dir: Path,
    slug: str,
    env: dict[str, str],
) -> None:
    missing = [folder for folder in MEDIA_FOLDERS if not (project_dir / folder).is_dir()]
    if missing:
        raise FileNotFoundError(f"Media folders are missing for {slug}: {', '.join(missing)}")
    command = common(aws) + [
        "sync",
        str(project_dir),
        f"s3://{bucket}/media/projects/{slug}",
        "--exclude",
        "*",
    ]
    for folder in MEDIA_FOLDERS:
        command.extend(["--include", f"{folder}/*"])
    command.extend([
        "--delete",
        "--size-only",
        "--cache-control",
        "public, max-age=300, must-revalidate",
        "--endpoint-url",
        endpoint,
        "--only-show-errors",
        "--no-progress",
    ])
    run(command, env)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--project")
    parser.add_argument("--data-only", action="store_true")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    registry_path = source / "projects.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    available = [str(item["slug"]) for item in registry.get("projects", []) if item.get("available")]
    selected = [args.project] if args.project else available
    unknown = [slug for slug in selected if slug not in available]
    if unknown:
        raise ValueError(f"Unavailable projects requested for R2 publishing: {', '.join(unknown)}")

    bucket = require(os.environ.get("R2_BUCKET", ""), "R2_BUCKET")
    account_id = require(os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""), "CLOUDFLARE_ACCOUNT_ID")
    endpoint = os.environ.get("R2_ENDPOINT", "").strip() or f"https://{account_id}.r2.cloudflarestorage.com"
    aws = os.environ.get("AWS_CLI", "aws").strip() or "aws"
    if shutil.which(aws) is None and not Path(aws).is_file():
        raise RuntimeError(f"AWS CLI is unavailable: {aws}")

    process_env = os.environ.copy()
    process_env["AWS_DEFAULT_REGION"] = "auto"
    process_env["AWS_EC2_METADATA_DISABLED"] = "true"

    for slug in selected:
        project_dir = source / "projects" / slug
        if not project_dir.is_dir():
            raise FileNotFoundError(f"Generated project directory is missing: {project_dir}")
        sync_project_data(aws, endpoint, bucket, project_dir, slug, process_env)
        if not args.data_only:
            sync_project_media(aws, endpoint, bucket, project_dir, slug, process_env)

    registry_command = common(aws) + [
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
    ]
    run(registry_command, process_env)
    print(json.dumps({
        "bucket": bucket,
        "projects": selected,
        "data_only": args.data_only,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
