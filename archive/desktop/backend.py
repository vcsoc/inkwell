"""Frozen backend entry point (PyInstaller discovers inkwell.app via a hidden import)."""

from inkwell.__main__ import main

if __name__ == "__main__":
    main()
