from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_script(name: str) -> str:
    return (REPO_ROOT / "scripts" / "windows" / name).read_text(encoding="utf-8")


def test_t018_t019_t020_t022_use_long_running_repetition_trigger() -> None:
    for name in (
        "setup-t018-local-push-task.ps1",
        "setup-t019-local-push-task.ps1",
        "setup-t020-local-push-task.ps1",
        "setup-t022-local-push-task.ps1",
    ):
        content = _read_script(name)
        assert "New-ScheduledTaskTrigger -Once" in content
        assert "RepetitionInterval $repeatSpan" in content
        assert "RepetitionDuration (New-TimeSpan -Days 3650)" in content
        assert "Register-ScheduledTask" in content
        assert "schtasks.exe" not in content


def test_t018_t019_t020_t022_are_staggered_to_avoid_ssh_burst() -> None:
    expected = {
        "setup-t018-local-push-task.ps1": "[int]$StartDelayMinutes = 1",
        "setup-t019-local-push-task.ps1": "[int]$StartDelayMinutes = 4",
        "setup-t020-local-push-task.ps1": "[int]$StartDelayMinutes = 7",
        "setup-t022-local-push-task.ps1": "[int]$StartDelayMinutes = 10",
    }
    for name, marker in expected.items():
        content = _read_script(name)
        assert marker in content
        assert "$startAt = (Get-Date).AddMinutes($StartDelayMinutes)" in content
