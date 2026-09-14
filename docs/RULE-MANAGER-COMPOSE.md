# Rule Manager, recipients and tag colors

## Rule Manager

Open **Rule Manager** in the sidebar, or `/#/rules`. The same editor remains available under **Settings → Mail rules**. All saved rules are listed with their conditions, actions, enabled state and missing-resource warnings. Search, create, edit, duplicate, enable/disable and delete are available without confirmation dialogs.

For “move all emails with ABC in the subject to XYZ”:

1. Create XYZ using **New local folder**, unless it already exists. Creating a folder preserves the rule currently being edited.
2. Enter a rule name. Set **Subject → contains → ABC**.
3. Choose **Move local copy → XYZ** and save.
4. Future imports use it automatically. **Apply rules to existing imported copies…** applies saved rules to eligible cached mail immediately.

Choose **All conditions (AND)** or **Any condition (OR)**. Up to 20 conditions and 20 actions per rule, with 100 rules total. Nested condition groups are not provided. Text matching is case-insensitive; exact sender/domain matching also normalizes addresses and IDNA. Conditions cover sender address, sender domain, subject, To header, message text, tag, unread/starred state and age. Text operators include equals/not equals, contains/does not contain, starts with and ends with. Age supports older/newer than a number of days.

Actions: move locally, mark read/unread, star/unstar, add/remove a catalog tag. All actions belong to the same rule; the arrow button moves an action earlier. Contradictory flag/tag actions execute in their displayed order, so the last applicable action wins. At most one move action is allowed. Destinations include local folders and displayed server-folder branches, but filing into a branch changes only the local view, not provider membership.

The first matching eligible enabled rule wins, in creation order. This is not a chain of all matching rules. Existing age/read exclusions remain additional AND restrictions. Actions are planned before writing: missing resources or a final tag count above 12 skip the rule without partial changes. Applying to existing copies skips Drafts, Sent, Trash and copies already locally managed (manually or by a previous rule). There is no periodic ageing scheduler, automatic sending, destructive delete action, or server-side rule management. Conditions inspect cached metadata/content, not authenticated sender identity.

Legacy rules retain their behavior and appear in the builder. Rule tag references use stable catalog IDs: rename keeps references, merge redirects them, and deleting a referenced tag disables the affected rules. Review those rules before enabling them again. Deleting a rule does not undo earlier actions or delete mail.

## Domain auto-tagging

In Rule Manager, choose **Create auto-tag rule**. This starts a tag-only rule with **Sender domain → is** and **Add tag**, without an implicit move action.

1. Give the rule a name and enter `@example.com` (or `example.com`) as the condition value.
2. Select the `example` tag. If it does not exist, enter `example` under **New rule tag** and click **Create tag**; the empty Add tag action is selected automatically without discarding the rule edit.
3. Click **Save rule**.

Every newly imported matching copy receives the tag immediately. Domain matching is exact and case-insensitive: subdomains and lookalikes such as `example.com.evil` do not match. Tag-only actions preserve the message's folder and read state. First-match ordering still applies: an earlier matching rule wins, so add the tag action to that existing rule when appropriate. Rules do not change provider mail or tags, and cannot process messages that have not been imported.

Use **Apply rules to existing imported copies…** for eligible cached messages; its existing exclusions (drafts, sent, Trash and already locally managed copies) remain in force. Creating a tag saves the catalog entry independently of saving a rule. Its color can be changed in Tag Manager.

## Cc, Bcc and address autocomplete

Compose and Reply include **Cc** and **Bcc** toggles. Fields with recipients are always visible when reopening a draft. Clear a field before hiding it; recipients cannot remain invisibly active behind a collapsed toggle. To/Cc/Bcc are autosaved with the draft, including partial addresses, and retained in the local Sent copy. Reply starts with the original sender in To and empty Cc/Bcc; this is not Reply All.

Use comma- or semicolon-separated addresses, optionally with quoted display names. Sending validates every address and limits the combined, case-insensitively deduplicated list to 100 recipients. To can be empty when Cc or Bcc has recipients. From remains restricted to configured accounts. Sending uses the explicit Send control (including keyboard activation of that button), not Enter in an address or subject input.

SMTP includes Cc in headers and includes Bcc **only in the delivery envelope**, never in the transmitted Bcc header. Microsoft Graph receives separate To/Cc/Bcc recipient arrays. Sender-owned local drafts/Sent copies retain Bcc for review. Transport tests verify these paths with mocks; no live email delivery was used to validate this release.

Autocomplete is enabled for To/Cc/Bcc and other email-address form inputs. It searches local address/name history, current contacts and account addresses. Valid addresses from saved drafts, sent mail and imported message headers are remembered; partial/invalid tokens are not suggested. The list shows up to 30 matches, searches before limiting results, and supports mouse/touch plus arrow keys and Enter. Picking a suggestion replaces the current recipient token without erasing the others. Suggestions never go to an external service.

History survives deleting a draft/message/contact or disconnecting an account. **Settings → Privacy → Clear remembered email addresses** clears history while preserving current contact/account suggestions and mail. Addresses can be remembered again when used or synchronized. This is local plaintext data, like cached mail; protect the workspace and backups.

## Tag color picker and menus

Tag Manager uses **Choose color…** to reveal an in-app saturation/brightness area, hue control and 36-color palette, with optional hex entry and a live pill preview. Drag/touch or use arrow keys in the area (Shift for larger adjustments). There are no RGB channel sliders in Tag Manager and no native picker, eyedropper, screen-capture permission or CSP relaxation. General theme settings retain their existing RGB controls.

Application context menus use text two pixels smaller than the configured base font, with a 12px minimum. No-wrap labels, scrolling and 44px touch targets are retained. This does not alter operating-system menus.

## Storage and APIs

Schema **8** adds `messages.cc`, `messages.bcc` and indexed `address_history`, preserving mail, credentials, tags and rule configurations. History is backfilled from existing mail/contact/account addresses; old cached mail has no reconstructed Cc/Bcc metadata. Older binaries cannot open schema 8. Rollback requires a consistent pre-upgrade database and matching vault key.

- Rules retain `/api/rules`, `/api/rules/{id}` and `/api/rules/apply`. The model adds `mode`, `conditions: [{field,operator,value}]` and `actions: [{type,value}]`. Tag values are catalog IDs represented as strings. Legacy sender/domain payloads remain accepted.
- `/api/drafts` and `/api/send` accept `cc` and `bcc` strings; recipient fields are each bounded to 8192 characters. Revision and close-time autosave guards remain in force.
- `GET /api/addresses?q=…` returns matching `{address,name,last_used}` entries; `DELETE /api/addresses` clears remembered history. Existing session/origin/host protections apply.
