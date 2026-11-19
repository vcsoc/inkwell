from inkwell import search_highlights, html_mail


def test_highlights_literal_text_not_markup_or_link_targets():
    body, _, _ = html_mail.sanitize(
        '<p>Needle C++ AT&amp;T</p><a href="https://needle.example/path">Other</a><script>needle</script>',
        links=True,
    )
    result = search_highlights.highlight(body, "needle C++ AT&T")
    assert result.count("<mark ") == 3
    assert 'href="https://needle.example/path"' in result
    assert "<script" not in result
    assert ">AT&amp;T</mark>" in result


def test_highlights_are_bounded_and_never_turn_email_text_into_markup():
    result = search_highlights.highlight(
        "&lt;script&gt;evil&lt;/script&gt; " + "word " * 3000, "script word"
    )
    assert "<script>" not in result and result.count("<mark ") == 2000
    assert search_highlights.highlight("<p>Plain text</p>", "") == "<p>Plain text</p>"
