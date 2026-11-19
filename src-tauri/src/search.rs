use rusqlite::{Connection, Result, functions::FunctionFlags, types::Value};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

pub(crate) fn register(db: &Connection) -> Result<()> {
    db.create_scalar_function(
        "inkwell_search_key",
        1,
        FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        |ctx| Ok(key(&ctx.get::<Option<String>>(0)?.unwrap_or_default())),
    )
}

fn key(value: &str) -> String {
    value.nfkc().case_fold().collect()
}

pub(crate) fn append(query: &str, sql: &mut String, bindings: &mut Vec<Value>) {
    let query: String = query.trim().chars().take(200).collect();
    if query.is_empty() {
        return;
    }
    if let Some((prefix, rest)) = query.split_once(':')
        && (prefix.eq_ignore_ascii_case("tag") || prefix.eq_ignore_ascii_case("tags"))
    {
        let mut tag = rest.trim();
        let exact = tag.len() >= 2
            && ((tag.starts_with('"') && tag.ends_with('"'))
                || (tag.starts_with('\'') && tag.ends_with('\'')));
        if exact {
            tag = &tag[1..tag.len() - 1];
        }
        if tag.is_empty() {
            sql.push_str(" AND 0");
            return;
        }
        sql.push_str(" AND EXISTS (SELECT 1 FROM json_each(messages.tags) WHERE ");
        sql.push_str(if exact {
            "inkwell_search_key(value)=?)"
        } else {
            "instr(inkwell_search_key(value),?)>0)"
        });
        bindings.push(key(tag).into());
        return;
    }
    let pattern = format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    sql.push_str(" AND (");
    for name in ["subject", "sender", "recipient", "cc", "bcc", "body"] {
        sql.push_str(name);
        sql.push_str(" LIKE ? ESCAPE '\\' OR ");
        bindings.push(pattern.clone().into());
    }
    sql.push_str("EXISTS (SELECT 1 FROM json_each(messages.tags) WHERE ");
    if let Some(tag) = query.strip_prefix('#') {
        sql.push_str("inkwell_search_key(value) IN (?,?)))");
        bindings.push(key(&query).into());
        bindings.push(key(tag).into());
    } else {
        sql.push_str("instr(inkwell_search_key(value),?)>0))");
        bindings.push(key(&query).into());
    }
}
