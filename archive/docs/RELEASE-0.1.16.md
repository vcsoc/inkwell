# Inkwell 0.1.16

Linux x86_64 PDF editing and image placement update over 0.1.15.

- **Add text** to a selected PDF area using an in-app text and font-size dialog; this replaces the browser prompt that failed in the installed desktop app. **Replace text** removes existing text in the selected area and writes replacement text to a **new copy**. This is area-based PDF editing, not a full word processor; replacement may cover background images in that area.
- **Place image** imports a PNG, JPEG, WebP or GIF into a selected PDF area. Imported and drawn signature images now show a preview you can drag to reposition or resize using the corner handle **before Apply**. Applying creates a separately named PDF copy; existing flattened stamps cannot be moved after saving, so reopen the preserved source or a prior copy to change placement.
- PDF tools occupy a visible second toolbar row in narrower desktop windows, with placement instructions in the editor. Images inserted into DOCX rich documents retain their selected width after saving and reopening. Tests cover browser and packaged Electron PDF text/image workflows.

Schema remains **19**. Installation preserves `~/.inkwell`, Documents originals, and prior releases; it does not force-close an open window. Save work and relaunch to use the new tools. This unsigned Linux x86_64 build may not run on older glibc systems. `SHA256SUMS` verifies integrity, not publisher authenticity.
