"""Local aggregate views; Trash and editable Drafts intentionally stay local."""


def predicate(folder):
    known = {"archive": "archive", "sent": "sentitems"}.get(folder)
    if not known:
        return "folder=?", [folder]
    return (
        "(folder=? OR (folder IN ('inbox','remote') AND CASE WHEN local_folder_override=1 THEN local_destination_id ELSE remote_folder_id END IN (SELECT id FROM remote_folders WHERE well_known=?)))",
        [folder, known],
    )
