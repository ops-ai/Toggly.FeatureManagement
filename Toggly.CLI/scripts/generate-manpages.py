#!/usr/bin/env python3
"""Generate mandoc/roff man pages from Docs/command-catalog.json.

Usage (from repo root or Toggly.CLI):
  ./Toggly.CLI/scripts/generate-manpages.py
  ./Toggly.CLI/scripts/generate-manpages.py --check   # drift + structural lint
  ./Toggly.CLI/scripts/generate-manpages.py --lint    # mandoc -Tlint when available
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
CLI_ROOT = SCRIPT_DIR.parent
CATALOG_PATH = CLI_ROOT / "Docs" / "command-catalog.json"
MAN_DIR = CLI_ROOT / "man"
# mandoc STYLE: input text line longer than 80 bytes
MAX_LINE = 78


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


def wrap_text(text: str, width: int = MAX_LINE) -> list[str]:
    """Word-wrap plain (already escaped) text to mandoc's 80-byte STYLE limit."""
    if not text:
        return []
    if len(text) <= width:
        return [text]
    return textwrap.wrap(
        text,
        width=width,
        break_long_words=True,
        break_on_hyphens=False,
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
        out.append(".TP")
        out.append(f".B {roff_escape(opt['name'])}")
        out.extend(wrap_text(roff_escape(opt["description"])))
    return out


def format_argument_block(arguments: list[dict[str, str]] | None) -> list[str]:
    if not arguments:
        return []
    out: list[str] = []
    for arg in arguments:
        out.append(".TP")
        out.append(f".I {roff_escape(arg['name'])}")
        out.extend(wrap_text(roff_escape(arg["description"])))
    return out


def format_examples(examples: list[str] | None) -> list[str]:
    if not examples:
        return []
    out: list[str] = []
    bold_prefix = ".B "
    # Leave room for the ".B " prefix so wrapped lines stay within mandoc STYLE.
    wrap_width = MAX_LINE - len(bold_prefix)
    for index, example in enumerate(examples):
        if index > 0:
            out.append(".PP")
        # Bold every wrapped line: a lone ".B" only bolds the next input line.
        escaped = roff_escape(example)
        if len(bold_prefix + escaped) <= MAX_LINE:
            out.append(bold_prefix + escaped)
        else:
            for line in wrap_text(escaped, width=wrap_width):
                out.append(bold_prefix + line)
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
    return wrap_text(", ".join(rendered) + ".")


def format_exit_status(exit_codes: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for item in exit_codes:
        out.append(".TP")
        out.append(f".B {item['code']}")
        out.extend(wrap_text(roff_escape(str(item["meaning"]))))
    return out


def man_date(catalog: dict[str, Any]) -> str:
    return str(catalog.get("manDate") or "2026-09-29")


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


def assert_no_bare_ellipsis(content: str, name: str) -> list[str]:
    """Lines that are exactly '...' are parsed as unknown mandoc macros."""
    problems: list[str] = []
    for idx, line in enumerate(content.splitlines(), start=1):
        if line.strip() == "...":
            problems.append(f"{name}:{idx}: bare ellipsis line (use \\&...)")
    return problems


def assert_no_empty_bold(content: str, name: str) -> list[str]:
    """A lone '.B' only bolds the next input line — reject empty bold macros."""
    problems: list[str] = []
    for idx, line in enumerate(content.splitlines(), start=1):
        if line.strip() == ".B":
            problems.append(f"{name}:{idx}: empty .B macro (provide bold text on the same line)")
    return problems


def assert_required_sections(content: str, name: str) -> list[str]:
    problems: list[str] = []
    for section in ("NAME", "SYNOPSIS", "DESCRIPTION", "OPTIONS", "EXAMPLES", "EXIT STATUS", "SEE ALSO"):
        if f".SH {section}" not in content:
            problems.append(f"{name}: missing .SH {section}")
    return problems


def structural_lint(pages: dict[str, str]) -> list[str]:
    problems: list[str] = []
    for name, content in sorted(pages.items()):
        problems.extend(assert_no_bare_ellipsis(content, name))
        problems.extend(assert_no_empty_bold(content, name))
        problems.extend(assert_required_sections(content, name))
    return problems


def run_mandoc_lint(pages: dict[str, str] | None = None) -> int:
    """Run mandoc -Tlint on man pages. Returns process exit code (0 = clean)."""
    mandoc = shutil.which("mandoc")
    if mandoc is None:
        print("mandoc not installed; skipping mandoc -Tlint", file=sys.stderr)
        return 0

    targets = sorted((MAN_DIR / name) for name in (pages or {}).keys()) if pages else sorted(MAN_DIR.glob("*.1"))
    if pages:
        # Lint the in-memory content via temp? Prefer committed files after write.
        targets = [MAN_DIR / name for name in sorted(pages.keys())]

    worst = 0
    for target in targets:
        if not target.is_file():
            print(f"missing for mandoc lint: {target}", file=sys.stderr)
            worst = max(worst, 1)
            continue
        result = subprocess.run(
            [mandoc, "-Tlint", str(target)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.stdout:
            sys.stdout.write(result.stdout)
        if result.stderr:
            sys.stderr.write(result.stderr)
        worst = max(worst, result.returncode)
    return worst


def render_root_page(catalog: dict[str, Any]) -> str:
    man = catalog["manName"]
    binary = catalog["binary"]
    date = man_date(catalog)
    lines = [
        f'.\\" Generated from Docs/command-catalog.json — do not edit by hand.',
        f'.\\" Regenerate: ./Toggly.CLI/scripts/generate-manpages.py',
        f'.TH {man.upper()} 1 "{date}" "Toggly CLI" "User Commands"',
        ".SH NAME",
        f"{man} \\- {roff_escape(catalog['description'].split('.')[0])}",
        ".SH SYNOPSIS",
        f".B {roff_escape(binary)}",
        "[\\fIoptions\\fR]",
        "\\fIcommand\\fR",
        "\\&...",
        ".SH DESCRIPTION",
    ]
    lines.extend(wrap_text(roff_escape(catalog["description"])))
    lines.extend(wrap_text(f"Full documentation: {roff_escape(catalog['docsUrl'])}"))

    cmd_lines: list[str] = ["Noun groups:"]
    for name in ("auth", "app", "env", "feature", "release", "context"):
        cmd_lines.append(".TP")
        cmd_lines.append(f".B {roff_escape(name)}")
        group = next(
            (c for c in catalog["commands"] if c.get("path") == [name]),
            None,
        )
        if group:
            cmd_lines.extend(wrap_text(roff_escape(group["description"])))
    cmd_lines.append(".PP")
    cmd_lines.extend(
        wrap_text(
            "Flat write aliases (deprecation window): "
            + roff_escape(
                "create-feature, update-feature, update-feature-environment, "
                "create-release, associate-build"
            )
            + "."
        )
    )
    write_section(lines, "COMMANDS", cmd_lines)

    write_section(lines, "OPTIONS", format_option_block(catalog.get("globals")))

    root_examples = [
        f"{binary} auth login",
        f"{binary} context set --app <app-id> --env Production",
        f"{binary} app list",
        f"{binary} --json feature list",
    ]
    write_section(lines, "EXAMPLES", format_examples(root_examples))
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
    lines.extend(wrap_text(roff_escape(catalog["docsUrl"])))
    return "\n".join(lines) + "\n"


def render_group_page(catalog: dict[str, Any], group_name: str, leaves: list[dict[str, Any]]) -> str:
    man = catalog["manName"]
    binary = catalog["binary"]
    group = next(
        (c for c in catalog["commands"] if c.get("path") == [group_name]),
        None,
    )
    if group is None:
        raise ValueError(
            f"command-catalog.json missing noun group entry for path [{group_name}]"
        )
    page = f"{man}-{group_name}"
    date = man_date(catalog)
    sorted_leaves = sorted(leaves, key=lambda e: path_key(e["path"]))

    lines = [
        f'.\\" Generated from Docs/command-catalog.json — do not edit by hand.',
        f'.\\" Regenerate: ./Toggly.CLI/scripts/generate-manpages.py',
        f'.TH {page.upper()} 1 "{date}" "Toggly CLI" "User Commands"',
        ".SH NAME",
        f"{page} \\- {roff_escape(group['description'])}",
        ".SH SYNOPSIS",
        roff_escape(group.get("synopsis") or f"{binary} {group_name} <command>"),
        ".SH DESCRIPTION",
    ]
    lines.extend(wrap_text(roff_escape(group["description"])))

    for leaf in sorted_leaves:
        sub = path_key(leaf["path"][1:])
        lines.append(f".SS {roff_escape(sub)}")
        lines.extend(wrap_text(roff_escape(leaf["description"])))
        synopsis = (leaf.get("synopsis") or "").strip()
        if synopsis:
            # Skip empty synopsis: a lone ".B" bolds the following block incorrectly.
            lines.append(".PP")
            lines.append(f".B {roff_escape(synopsis)}")
        arg_block = format_argument_block(leaf.get("arguments"))
        if arg_block:
            lines.extend(arg_block)
        aliases = leaf.get("aliases") or []
        if aliases:
            lines.append(".PP")
            lines.extend(wrap_text("Aliases: " + roff_escape(", ".join(aliases)) + "."))

    # Aggregate OPTIONS: leaf options (tagged) then globals — never lead with .PP after .SH
    option_body: list[str] = []
    for leaf in sorted_leaves:
        opts = leaf.get("options") or []
        if not opts:
            continue
        sub = path_key(leaf["path"])
        if option_body:
            option_body.append(".PP")
        option_body.extend(wrap_text(f"Options for {roff_escape(sub)}:"))
        option_body.extend(format_option_block(opts))
    if option_body:
        option_body.append(".PP")
    option_body.extend(wrap_text("Global options (all commands):"))
    option_body.extend(format_option_block(catalog.get("globals")))
    write_section(lines, "OPTIONS", option_body)

    example_body: list[str] = []
    for leaf in sorted_leaves:
        ex = leaf.get("examples") or []
        if not ex:
            continue
        if example_body:
            example_body.append(".PP")
        example_body.extend(format_examples(ex))
    if not example_body:
        example_body = format_examples([f"{binary} {group_name} --help"])
    write_section(lines, "EXAMPLES", example_body)

    write_section(lines, "EXIT STATUS", format_exit_status(catalog["exitCodes"]))
    see = list(group.get("seeAlso") or [])
    see.append("toggly")
    write_section(lines, "SEE ALSO", format_see_also(see))
    lines.append(".SH ONLINE DOCS")
    lines.extend(wrap_text(roff_escape(catalog["docsUrl"])))
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
        help="Verify committed man/ matches generator output and passes structural lint",
    )
    parser.add_argument(
        "--lint",
        action="store_true",
        help="Run mandoc -Tlint on man pages (skip with message if mandoc missing)",
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
        for problem in structural_lint(pages):
            print(problem, file=sys.stderr)
            drift = True
        if drift:
            return 1
        if args.lint:
            return run_mandoc_lint(pages)
        return 0

    MAN_DIR.mkdir(parents=True, exist_ok=True)
    for name, content in pages.items():
        (MAN_DIR / name).write_text(content, encoding="utf-8")
        print(f"wrote {MAN_DIR / name}")

    lint_failed = False
    for problem in structural_lint(pages):
        print(problem, file=sys.stderr)
        lint_failed = True
    if lint_failed:
        return 1

    if args.lint:
        return run_mandoc_lint(pages)
    return 0


if __name__ == "__main__":
    sys.exit(main())
