"""Collect installed runtime license notices for the packaged distribution."""

import importlib.metadata as metadata
import pathlib
import sys
import sysconfig
import tomllib

from packaging.requirements import Requirement

root = pathlib.Path(__file__).resolve().parent.parent
output = pathlib.Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
project = tomllib.loads((root / "pyproject.toml").read_text())["project"]
pending = [Requirement(r).name for r in project["dependencies"]] + ["pyinstaller"]
seen = set()
index = ["Third-party notices for this build", "", "These components retain their own licenses."]
while pending:
    name = pending.pop()
    dist = metadata.distribution(name)
    name = dist.metadata["Name"]
    if name.lower() in seen:
        continue
    seen.add(name.lower())
    target = output / name
    target.mkdir(exist_ok=True)
    index.append(f"{name} {dist.version}")
    (target / "METADATA.txt").write_text(dist.read_text("METADATA") or f"{name} {dist.version}")
    for entry in dist.files or []:
        leaf = pathlib.Path(entry).name.lower()
        if (
            leaf.startswith(("license", "copying", "notice"))
            or "sboms" in pathlib.Path(entry).parts
        ):
            source = pathlib.Path(dist.locate_file(entry))
            if (
                source.is_file()
                and ".." not in pathlib.Path(entry).parts
                and not pathlib.Path(entry).is_absolute()
            ):
                destination = target / "files" / str(entry)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source.read_bytes())
    for value in dist.requires or []:
        requirement = Requirement(value)
        if requirement.marker is None or requirement.marker.evaluate({"extra": ""}):
            pending.append(requirement.name)
python_license = pathlib.Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
if not python_license.is_file():
    raise RuntimeError("Python license file is missing from this build environment")
(output / "Python-LICENSE.txt").write_bytes(python_license.read_bytes())
(output / "INDEX.txt").write_text("\n".join(index) + "\n")
print(f"Collected notices for Python and {len(seen)} installed packages.")
