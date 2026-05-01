#[derive(Debug, Default, Clone)]
pub struct M3uEntry {
    pub channel_id: Option<String>,
    pub display_name: String,
    pub url: String,
    pub group_title: Option<String>,
    pub logo: Option<String>,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
}

pub fn parse(text: &str) -> Vec<M3uEntry> {
    let mut out = Vec::new();
    let mut current: Option<M3uEntry> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let mut entry = M3uEntry::default();
            let (attrs_part, title) = rest.split_once(',').unwrap_or((rest, ""));
            entry.display_name = title.trim().to_string();
            entry.channel_id = extract_quoted_attr(attrs_part, "tvg-id")
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            entry.group_title = extract_quoted_attr(attrs_part, "group-title")
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            entry.logo = extract_quoted_attr(attrs_part, "tvg-logo")
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            current = Some(entry);
        } else if let Some(rest) = line.strip_prefix("#EXTVLCOPT:") {
            if let Some(entry) = current.as_mut() {
                if let Some((k, v)) = rest.split_once('=') {
                    let key = k.trim().to_lowercase();
                    let value = v.trim().to_string();
                    if key == "http-user-agent" {
                        entry.user_agent = Some(value);
                    } else if key == "http-referrer" {
                        entry.referrer = Some(value);
                    }
                }
            }
        } else if let Some(rest) = line.strip_prefix("#KODIPROP:") {
            if let Some(entry) = current.as_mut() {
                if let Some((k, v)) = rest.split_once('=') {
                    let key = k.trim().to_lowercase();
                    if key == "inputstream.adaptive.stream_headers" || key.contains("user-agent") {
                        for part in v.split('&') {
                            if let Some((kk, vv)) = part.split_once('=') {
                                let kk = kk.to_lowercase();
                                if kk.contains("user-agent") && entry.user_agent.is_none() {
                                    entry.user_agent = Some(vv.to_string());
                                } else if kk.contains("referer") && entry.referrer.is_none() {
                                    entry.referrer = Some(vv.to_string());
                                }
                            }
                        }
                    }
                }
            }
        } else if line.starts_with('#') {
            // skip other directives (#EXTM3U, comments, etc.)
        } else if let Some(mut entry) = current.take() {
            entry.url = line.to_string();
            if entry.display_name.is_empty() {
                entry.display_name = derive_name_from_url(&entry.url);
            }
            if entry.channel_id.is_none() {
                entry.channel_id = Some(generate_channel_id(&entry.display_name, &entry.url));
            }
            out.push(entry);
        }
    }

    out
}

fn extract_quoted_attr<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("{key}=\"");
    let i = s.find(&needle)?;
    let start = i + needle.len();
    let rest = &s[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

fn derive_name_from_url(url: &str) -> String {
    url.rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("Unknown")
        .to_string()
}

fn generate_channel_id(name: &str, url: &str) -> String {
    let mut h: u64 = 1469598103934665603;
    for b in url.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    let slug: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(24)
        .collect::<String>()
        .to_lowercase();
    if slug.is_empty() {
        format!("ext.{:x}", h)
    } else {
        format!("{slug}.ext{:x}", h & 0xffff_ffff)
    }
}
