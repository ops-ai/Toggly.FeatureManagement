"""Exercise the emulator action's one-command script contract."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


HOST = Path(__file__).resolve().parents[1]
REPO = HOST.parents[2]
WORKFLOWS = (
    REPO / ".github/workflows/acceptance-android-public-telemetry.yml",
    REPO / ".github/workflows/analysis-android.yml",
)
SCRIPT = HOST / "tool/run_android_coverage.sh"
DIAGNOSTICS = Path("app/build/reports/androidTests/connected/device-diagnostics.txt")


def action_command(workflow):
    text = workflow.read_text()
    commands = re.findall(r"(?m)^          script: (.+)$", text)
    if len(commands) != 1 or commands[0] == "|":
        raise AssertionError(f"{workflow.name}: emulator script must be one command")
    return commands[0]


class RunnerScriptTest(unittest.TestCase):
    def test_action_invokes_one_script_and_preserves_gradle_result(self):
        for workflow in WORKFLOWS:
            command = action_command(workflow)
            self.assertEqual(command, "bash tool/run_android_coverage.sh")
            for gradle_exit in (0, 17):
                with self.subTest(workflow=workflow.name, gradle_exit=gradle_exit):
                    with tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        (root / "tool").mkdir()
                        shutil.copyfile(SCRIPT, root / "tool/run_android_coverage.sh")
                        (root / "gradlew").write_text(
                            "#!/bin/sh\nprintf '%s\\n' \"$*\" > gradle-args.txt\n"
                            "exit \"$GRADLE_EXIT\"\n"
                        )
                        (root / "gradlew").chmod(0o755)
                        (root / "adb").write_text(
                            "#!/bin/sh\nprintf 'adb %s\\n' \"$*\"\n"
                        )
                        (root / "adb").chmod(0o755)
                        env = dict(os.environ, GRADLE_EXIT=str(gradle_exit),
                                   PATH=f"{root}:{os.environ['PATH']}")
                        # The action executes each script line in its own sh -c call.
                        result = subprocess.run(["sh", "-c", command], cwd=root,
                                                env=env, capture_output=True, text=True,
                                                check=False)
                        self.assertEqual(result.returncode, gradle_exit, result.stderr)
                        self.assertEqual(
                            (root / "gradle-args.txt").read_text().strip(),
                            ":app:createDebugAndroidTestCoverageReport --no-daemon",
                        )
                        diagnostic = root / DIAGNOSTICS
                        if gradle_exit:
                            self.assertTrue(diagnostic.is_file())
                            self.assertIn("adb logcat -d -b main -b crash -v threadtime",
                                          diagnostic.read_text())
                            self.assertIn("--- device ABI ---", result.stdout)
                        else:
                            self.assertFalse(diagnostic.exists())
