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
    def test_both_emulator_jobs_require_hardware_acceleration(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                before_action, action = workflow.read_text().split(
                    "uses: reactivecircus/android-emulator-runner@v2", 1
                )
                job_starts = list(re.finditer(r"(?m)^  [\w-]+:$", before_action))
                self.assertTrue(job_starts)
                job_preflight = before_action[job_starts[-1].start():]
                self.assertIn("- name: Enable KVM for Android emulator", job_preflight)
                self.assertIn('KERNEL=="kvm", GROUP="kvm", MODE="0666"', job_preflight)
                self.assertIn("sudo udevadm control --reload-rules", job_preflight)
                self.assertIn("sudo udevadm trigger --name-match=kvm", job_preflight)
                self.assertIn("test -r /dev/kvm && test -w /dev/kvm", job_preflight)
                action = action.split("      - name:", 1)[0]
                self.assertIn("api-level: 35", action)
                self.assertIn("arch: x86_64", action)
                self.assertIn("disable-linux-hw-accel: false", action)

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
