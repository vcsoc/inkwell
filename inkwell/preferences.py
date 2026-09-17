"""Validated presentation settings; themes never contain executable CSS or URLs."""

import json
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .shortcuts import DEFAULTS as SHORTCUTS, validate as validate_shortcuts

from . import store

router = APIRouter(prefix="/api/preferences")
Color = str


class Theme(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="Sage", min_length=1, max_length=60)
    background: Color = Field(default="#f6f5f1", pattern=r"^#[0-9a-fA-F]{6}$")
    surface: Color = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    text: Color = Field(default="#292e2b", pattern=r"^#[0-9a-fA-F]{6}$")
    muted: Color = Field(default="#697264", pattern=r"^#[0-9a-fA-F]{6}$")
    border: Color = Field(default="#e7e8e1", pattern=r"^#[0-9a-fA-F]{6}$")
    accent: Color = Field(default="#486b54", pattern=r"^#[0-9a-fA-F]{6}$")
    accent_text: Color = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    selection: Color = Field(default="#eaf0e8", pattern=r"^#[0-9a-fA-F]{6}$")
    danger: Color = Field(default="#ac4c45", pattern=r"^#[0-9a-fA-F]{6}$")
    radius: int = Field(default=10, ge=0, le=24)
    font_size: int = Field(default=16, ge=12, le=24)
    sidebar_font_size: int = Field(default=16, ge=12, le=24)
    sidebar_font: Literal["system", "humanist", "mono"] = "system"
    spacing: int = Field(default=100, ge=50, le=150)
    sidebar_spacing: int = Field(default=100, ge=25, le=150)
    font: Literal["system", "humanist", "mono"] = "system"
    headings: Literal["serif", "sans"] = "serif"
    density: Literal["comfortable", "compact"] = "comfortable"
    dark: bool = False


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shortcuts: dict[str, str] = Field(default_factory=lambda: dict(SHORTCUTS))
    _shortcuts = field_validator("shortcuts")(validate_shortcuts)
    form_mode: Literal["popup", "inline"] = "popup"
    layout: Literal["focus", "classic", "stacked", "list"] = "focus"
    preview_mode: Literal["html", "text"] = "html"
    sidebar_width: int = Field(default=260, ge=180, le=480)
    message_list_width: int = Field(default=380, ge=220, le=900)
    ui_zoom: int = Field(default=100, ge=75, le=175)
    theme: Theme = Field(default_factory=Theme)
    group_messages_by_date: bool = False
    mail_view: Literal["cards", "table"] = "cards"
    mail_sort: Literal[
        "date", "sender", "recipient", "subject", "unread", "starred", "tags", "imported"
    ] = "date"
    mail_order: Literal["asc", "desc"] = "desc"
    quick_filter_visible: bool = True
    quick_filter_pinned: bool = False


class WorkspacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shortcuts: dict[str, str] | None = None

    @field_validator("shortcuts")
    @classmethod
    def valid_shortcuts(cls, value):
        return validate_shortcuts(value) if value is not None else value

    preview_mode: Literal["html", "text"] | None = None
    sidebar_width: int | None = Field(default=None, ge=180, le=480)
    message_list_width: int | None = Field(default=None, ge=220, le=900)
    ui_zoom: int | None = Field(default=None, ge=75, le=175)
    group_messages_by_date: bool | None = None
    mail_view: Literal["cards", "table"] | None = None
    mail_sort: (
        Literal["date", "sender", "recipient", "subject", "unread", "starred", "tags", "imported"]
        | None
    ) = None
    mail_order: Literal["asc", "desc"] | None = None
    quick_filter_visible: bool | None = None
    quick_filter_pinned: bool | None = None


@router.patch("/workspace")
def update_workspace(data: WorkspacePatch):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT value FROM settings WHERE key='preferences'").fetchone()
        value = json.loads(row["value"]) if row else {}
        theme = value.get("theme", {})
        if "sidebar_font_size" not in theme and theme.get("font_size") == 14:
            theme["font_size"] = 16
        value.update(data.model_dump(exclude_none=True))
        value = Preferences.model_validate(value).model_dump()
        db.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES ('preferences',?)",
            (json.dumps(value),),
        )
    return value


@router.get("")
def get_preferences():
    value = json.loads(store.setting("preferences", "{}"))
    theme = value.get("theme", {})
    # Upgrade the old 14px default once; preserve other chosen sizes and colors.
    if "sidebar_font_size" not in theme and theme.get("font_size") == 14:
        theme["font_size"] = 16
    return Preferences.model_validate(value).model_dump()


@router.get("/startup.js")
def startup_theme():
    # Parser-blocking, same-origin and authenticated; only validated presentation data.
    theme = json.dumps(get_preferences()["theme"]).replace("<", "\\u003c")
    return Response(
        "window.InkwellAppearance.apply(" + theme + ");window.InkwellStartupThemeApplied=true;",
        media_type="application/javascript",
    )


@router.put("")
def save_preferences(data: Preferences):
    store.set_setting("preferences", json.dumps(data.model_dump()))
    return data.model_dump()
