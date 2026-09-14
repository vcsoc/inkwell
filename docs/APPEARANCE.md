# Layouts, forms and themes

## Startup appearance

The desktop launcher reads the saved background before constructing its hidden window. A parser-blocking, authenticated same-origin theme script applies the validated palette and color scheme before the body is parsed; the window is shown only after that script has run. This avoids a light shell flashing before a saved dark or custom theme. It does not depend on account/folder sync finishing. Theme data is not cached and CSP remains restrictive. Unsaved Theme Studio previews are still discarded, not restored on relaunch.

## Dedicated Settings pages

Settings opens a category overview, not a scrolling page of forms. Choose a category to open its dedicated page; only that feature's controls are mounted. Use **All settings** to return to the overview or the section navigation to switch pages.

| Page | Client-side route |
| --- | --- |
| All settings | `/#/settings` |
| Layout | `/#/settings/layout` |
| Forms | `/#/settings/forms` |
| Theme studio | `/#/settings/theme` |
| Mail accounts | `/#/settings/mail` |
| AI assistant | `/#/settings/assistant` |
| Privacy & data | `/#/settings/privacy` |

Each page has its own heading and active navigation state. Direct links, reload, and browser Back/Forward restore the selected page. Navigation starts the new page at the top rather than scrolling to an anchor. These pages are independent of the popup/internal-form preference; account setup itself still uses your chosen form presentation.

Save changes before switching pages. Unsaved theme/layout previews are discarded when leaving and the saved appearance is restored. Provider/account settings are loaded only on their corresponding pages. Sample workspace loading is under **Privacy & data**.

## Default mail layout

In **Settings → Layout → Default mail layout**, choose a layout and click **Save layout**:

- **Focus:** original spacious Inkwell layout with a reader beside selected mail.
- **Classic:** inspired by the provided traditional mail-client screenshot—slim app rail, folder sidebar, compact message cards and a persistent right-hand reading pane.
- **Stacked:** message list above a persistent bottom reading pane.
- **List first:** selecting a message opens a full-width reader; Back returns to the list.

The diagram and workspace chrome preview your selection; **Revert layout preview** restores the saved default. Saving themes or changing form presentation does not reset the layout. All layouts use one pane with back navigation on phones. The default is loaded when each client starts/reloads; already-open devices do not receive live pushes.

Classic recreates the structural layout, not unsupported features: it does not invent tabs or attachment management. Microsoft folder trees and isolated HTML previews are implemented separately. Choose Midnight separately in Theme studio if you also want a dark appearance.

## Popup dialogs or internal pages

In **Settings → Forms**, choose **Popup dialogs** or **Internal pages (no popup)**, then click **Save form preference**.

The choice applies to account setup, compose/draft, calendar and contact forms. Confirmation prompts have been removed. Internal forms replace the main content area without an overlay; the navigation remains available. **Calendar new/edit forms appear to the right of the calendar when the main content area is at least 1000 CSS pixels wide**. Below that available width they use the full page. Resizing preserves the open form's values. Selecting another date/event or closing a non-mail form discards its unsaved edits without a prompt. Compose/reply/forward editors instead save a local draft before leaving; an unsuccessful save keeps the editor open. Saving returns to the underlying view. Internal mobile date/time fields stack vertically to avoid horizontal overflow.

The preference is stored on the backend and loaded when each connected client starts/reloads. It is shared by the single-user workspace, not isolated per phone. Login is still presented using the initial default popup before preferences can be retrieved.

## Pane sizes, preview mode and scaling

Drag the right edge of the folder sidebar to resize it (180–480px). In Focus with an open message, or Classic, drag the separator between messages and reader to resize the message list (220–900px, constrained by available room). Focus a separator and use Left/Right arrows, Home or End for keyboard resizing. Widths are saved with the workspace; mobile stays single-pane, and Stacked/List-first do not expose an inapplicable message-width handle.

In **Settings → Forms**, **Email preview format** chooses HTML (default, remote content blocked) or the previous text preview. **Interface scale (%)** offers 75–175% scaling. **Ctrl+plus** (Ctrl+= also works), **Ctrl+minus** and **Ctrl+0** enlarge, reduce and reset the interface, including its fixed-size text. On macOS the Command modifier is also accepted. This does not change the theme's chosen font-size values. Saved workspace presentation settings are shared by connected clients on their next reload; browser-native zoom can apply when an isolated email frame has keyboard focus in the web/PWA version. Electron handles these shortcuts even inside the email frame.

## Theme studio

**Settings → Theme studio** contains a live editor for:

- Background, surface, text, secondary text, borders, accent, accent text, selection and destructive-action colors.
- Corner radius, text size (12–24px), body font, serif/sans headings and comfortable/compact density.
- Separate sidebar font and text size (12–24px).
- Layout spacing (50–150%) for cards/readers/message rows and sidebar spacing (25–150%) for navigation padding and indentation.
- Dark native form controls.

A **Live preview** panel shows sample folders, selected mail, unread/tag pills, message text and actions using your draft theme. It stays alongside the controls on sufficiently wide content areas, or appears above them on narrow screens. It contains no real email data. The actual app also previews changes immediately; nothing is saved until Save theme.

Start with **Sage**, **Midnight**, **Ocean** or **High contrast**, or edit your saved theme. Changes preview immediately; **Save theme** persists them to the backend. **Revert preview** restores the last saved theme; **Reset to Sage** previews defaults, which still need saving to become permanent. Navigating away/reloading discards an unsaved preview.

Default body and sidebar text are now **16px**. Existing themes using the old 14px default and no sidebar-size setting are upgraded on load; other chosen sizes and colors remain unchanged. Explicitly saving 14px with the new editor is still supported. Compact mode substantially reduces sidebar row padding/margins, folder indentation overhead and message-row spacing. It does not shrink the chosen font. Touch devices retain larger navigation hit targets. Folder parents now use one row with an expand arrow and a selectable name, not duplicate rows.

Colors use **hex text fields, RGB sliders and palette swatches inside Inkwell**. Open **Adjust background**, for example, to change its RGB channels. There is no native color-dialog or desktop eyedropper invocation: no Wayland screen-capture chooser or screen-sharing permission is needed. Sampling arbitrary desktop pixels is not provided.

The editor displays text/surface and accent-button contrast ratios. Aim for at least 4.5:1 for ordinary text. Users can intentionally choose low-contrast colors, so the editor warns rather than claiming every possible custom theme is accessible.

**Export theme** downloads YAML by default; choose JSON in **Export format** for the legacy format. **Import theme** accepts `.yaml`, `.yml` and `.json` (maximum 16 KB) and previews the validated theme; save to keep it. YAML supports the simple version/theme mappings used by Inkwell, quoted or plain scalar values and comments, but rejects aliases, tags, duplicate keys and complex structures. Quote hex colors, for example `background: "#123456"`. It is not a general-purpose YAML loader. Import never evaluates CSS, scripts, font URLs or arbitrary properties. Fonts are installed/system stacks, not remote downloads. Theme files contain no mail, credentials, provider keys or account settings.

Only one custom theme is active/saved in the workspace at a time; use exported files to keep multiple custom palettes. Saved themes and presentation preferences are loaded on startup by connected devices, not pushed live to already-open windows.
