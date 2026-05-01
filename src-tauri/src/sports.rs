// Sports schedule via ESPN's public scoreboard API.
//
// ESPN exposes an unofficial-but-stable public scoreboard endpoint at
// `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`
// that requires no API key, returns real-time live status (state=in), full
// competitor metadata + team logos, and covers far more leagues than
// TheSportsDB's free tier (which dropped to 3 events/day for soccer in
// our usage). We curate a list of leagues per sport, fetch each in
// parallel, parse into our shared SportEvent shape, dedupe by ID, and
// sort live-first.

use std::time::Duration;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

const ESPN_BASE: &str = "https://site.api.espn.com/apis/site/v2/sports";

// (sport_key, sport_label, sport_path, league_path)
const LEAGUES: &[(&str, &str, &str, &str)] = &[
    // Soccer / Football
    ("soccer", "Football", "soccer", "eng.1"),
    ("soccer", "Football", "soccer", "esp.1"),
    ("soccer", "Football", "soccer", "ger.1"),
    ("soccer", "Football", "soccer", "ita.1"),
    ("soccer", "Football", "soccer", "fra.1"),
    ("soccer", "Football", "soccer", "ned.1"),
    ("soccer", "Football", "soccer", "por.1"),
    ("soccer", "Football", "soccer", "tur.1"),
    ("soccer", "Football", "soccer", "uefa.champions"),
    ("soccer", "Football", "soccer", "uefa.europa"),
    ("soccer", "Football", "soccer", "uefa.europa.conf"),
    ("soccer", "Football", "soccer", "uefa.nations"),
    ("soccer", "Football", "soccer", "uefa.champions_qual"),
    ("soccer", "Football", "soccer", "uefa.europa.qual"),
    ("soccer", "Football", "soccer", "usa.1"),
    ("soccer", "Football", "soccer", "mex.1"),
    ("soccer", "Football", "soccer", "bra.1"),
    ("soccer", "Football", "soccer", "arg.1"),
    ("soccer", "Football", "soccer", "fifa.world"),
    ("soccer", "Football", "soccer", "fifa.worldq.uefa"),
    ("soccer", "Football", "soccer", "fifa.worldq.conmebol"),
    ("soccer", "Football", "soccer", "fifa.worldq.concacaf"),
    ("soccer", "Football", "soccer", "fifa.cwc"),
    ("soccer", "Football", "soccer", "conmebol.libertadores"),
    ("soccer", "Football", "soccer", "conmebol.sudamericana"),
    ("soccer", "Football", "soccer", "concacaf.champions_league"),
    ("soccer", "Football", "soccer", "afc.cup"),
    ("soccer", "Football", "soccer", "caf.champions_league"),
    ("soccer", "Football", "soccer", "eng.fa"),
    ("soccer", "Football", "soccer", "eng.league_cup"),
    ("soccer", "Football", "soccer", "esp.copa_del_rey"),
    ("soccer", "Football", "soccer", "ita.coppa_italia"),
    ("soccer", "Football", "soccer", "ger.dfb_pokal"),
    ("soccer", "Football", "soccer", "fra.coupe_de_france"),
    ("soccer", "Football", "soccer", "eng.2"),
    ("soccer", "Football", "soccer", "esp.2"),
    // Basketball
    ("basketball", "Basketball", "basketball", "nba"),
    ("basketball", "Basketball", "basketball", "mens-college-basketball"),
    ("basketball", "Basketball", "basketball", "wnba"),
    ("basketball", "Basketball", "basketball", "fiba.intercontinental"),
    // American football
    ("americanfootball", "NFL", "football", "nfl"),
    ("americanfootball", "College Football", "football", "college-football"),
    // Hockey
    ("icehockey", "NHL", "hockey", "nhl"),
    // Baseball
    ("baseball", "MLB", "baseball", "mlb"),
    // Motorsport
    ("motorsport", "F1", "racing", "f1"),
    // Fighting
    ("fighting", "UFC", "mma", "ufc"),
    ("fighting", "Boxing", "boxing", "boxing"),
    // Tennis — ESPN exposes per-tournament; cover the four slams.
    ("tennis", "Tennis", "tennis", "atp"),
    ("tennis", "Tennis", "tennis", "wta"),
    // Cricket
    ("cricket", "Cricket", "cricket", "icc.cwc"),
    // Rugby
    ("rugby", "Rugby", "rugby", "164205"),
];

#[derive(Debug, Serialize)]
pub struct SportEvent {
    pub id: String,
    pub title: String,
    pub home: Option<String>,
    pub away: Option<String>,
    pub home_badge: Option<String>,
    pub away_badge: Option<String>,
    pub league: Option<String>,
    pub league_badge: Option<String>,
    pub country: Option<String>,
    pub sport: String,
    pub sport_label: String,
    pub timestamp: Option<i64>,
    pub status: Option<String>,
    pub is_live: bool,
}

#[derive(Debug, Deserialize)]
struct ScoreboardResponse {
    leagues: Option<Vec<RawLeague>>,
    events: Option<Vec<RawEvent>>,
}

#[derive(Debug, Deserialize)]
struct RawLeague {
    name: Option<String>,
    logos: Option<Vec<RawLogo>>,
}

#[derive(Debug, Deserialize)]
struct RawLogo {
    href: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawEvent {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "shortName")]
    short_name: Option<String>,
    date: Option<String>,
    competitions: Option<Vec<RawCompetition>>,
}

#[derive(Debug, Deserialize)]
struct RawCompetition {
    competitors: Option<Vec<RawCompetitor>>,
    status: Option<RawStatus>,
    venue: Option<RawVenue>,
}

#[derive(Debug, Deserialize)]
struct RawCompetitor {
    team: Option<RawTeam>,
    #[serde(rename = "homeAway")]
    home_away: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawTeam {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "shortDisplayName")]
    short_display_name: Option<String>,
    logo: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawStatus {
    #[serde(rename = "type")]
    status_type: Option<RawStatusType>,
}

#[derive(Debug, Deserialize)]
struct RawStatusType {
    state: Option<String>,
    description: Option<String>,
    detail: Option<String>,
    #[serde(rename = "shortDetail")]
    short_detail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawVenue {
    address: Option<RawAddress>,
}

#[derive(Debug, Deserialize)]
struct RawAddress {
    country: Option<String>,
}

fn parse_timestamp(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp())
}

async fn fetch_one(
    http: &reqwest::Client,
    sport_path: &str,
    league_path: &str,
    date_yyyymmdd: &str,
) -> Result<ScoreboardResponse> {
    let url = format!(
        "{ESPN_BASE}/{sport_path}/{league_path}/scoreboard?dates={date_yyyymmdd}&limit=200"
    );
    let resp = http
        .get(&url)
        .timeout(Duration::from_secs(12))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Ok(ScoreboardResponse {
            leagues: None,
            events: None,
        });
    }
    Ok(resp.json().await.unwrap_or(ScoreboardResponse {
        leagues: None,
        events: None,
    }))
}

fn date_yyyymmdd(date_iso: &str) -> String {
    // Input is YYYY-MM-DD; ESPN wants YYYYMMDD.
    date_iso.replace('-', "")
}

pub async fn fetch_schedule(state: &AppState, date: &str) -> Result<Vec<SportEvent>> {
    let yyyymmdd = date_yyyymmdd(date);

    let mut tasks = Vec::with_capacity(LEAGUES.len());
    for (sport_key, sport_label, sport_path, league_path) in LEAGUES.iter() {
        let http = state.http.clone();
        let yyyymmdd = yyyymmdd.clone();
        let sport_key = sport_key.to_string();
        let sport_label = sport_label.to_string();
        let sport_path = sport_path.to_string();
        let league_path = league_path.to_string();
        tasks.push(tokio::spawn(async move {
            let result = fetch_one(&http, &sport_path, &league_path, &yyyymmdd).await;
            (sport_key, sport_label, league_path, result)
        }));
    }

    let mut out: Vec<SportEvent> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for handle in tasks {
        let Ok((sport_key, sport_label, league_path, result)) = handle.await else {
            continue;
        };
        let resp = match result {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!("[sports] {league_path} fetch failed: {e}");
                continue;
            }
        };

        let league_meta = resp.leagues.as_ref().and_then(|v| v.first());
        let league_name = league_meta.and_then(|l| l.name.clone());
        let league_logo = league_meta
            .and_then(|l| l.logos.as_ref())
            .and_then(|logos| logos.first())
            .and_then(|lg| lg.href.clone());

        for raw in resp.events.unwrap_or_default() {
            let Some(id) = raw.id.clone() else { continue };
            if !seen_ids.insert(id.clone()) {
                continue;
            }

            let comp = raw.competitions.as_ref().and_then(|v| v.first());
            let competitors = comp.and_then(|c| c.competitors.as_ref());
            let home = competitors
                .and_then(|cs| cs.iter().find(|c| c.home_away.as_deref() == Some("home")));
            let away = competitors
                .and_then(|cs| cs.iter().find(|c| c.home_away.as_deref() == Some("away")));

            let home_name = home.and_then(|c| {
                c.team
                    .as_ref()
                    .and_then(|t| t.display_name.clone().or_else(|| t.short_display_name.clone()))
            });
            let away_name = away.and_then(|c| {
                c.team
                    .as_ref()
                    .and_then(|t| t.display_name.clone().or_else(|| t.short_display_name.clone()))
            });

            let title = raw
                .name
                .clone()
                .or_else(|| raw.short_name.clone())
                .or_else(|| match (home_name.as_ref(), away_name.as_ref()) {
                    (Some(h), Some(a)) => Some(format!("{h} vs {a}")),
                    _ => None,
                })
                .unwrap_or_else(|| "Match".into());

            let timestamp = raw.date.as_deref().and_then(parse_timestamp);
            let status_type = comp
                .and_then(|c| c.status.as_ref())
                .and_then(|s| s.status_type.as_ref());
            let state_str = status_type.and_then(|t| t.state.clone());
            let is_live = matches!(state_str.as_deref(), Some("in"));
            let status_label = status_type.and_then(|t| {
                t.short_detail
                    .clone()
                    .or_else(|| t.detail.clone())
                    .or_else(|| t.description.clone())
            });

            let country = comp
                .and_then(|c| c.venue.as_ref())
                .and_then(|v| v.address.as_ref())
                .and_then(|a| a.country.clone());

            out.push(SportEvent {
                id,
                title,
                home: home_name,
                away: away_name,
                home_badge: home.and_then(|c| c.team.as_ref().and_then(|t| t.logo.clone())),
                away_badge: away.and_then(|c| c.team.as_ref().and_then(|t| t.logo.clone())),
                league: league_name.clone(),
                league_badge: league_logo.clone(),
                country,
                sport: sport_key.clone(),
                sport_label: sport_label.clone(),
                timestamp,
                status: status_label,
                is_live,
            });
        }
    }

    out.sort_by(|a, b| match (a.is_live, b.is_live) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.timestamp.unwrap_or(i64::MAX).cmp(&b.timestamp.unwrap_or(i64::MAX)),
    });

    Ok(out)
}
