#!/usr/bin/env python3
"""Generate mandoc/roff man pages from Docs/command-catalog.json.

Usage (from repo root or Toggly.CLI):
  ./Toggly.CLI/scripts/generate-manpages.py
  ./Toggly.CLI/scripts/generate-manpages.py --check   # exit 1 if man/ drifts
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
CLI_ROOT = SCRIPT_DIR.parent
CATALOG_PATH = CLI_ROOT / "Docs" / "command-catalog.json"
MAN_DIR = CLI_ROOT / "man"


def path_key(path: list[str]) -> str:
    return " ".join(path)


def load_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def roff_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("-", "\\-")
        .replace(".", "\\&.")
    )


def write_section(lines: list[str], name: str, body_lines: list[str]) -> None:
    if not body_lines:
        return
    lines.append(f".SH {name}")
    lines.extend(body_lines)


def format_option_block(options: list[dict[str, str]] | None) -> list[str]:
    if not options:
        return []
    out: list[str] = []
    for opt in options:
        out.append(f".TP")
        out.append(f".B {roff_escape(opt['name'])}")
        out.append(roff_escape(opt["description"]))
    return out


def format_argument_block(arguments: list[dict[str, str]] | None) -> list[str]:
    if not arguments:
        return []
    out: list[str] = []
    for arg in arguments:
        out.append(".TP")
        out.append(f".I {roff_escape(arg['name'])}")
        out.append(roff_escape(arg["description"]))
    return out


def format_examples(examples: list[str] | None) -> list[str]:
    if not examples:
        return []
    out: list[str] = []
    for example in examples:
        out.append(".PP")
        out.append(f".B {roff_escape(example)}")
    return out


def format_see_also(refs: list[str] | None) -> list[str]:
    if not refs:
        return []
    rendered = []
    for ref in refs:
        if " " in ref:
            rendered.append(roff_escape(ref))
        else:
            page = ref if ref.startswith("toggly") else f"toggly-{ref}"
            if not page.endswith("(1)"):
                rendered.append(f"{roff_escape(page)}(1)")
            else:
                rendered.append(roff_escape(page))
    return [", ".join(rendered) + "."]


def format_exit_status(exit_codes: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for item in exit_codes:
        out.append(".TP")
        out.append(f".B {item['code']}")
        out.append(roff_escape(str(item["meaning"])))
    return out


def group_pages(catalog: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Map top-level noun name -> leaf entries under that noun (excluding flat aliases)."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for entry in catalog["commands"]:
        path = entry.get("path") or []
        if not path or entry.get("aliasOf") or len(path) == 1:
            if path and not entry.get("aliasOf") and len(path) == 1:
                groups.setdefault(path[0], [])
            continue
        groups.setdefault(path[0], []).append(entry)
    return groups


def render_root_page(catalog: dict[str, Any]) -> str:
    man = catalog["manName"]
    binary = catalog["binary"]
    lines = [
        f'.\\" Generated from Docs/command-catalog.json — do not edit by hand.',
        f'.\\" Regenerate: ./Toggly.CLI/scripts/generate-manpages.py',
        f".TH {man.upper()} 1 \"\" \"Toggly CLI\" \"User Commands\"",
        ".SH NAME",
        f"{man} \\- {roff_escape(catalog['description'].split('.')[0])}",
        ".SH SYNOPSIS",
        f".B {roff_escape(binary)}",
        "[\\fIoptions\\fR]",
        "\\fIcommand\\fR",
        "...",
        ".SH DESCRIPTION",
        roff_escape(catalog["description"]),
        f"Full documentation: {roff_escape(catalog['docsUrl'])}",
    ]

    write_section(lines, "GLOBAL OPTIONS", format_option_block(catalog.get("globals")))

    cmd_lines = [".PP", "Noun groups:"]
    for name in ("auth", "app", "env", "feature", "release", "context"):
        cmd_lines.append(".TP")
        cmd_lines.append(f".B {roff_escape(name)}")
        group = next(
            (c for c in catalog["commands"] if c.get("path") == [name]),
            None,
        )
        if group:
            cmd_lines.append(roff_escape(group["description"]))
    cmd_lines.append(".PP")
    cmd_lines.append(
        "Flat write aliases (deprecation window): "
        + roff_escape(
            "create-feature, update-feature, update-feature-environment, "
            "create-release, associate-build"
        )
        + "."
    )
    write_section(lines, "COMMANDS", cmd_lines)
    write_section(lines, "EXIT STATUS", format_exit_status(catalog["exitCodes"]))
    write_section(
        lines,
        "SEE ALSO",
        format_see_also(
            [
                "toggly-auth",
                "toggly-app",
                "toggly-env",
                "toggly-feature",
                "toggly-release",
                "toggly-context",
            ]
        ),
    )
    lines.append(".SH ONLINE DOCS")
    lines.append(roff_escape(catalog["docsUrl"]))
    return "\n".join(lines) + "\n"


def render_group_page(catalog: dict[str, Any], group_name: str, leaves: list[dict[str, Any]]) -> str:
    man = catalog["manName"]
    binary = catalog["binary"]
    group = next(c for c in catalog["commands"] if c.get("path") == [group_name])
    page = f"{man}-{group_name}"
    lines = [
        f'.\\" Generated from Docs/command-catalog.json — do not edit by hand.',
        f'.\\" Regenerate: ./Toggly.CLI/scripts/generate-manpages.py',
        f".TH {page.upper()} 1 \"\" \"Toggly CLI\" \"User Commands\"",
        ".SH NAME",
        f"{page} \\- {roff_escape(group['description'])}",
        ".SH SYNOPSIS",
        roff_escape(group.get("synopsis") or f"{binary} {group_name} <command>"),
        ".SH DESCRIPTION",
        roff_escape(group["description"]),
    ]

    for leaf in sorted(leaves, key=lambda e: path_key(e["path"])):
        sub = path_key(leaf["path"][1:])
        lines.append(".SH " + roff_escape(sub.upper().replace("-", " ")))
        lines.append(roff_escape(leaf["description"]))
        lines.append(".PP")
        lines.append(f".B {roff_escape(leaf.get('synopsis') or '')}")
        arg_block = format_argument_block(leaf.get("arguments"))
        if arg_block:
            lines.append(".PP")
            lines.append("Arguments:")
            lines.extend(arg_block)
        opt_block = format_option_block(leaf.get("options"))
        if opt_block:
            lines.append(".PP")
            lines.append("Options:")
            lines.extend(opt_block)
        examples = format_examples(leaf.get("examples"))
        if examples:
            lines.append(".PP")
            lines.append("Examples:")
            lines.extend(examples)
        aliases = leaf.get("aliases") or []
        if aliases:
            lines.append(".PP")
            lines.append("Aliases: " + roff_escape(", ".join(aliases)) + ".")

    write_section(lines, "GLOBAL OPTIONS", format_option_block(catalog.get("globals")))
    write_section(lines, "EXIT STATUS", format_exit_status(catalog["exitCodes"]))
    see = list(group.get("seeAlso") or [])
    see.append("toggly")
    write_section(lines, "SEE ALSO", format_see_also(see))
    lines.append(".SH ONLINE DOCS")
    lines.append(roff_escape(catalog["docsUrl"]))
    return "\n".join(lines) + "\n"


def generate() -> dict[str, str]:
    catalog = load_catalog()
    pages: dict[str, str] = {
        f"{catalog['manName']}.1": render_root_page(catalog),
    }
    for group_name, leaves in group_pages(catalog).items():
        pages[f"{catalog['manName']}-{group_name}.1"] = render_group_page(
            catalog, group_name, leaves
        )
    return pages


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed man/ matches generator output without writing",
    )
    args = parser.parse_args()

    if not CATALOG_PATH.is_file():
        print(f"Missing catalog: {CATALOG_PATH}", file=sys.stderr)
        return 1

    pages = generate()
    if args.check:
        drift = False
        for name, content in sorted(pages.items()):
            target = MAN_DIR / name
            if not target.is_file():
                print(f"missing: {target}", file=sys.stderr)
                drift = True
                continue
            existing = target.read_text(encoding="utf-8")
            if existing != content:
                print(f"drift: {target}", file=sys.stderr)
                drift = True
        expected = set(pages)
        for existing_file in MAN_DIR.glob("*.1"):
            if existing_file.name not in expected:
                print(f"unexpected: {existing_file}", file=sys.stderr)
                drift = True
        return 1 if drift else 0

    MAN_DIR.mkdir(parents=True, exist_ok=True)
    for name, content in pages.items():
        (MAN_DIR / name).write_text(content, encoding="utf-8")
        print(f"wrote {MAN_DIR / name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
