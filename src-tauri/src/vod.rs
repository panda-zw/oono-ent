use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

const TMDB_BASE: &str = "https://api.themoviedb.org/3";
const CACHE_TTL_SECS: i64 = 7 * 24 * 3600;

#[derive(Debug, Serialize, Clone)]
pub struct PosterCard {
    pub id: String,
    pub kind: String,
    pub tmdb_id: i64,
    pub title: String,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub overview: Option<String>,
    pub release_date: Option<String>,
    pub vote_average: Option<f64>,
    pub original_language: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VodDetail {
    pub id: String,
    pub kind: String,
    pub tmdb_id: i64,
    pub title: String,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub release_date: Option<String>,
    pub runtime: Option<i64>,
    pub vote_average: Option<f64>,
    pub genres: Vec<String>,
    pub seasons: Vec<SeasonInfo>,
    pub cast: Vec<CastMember>,
    pub crew: Vec<CrewMember>,
    pub production_companies: Vec<ProductionCompany>,
    pub tagline: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CastMember {
    pub tmdb_id: i64,
    pub name: String,
    pub character: Option<String>,
    pub profile_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PersonHit {
    pub tmdb_id: i64,
    pub name: String,
    pub profile_path: Option<String>,
    pub known_for_department: Option<String>,
    pub known_for: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PersonDetail {
    pub tmdb_id: i64,
    pub name: String,
    pub profile_path: Option<String>,
    pub biography: Option<String>,
    pub birthday: Option<String>,
    pub place_of_birth: Option<String>,
    pub known_for_department: Option<String>,
    pub credits: Vec<PosterCard>,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub titles: Vec<PosterCard>,
    pub people: Vec<PersonHit>,
}

#[derive(Debug, Serialize)]
pub struct CrewMember {
    pub name: String,
    pub job: String,
    pub profile_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProductionCompany {
    pub name: String,
    pub logo_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SeasonInfo {
    pub season_number: i64,
    pub name: String,
    pub episode_count: i64,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EpisodeInfo {
    pub season_number: i64,
    pub episode_number: i64,
    pub name: String,
    pub overview: Option<String>,
    pub still_path: Option<String>,
    pub air_date: Option<String>,
    pub runtime: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ContinueWatchingEntry {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub last_played_at: i64,
    pub provider: Option<String>,
}

pub async fn set_api_key(state: &AppState, key: &str) -> Result<()> {
    sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES ('tmdb_api_key', ?)")
        .bind(key)
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn get_api_key(state: &AppState) -> Result<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM meta WHERE key = 'tmdb_api_key'")
            .fetch_optional(&state.pool)
            .await?;
    Ok(row.map(|(v,)| v).filter(|s| !s.trim().is_empty()))
}

async fn cached_fetch(state: &AppState, cache_key: &str, url: &str) -> Result<Value> {
    let now = chrono::Utc::now().timestamp();
    let row: Option<(String, i64)> =
        sqlx::query_as("SELECT body, fetched_at FROM tmdb_cache WHERE cache_key = ?")
            .bind(cache_key)
            .fetch_optional(&state.pool)
            .await?;

    if let Some((body, fetched_at)) = row {
        if now - fetched_at < CACHE_TTL_SECS {
            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                return Ok(v);
            }
        }
    }

    let resp = state
        .http
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await?
        .error_for_status()?;
    let text = resp.text().await?;
    let v: Value = serde_json::from_str(&text)?;
    sqlx::query("INSERT OR REPLACE INTO tmdb_cache(cache_key, body, fetched_at) VALUES (?, ?, ?)")
        .bind(cache_key)
        .bind(&text)
        .bind(now)
        .execute(&state.pool)
        .await?;
    Ok(v)
}

async fn require_key(state: &AppState) -> Result<String> {
    get_api_key(state)
        .await?
        .ok_or_else(|| anyhow!("Add a TMDb API key in Settings to browse movies and series"))
}

fn parse_card(value: &Value, default_kind: &str) -> Option<PosterCard> {
    let media_type = value
        .get("media_type")
        .and_then(|v| v.as_str())
        .unwrap_or(default_kind);
    if media_type != "movie" && media_type != "tv" {
        return None;
    }
    let tmdb_id = value.get("id")?.as_i64()?;
    let title = value
        .get("title")
        .or_else(|| value.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();
    Some(PosterCard {
        id: format!("{}:{}", media_type, tmdb_id),
        kind: media_type.to_string(),
        tmdb_id,
        title,
        poster_path: value
            .get("poster_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        backdrop_path: value
            .get("backdrop_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        overview: value
            .get("overview")
            .and_then(|v| v.as_str())
            .map(String::from),
        release_date: value
            .get("release_date")
            .or_else(|| value.get("first_air_date"))
            .and_then(|v| v.as_str())
            .map(String::from),
        vote_average: value.get("vote_average").and_then(|v| v.as_f64()),
        original_language: value
            .get("original_language")
            .and_then(|v| v.as_str())
            .map(String::from),
    })
}

pub async fn list_endpoint(
    state: Arc<AppState>,
    endpoint: &str,
    default_kind: &str,
) -> Result<Vec<PosterCard>> {
    let key = require_key(&state).await?;
    let url = format!("{TMDB_BASE}{endpoint}{}api_key={}", separator(endpoint), key);
    let cache_key = format!("list:{endpoint}");
    let body = cached_fetch(&state, &cache_key, &url).await?;
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results
        .iter()
        .filter_map(|v| parse_card(v, default_kind))
        .collect())
}

fn separator(endpoint: &str) -> &'static str {
    if endpoint.contains('?') { "&" } else { "?" }
}

#[derive(Debug, serde::Deserialize, Default)]
pub struct DiscoverQuery {
    pub kind: String,
    pub genre_id: Option<i64>,
    pub year: Option<i64>,
    pub year_from: Option<i64>,
    pub year_to: Option<i64>,
    pub sort: Option<String>,
    pub page: Option<i64>,
    pub language: Option<String>,
    pub region: Option<String>,
    pub min_rating: Option<f64>,
    pub min_votes: Option<i64>,
    pub runtime_min: Option<i64>,
    pub runtime_max: Option<i64>,
    pub keyword: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GenreEntry {
    pub id: i64,
    pub name: String,
}

pub async fn genres(state: Arc<AppState>, kind: &str) -> Result<Vec<GenreEntry>> {
    let key = require_key(&state).await?;
    let url = format!("{TMDB_BASE}/genre/{kind}/list?api_key={key}");
    let cache_key = format!("genres:{kind}");
    let body = cached_fetch(&state, &cache_key, &url).await?;
    Ok(body
        .get("genres")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|g| {
                    Some(GenreEntry {
                        id: g.get("id")?.as_i64()?,
                        name: g.get("name")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

pub async fn discover(state: Arc<AppState>, q: DiscoverQuery) -> Result<Vec<PosterCard>> {
    let key = require_key(&state).await?;
    let kind = if q.kind == "tv" { "tv" } else { "movie" };
    let mut params: Vec<(String, String)> = vec![
        ("api_key".into(), key),
        ("include_adult".into(), "false".into()),
        ("page".into(), q.page.unwrap_or(1).to_string()),
    ];
    if let Some(g) = q.genre_id {
        params.push(("with_genres".into(), g.to_string()));
    }
    if let Some(y) = q.year {
        if kind == "tv" {
            params.push(("first_air_date_year".into(), y.to_string()));
        } else {
            params.push(("primary_release_year".into(), y.to_string()));
        }
    }
    // Year range — TMDB uses primary_release_date.{gte,lte} for movies and
    // first_air_date.{gte,lte} for TV. These compose with year, so callers
    // typically pick one or the other.
    let date_field = if kind == "tv" {
        "first_air_date"
    } else {
        "primary_release_date"
    };
    if let Some(y) = q.year_from {
        params.push((format!("{date_field}.gte"), format!("{y}-01-01")));
    }
    if let Some(y) = q.year_to {
        params.push((format!("{date_field}.lte"), format!("{y}-12-31")));
    }
    if let Some(lang) = q.language.as_deref().filter(|s| !s.is_empty()) {
        params.push(("with_original_language".into(), lang.to_string()));
    }
    if let Some(region) = q.region.as_deref().filter(|s| !s.is_empty()) {
        params.push(("region".into(), region.to_string()));
        params.push(("with_origin_country".into(), region.to_string()));
    }
    if let Some(r) = q.min_rating {
        if r > 0.0 {
            params.push(("vote_average.gte".into(), format!("{r:.1}")));
        }
    }
    if let Some(v) = q.min_votes {
        if v > 0 {
            params.push(("vote_count.gte".into(), v.to_string()));
        }
    }
    if let Some(rt) = q.runtime_min {
        if rt > 0 {
            params.push(("with_runtime.gte".into(), rt.to_string()));
        }
    }
    if let Some(rt) = q.runtime_max {
        if rt > 0 {
            params.push(("with_runtime.lte".into(), rt.to_string()));
        }
    }
    if let Some(keyword) = q.keyword.as_deref().filter(|s| !s.is_empty()) {
        params.push(("with_keywords".into(), keyword.to_string()));
    }
    let sort = q.sort.as_deref().unwrap_or("popularity.desc");
    params.push(("sort_by".into(), sort.to_string()));
    let qs = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!("{TMDB_BASE}/discover/{kind}?{qs}");
    let cache_key = format!("discover:{kind}:{qs}");
    let body = cached_fetch(&state, &cache_key, &url).await?;
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results.iter().filter_map(|v| parse_card(v, kind)).collect())
}

pub async fn search(state: Arc<AppState>, query: &str) -> Result<SearchResults> {
    let key = require_key(&state).await?;
    let q = urlencoding::encode(query);
    let url = format!("{TMDB_BASE}/search/multi?query={q}&include_adult=false&api_key={key}");
    let cache_key = format!("search:{}:v2", query.to_lowercase());
    let body = cached_fetch(&state, &cache_key, &url).await?;
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let titles: Vec<PosterCard> = results
        .iter()
        .filter_map(|v| parse_card(v, "movie"))
        .collect();

    let people: Vec<PersonHit> = results
        .iter()
        .filter(|v| {
            v.get("media_type")
                .and_then(|m| m.as_str())
                .map(|s| s == "person")
                .unwrap_or(false)
        })
        .filter_map(parse_person_hit)
        .take(8)
        .collect();

    Ok(SearchResults { titles, people })
}

fn parse_person_hit(v: &Value) -> Option<PersonHit> {
    let known_for: Vec<String> = v
        .get("known_for")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|kf| {
                    kf.get("title")
                        .or_else(|| kf.get("name"))
                        .and_then(|t| t.as_str())
                        .map(String::from)
                })
                .take(3)
                .collect()
        })
        .unwrap_or_default();
    Some(PersonHit {
        tmdb_id: v.get("id")?.as_i64()?,
        name: v.get("name")?.as_str()?.to_string(),
        profile_path: v
            .get("profile_path")
            .and_then(|x| x.as_str())
            .map(String::from),
        known_for_department: v
            .get("known_for_department")
            .and_then(|x| x.as_str())
            .map(String::from),
        known_for,
    })
}

pub async fn person_detail(state: Arc<AppState>, tmdb_id: i64) -> Result<PersonDetail> {
    let key = require_key(&state).await?;
    let url = format!(
        "{TMDB_BASE}/person/{tmdb_id}?api_key={key}&append_to_response=combined_credits"
    );
    let cache_key = format!("person:{tmdb_id}:v1");
    let body = cached_fetch(&state, &cache_key, &url).await?;

    let mut credits: Vec<(PosterCard, f64, Option<String>)> = body
        .get("combined_credits")
        .and_then(|c| c.get("cast"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let kind = m.get("media_type").and_then(|x| x.as_str())?;
                    if kind != "movie" && kind != "tv" {
                        return None;
                    }
                    let card = parse_card(m, kind)?;
                    let popularity = m
                        .get("popularity")
                        .and_then(|p| p.as_f64())
                        .unwrap_or(0.0);
                    let date = m
                        .get("release_date")
                        .or_else(|| m.get("first_air_date"))
                        .and_then(|x| x.as_str())
                        .map(String::from);
                    Some((card, popularity, date))
                })
                .collect()
        })
        .unwrap_or_default();
    // Dedup by tmdb_id+kind (cast can list a show multiple times across episodes).
    credits.sort_by(|a, b| {
        b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut seen = std::collections::HashSet::new();
    credits.retain(|c| seen.insert(c.0.id.clone()));

    let credits: Vec<PosterCard> = credits.into_iter().map(|c| c.0).collect();

    Ok(PersonDetail {
        tmdb_id: body.get("id").and_then(|v| v.as_i64()).unwrap_or(tmdb_id),
        name: body
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        profile_path: body
            .get("profile_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        biography: body
            .get("biography")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        birthday: body
            .get("birthday")
            .and_then(|v| v.as_str())
            .map(String::from),
        place_of_birth: body
            .get("place_of_birth")
            .and_then(|v| v.as_str())
            .map(String::from),
        known_for_department: body
            .get("known_for_department")
            .and_then(|v| v.as_str())
            .map(String::from),
        credits,
    })
}

pub async fn detail(state: Arc<AppState>, kind: &str, tmdb_id: i64) -> Result<VodDetail> {
    let key = require_key(&state).await?;
    let url = format!(
        "{TMDB_BASE}/{kind}/{tmdb_id}?api_key={key}&append_to_response=credits"
    );
    let cache_key = format!("detail:{kind}:{tmdb_id}:v2");
    let body = cached_fetch(&state, &cache_key, &url).await?;

    let title = body
        .get("title")
        .or_else(|| body.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();
    let runtime = body
        .get("runtime")
        .and_then(|v| v.as_i64())
        .or_else(|| {
            body.get("episode_run_time")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_i64())
        });
    let genres: Vec<String> = body
        .get("genres")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|g| {
                    g.get("name")
                        .and_then(|n| n.as_str())
                        .map(String::from)
                })
                .collect()
        })
        .unwrap_or_default();

    let seasons: Vec<SeasonInfo> = body
        .get("seasons")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    Some(SeasonInfo {
                        season_number: s.get("season_number")?.as_i64()?,
                        name: s.get("name")?.as_str()?.to_string(),
                        episode_count: s.get("episode_count").and_then(|v| v.as_i64()).unwrap_or(0),
                        overview: s.get("overview").and_then(|v| v.as_str()).map(String::from),
                        poster_path: s
                            .get("poster_path")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                })
                .filter(|s| s.season_number > 0)
                .collect()
        })
        .unwrap_or_default();

    let credits = body.get("credits");
    let cast: Vec<CastMember> = credits
        .and_then(|c| c.get("cast"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .take(20)
                .filter_map(|m| {
                    Some(CastMember {
                        tmdb_id: m.get("id")?.as_i64()?,
                        name: m.get("name")?.as_str()?.to_string(),
                        character: m.get("character").and_then(|v| v.as_str()).map(String::from),
                        profile_path: m
                            .get("profile_path")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // Pull "Director" (movies) or "Creator"/"Executive Producer" (TV) plus
    // a couple of writers/composers — surface the people audiences ask about.
    let crew_raw: Vec<&Value> = credits
        .and_then(|c| c.get("crew"))
        .and_then(|v| v.as_array())
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    let mut crew: Vec<CrewMember> = Vec::new();
    let interesting_jobs = [
        "Director",
        "Screenplay",
        "Writer",
        "Original Music Composer",
        "Director of Photography",
        "Executive Producer",
    ];
    for job in interesting_jobs {
        for m in &crew_raw {
            if m.get("job").and_then(|v| v.as_str()) == Some(job) {
                if let (Some(name),) = (m.get("name").and_then(|v| v.as_str()),) {
                    crew.push(CrewMember {
                        name: name.to_string(),
                        job: job.to_string(),
                        profile_path: m
                            .get("profile_path")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    });
                }
            }
        }
        if crew.len() >= 8 {
            break;
        }
    }
    // For TV shows, prepend the show creators (their "job" isn't in crew —
    // it's a top-level `created_by`).
    if kind == "tv" {
        if let Some(creators) = body.get("created_by").and_then(|v| v.as_array()) {
            let mut prefix = Vec::new();
            for c in creators.iter().take(3) {
                if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                    prefix.push(CrewMember {
                        name: name.to_string(),
                        job: "Creator".to_string(),
                        profile_path: c
                            .get("profile_path")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    });
                }
            }
            prefix.append(&mut crew);
            crew = prefix;
        }
    }

    let production_companies: Vec<ProductionCompany> = body
        .get("production_companies")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    Some(ProductionCompany {
                        name: c.get("name")?.as_str()?.to_string(),
                        logo_path: c.get("logo_path").and_then(|v| v.as_str()).map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let tagline = body
        .get("tagline")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let detail = VodDetail {
        id: format!("{kind}:{tmdb_id}"),
        kind: kind.to_string(),
        tmdb_id,
        title: title.clone(),
        overview: body.get("overview").and_then(|v| v.as_str()).map(String::from),
        poster_path: body.get("poster_path").and_then(|v| v.as_str()).map(String::from),
        backdrop_path: body
            .get("backdrop_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        release_date: body
            .get("release_date")
            .or_else(|| body.get("first_air_date"))
            .and_then(|v| v.as_str())
            .map(String::from),
        runtime,
        vote_average: body.get("vote_average").and_then(|v| v.as_f64()),
        genres: genres.clone(),
        seasons,
        cast,
        crew,
        production_companies,
        tagline,
    };

    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT OR REPLACE INTO vod_media (id, kind, tmdb_id, title, overview, poster_path, backdrop_path, release_date, runtime, vote_average, genres_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&detail.id)
    .bind(&detail.kind)
    .bind(detail.tmdb_id)
    .bind(&detail.title)
    .bind(&detail.overview)
    .bind(&detail.poster_path)
    .bind(&detail.backdrop_path)
    .bind(&detail.release_date)
    .bind(detail.runtime)
    .bind(detail.vote_average)
    .bind(serde_json::to_string(&genres).unwrap_or_else(|_| "[]".into()))
    .bind(now)
    .execute(&state.pool)
    .await?;

    Ok(detail)
}

pub async fn season_episodes(
    state: Arc<AppState>,
    tv_id: i64,
    season: i64,
) -> Result<Vec<EpisodeInfo>> {
    let key = require_key(&state).await?;
    let url = format!("{TMDB_BASE}/tv/{tv_id}/season/{season}?api_key={key}");
    let cache_key = format!("season:{tv_id}:{season}");
    let body = cached_fetch(&state, &cache_key, &url).await?;
    let eps = body
        .get("episodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(eps
        .iter()
        .filter_map(|e| {
            Some(EpisodeInfo {
                season_number: e.get("season_number")?.as_i64()?,
                episode_number: e.get("episode_number")?.as_i64()?,
                name: e
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Untitled")
                    .to_string(),
                overview: e.get("overview").and_then(|v| v.as_str()).map(String::from),
                still_path: e.get("still_path").and_then(|v| v.as_str()).map(String::from),
                air_date: e.get("air_date").and_then(|v| v.as_str()).map(String::from),
                runtime: e.get("runtime").and_then(|v| v.as_i64()),
            })
        })
        .collect())
}

pub fn build_embed_url(
    provider: &str,
    kind: &str,
    tmdb_id: i64,
    season: Option<i64>,
    episode: Option<i64>,
) -> String {
    let s = season.unwrap_or(1);
    let e = episode.unwrap_or(1);
    match (provider, kind) {
        // vidsrc.xyz went offline; vidsrc.to is the active mirror and uses a
        // path-style URL instead of query params.
        ("vidsrc", "movie") => format!("https://vidsrc.to/embed/movie/{tmdb_id}"),
        ("vidsrc", "tv") => format!("https://vidsrc.to/embed/tv/{tmdb_id}/{s}/{e}"),
        ("2embed", "movie") => format!("https://www.2embed.cc/embed/{tmdb_id}"),
        ("2embed", "tv") => format!("https://www.2embed.cc/embedtv/{tmdb_id}?s={s}&e={e}"),
        // player.autoembed.cc is also dead; autoembed.co is the live alternate
        // and uses tmdb/{id} and tmdb/{id}-S-E paths.
        ("autoembed", "movie") => format!("https://autoembed.co/movie/tmdb/{tmdb_id}"),
        ("autoembed", "tv") => {
            format!("https://autoembed.co/tv/tmdb/{tmdb_id}-{s}-{e}")
        }
        ("vidlink", "movie") => format!("https://vidlink.pro/movie/{tmdb_id}"),
        ("vidlink", "tv") => format!("https://vidlink.pro/tv/{tmdb_id}/{s}/{e}"),
        _ => format!("https://vidsrc.to/embed/{kind}/{tmdb_id}"),
    }
}

pub async fn save_progress(
    state: &AppState,
    media_id: &str,
    season: Option<i64>,
    episode: Option<i64>,
    provider: Option<String>,
    completed: bool,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT OR REPLACE INTO vod_progress (media_id, season, episode, last_played_at, completed, provider) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(media_id)
    .bind(season.unwrap_or(-1))
    .bind(episode.unwrap_or(-1))
    .bind(now)
    .bind(if completed { 1 } else { 0 })
    .bind(provider)
    .execute(&state.pool)
    .await?;
    Ok(())
}

pub async fn continue_watching(state: &AppState) -> Result<Vec<ContinueWatchingEntry>> {
    let rows: Vec<(
        String,
        i64,
        i64,
        i64,
        Option<String>,
        String,
        String,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT p.media_id, p.season, p.episode, p.last_played_at, p.provider,
                m.kind, m.title, m.poster_path, m.backdrop_path
         FROM vod_progress p
         JOIN vod_media m ON m.id = p.media_id
         WHERE p.completed = 0
         ORDER BY p.last_played_at DESC
         LIMIT 12",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(media_id, season, episode, last_played_at, provider, kind, title, poster_path, backdrop_path)| {
                ContinueWatchingEntry {
                    id: media_id,
                    kind,
                    title,
                    poster_path,
                    backdrop_path,
                    season: if season < 0 { None } else { Some(season) },
                    episode: if episode < 0 { None } else { Some(episode) },
                    last_played_at,
                    provider,
                }
            },
        )
        .collect())
}

pub async fn mark_completed(state: &AppState, media_id: &str) -> Result<()> {
    sqlx::query("UPDATE vod_progress SET completed = 1 WHERE media_id = ?")
        .bind(media_id)
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn clear_progress(state: &AppState, media_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM vod_progress WHERE media_id = ?")
        .bind(media_id)
        .execute(&state.pool)
        .await?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct WatchlistEntry {
    pub id: String,
    pub kind: String,
    pub tmdb_id: i64,
    pub title: String,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub overview: Option<String>,
    pub vote_average: Option<f64>,
    pub added_at: i64,
}

pub async fn watchlist_add(state: &AppState, media_id: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT OR REPLACE INTO vod_watchlist (media_id, added_at) VALUES (?, ?)")
        .bind(media_id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn watchlist_remove(state: &AppState, media_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM vod_watchlist WHERE media_id = ?")
        .bind(media_id)
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn watchlist_has(state: &AppState, media_id: &str) -> Result<bool> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM vod_watchlist WHERE media_id = ?")
            .bind(media_id)
            .fetch_optional(&state.pool)
            .await?;
    Ok(row.is_some())
}

pub async fn watchlist_list(state: &AppState) -> Result<Vec<WatchlistEntry>> {
    let rows: Vec<(
        String,
        String,
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<f64>,
        i64,
    )> = sqlx::query_as(
        "SELECT m.id, m.kind, m.tmdb_id, m.title, m.poster_path, m.backdrop_path, m.overview, m.vote_average, w.added_at
         FROM vod_watchlist w
         JOIN vod_media m ON m.id = w.media_id
         ORDER BY w.added_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, kind, tmdb_id, title, poster_path, backdrop_path, overview, vote_average, added_at)| {
            WatchlistEntry {
                id,
                kind,
                tmdb_id,
                title,
                poster_path,
                backdrop_path,
                overview,
                vote_average,
                added_at,
            }
        })
        .collect())
}
