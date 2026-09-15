"""Literal text-only highlighting after mail sanitization."""

import re
from html import escape
from html.parser import HTMLParser


def pattern(query):
    query = re.sub(r"^tags?:", "", query[:200].strip(), flags=re.I).strip("\"'")
    terms = sorted({s for s in query.split() if len(s) >= 2}, key=len, reverse=True)[:20]
    return re.compile("|".join(re.escape(s) for s in terms), re.I) if terms else None


def highlight(body, query):
    regex = pattern(query)
    if not regex:
        return body

    class Marker(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.parts = []
            self.hits = 0

        def handle_starttag(self, tag, attrs):
            self.parts.append(self.get_starttag_text())

        def handle_startendtag(self, tag, attrs):
            self.parts.append(self.get_starttag_text())

        def handle_endtag(self, tag):
            self.parts.append("</" + tag + ">")

        def handle_data(self, text):
            offset = 0
            for match in regex.finditer(text):
                if self.hits >= 2000:
                    break
                self.parts.extend(
                    (
                        escape(text[offset : match.start()]),
                        '<mark data-search-hit="true">',
                        escape(match.group()),
                        "</mark>",
                    )
                )
                offset = match.end()
                self.hits += 1
            self.parts.append(escape(text[offset:]))

    marker = Marker()
    marker.feed(body)
    marker.close()
    return "".join(marker.parts)
