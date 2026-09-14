# Local rules, search and calendar

## Import rules

Open **Settings → Mail rules**. Create a local folder first if needed, then create a rule:

- Choose an **exact sender address** or **exact sender domain**. Matching normalizes addresses/domain case and IDNA; a domain rule does not implicitly include subdomains.
- Choose Inbox, Archive, local Trash or a custom local destination.
- **Exclude unread messages** restricts the rule to read messages.
- **Only messages older than days** can be set to `7` to leave messages from the last seven days alone; `0` means any age. The two exclusions can be combined.
- Save, edit, disable or delete rules. First matching enabled rule wins, in creation order. Up to 100 rules are supported.

Both IMAP and Microsoft imports apply rules inside the same SQLite transaction as the newly copied message, before it becomes visible to the UI. No server folders/messages/read flags are changed, and no extra provider write permission is requested. Custom folders are local and appear in the sidebar; they are also available in the message menu's Move local copy action.

Saving a rule affects **future newly imported copies**. Use **Apply rules to existing imported copies…** to explicitly organize already downloaded mail. Copies already moved locally (manually or by a previous rule), local drafts/sent messages and local Trash are left alone. Later syncs preserve these positions. Deleting a rule does not undo earlier moves or delete messages.

Age and read-status conditions are evaluated at import/apply time. This is not a timer that automatically re-files mail on its seventh birthday or when you mark it read. Rules match the displayed message's sender metadata, not authenticated proof of sender identity. These are local filing rules, not provider-side junk/block rules.

## One search field

The top search input is the only mail search field. Results update **280 ms after typing stops**, after at least **two trimmed characters**. Enter and the search button also work. Clearing the field restores downloaded messages in the selected scope, resets pagination and removes the unread filter. Scope changes also refresh results. Stale responses cannot overwrite a newer query.

Search retains current-folder, folder-plus-descendants and all-downloaded-folders scopes. Collection searches stay within their collection. Search from Calendar, People or Settings opens the aggregate Inbox. Older, uncached server messages are still not searched.

## Calendar

- Enable **All day** for date-only events. The form's end date is **inclusive**. Internally and in ICS it is stored as the following, exclusive date, so a Monday–Wednesday event covers all three days.
- Drag across visible days to create one all-day span. For touch or keyboard use, choose **Select date range**, then select its first and last dates. Backward selections work too. Dates spanning a month boundary can use the displayed adjacent-month cells or be entered in the form.
- Choose **daily, weekly, monthly or yearly** repeats, an interval, up to **1000 occurrences**, and an optional stop date. Whichever limit comes first ends the series. Weekly rules can select multiple weekdays; empty weekday selection uses the starting weekday. Monthly rules skip months without the chosen day.
- Timed series keep their wall-clock time in the saved **IANA event timezone**, including DST changes. A new non-existent spring-forward time is rejected by the editor; such future repeat occurrences are skipped. Ambiguous fall-back times use the timezone library's default occurrence. All-day dates do not shift with client timezone.
- Multi-day events appear on every overlapping day. The agenda includes events overlapping the displayed month. Occurrences are generated for the visible grid, not stored as duplicate event rows.
- Clicking any occurrence edits the **whole series** from its original anchor. Deleting removes the entire series. Per-occurrence exceptions/cancellations are not yet supported.
- Calendar surfaces, foregrounds, event colors and controls follow the selected theme. The existing Popup/Internal form preference and wide-screen calendar side editor still apply. The calendar remains a month grid plus agenda, not additional week/day views.

ICS export includes date-only events and recurrence rules. Timed repeating events use IANA TZID values; receiving calendars must recognize those timezone names (a VTIMEZONE definition is not embedded). Meetings/invitations, reminders, provider calendar sync and calendar import remain unimplemented.

Schema **5** adds local folders/rules and calendar all-day, timezone and recurrence fields. Existing events remain non-repeating. Earlier binaries cannot reopen an upgraded schema-5 workspace; keep a consistent backup and vault key before downgrading.

## Branding

The displayed application name is **inkwell**. The supplied transparent wordmark is used in the sidebar via an alpha mask colored with the theme's Text color. Launcher/PWA icons use the same artwork on a fixed, contrasting neutral tile; operating-system icons do not live-recolor with an in-app theme. Internal compatibility markers and API identifier names retain their existing spelling so upgrades continue to recognize older installations. The Microsoft registration's consent-screen display name is managed separately in Azure.
