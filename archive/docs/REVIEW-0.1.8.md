# Inkwell 0.1.8 local review hotfix

This unsigned Linux x86_64 build fixes a Documents sidebar regression in the 0.1.7 review build: background mailbox refreshes replaced the active folder tree with “Loading Documents…” and did not restore it. The fix preserves the folder tree, expanded folders and their click handlers during refresh. No GitHub release was published.

To install, quit Inkwell, then from the repository run:

```sh
(cd dist && sha256sum -c SHA256SUMS)
sh dist/inkwell-0.1.8-linux-x64.run
```

Open Documents and leave it open through a mail refresh. The folder tree should stay usable. For more document feature testing, see [Documents](DOCUMENTS.md) and the checklist in [the earlier 0.1.7 review notes](REVIEW-0.1.7.md), substituting **0.1.8** for the installer and About version. The installer keeps your workspace and previous managed releases.
