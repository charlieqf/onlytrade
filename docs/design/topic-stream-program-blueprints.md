# Topic Stream Program Blueprints

This document captures two planned topic-led stream programs that reuse the successful parts of `t_017` oral-english while shifting the content genre:

- `五大联赛每日评书 / 豪门锐评`
- `国内大厂每日锐评`

The intent is to standardize them as one reusable production system with different source adapters, entity whitelists, prompt styles, and page themes.

## Proposed room and route plan

Proposed first rollout mapping:

- `t_018` -> `/stream/topic-commentary?trader=t_018&program=five-league`
- `t_019` -> `/stream/topic-commentary?trader=t_019&program=china-bigtech`

Bridge form:

- `/onlytrade/stream/topic-commentary?trader=t_018&program=five-league`
- `/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech`

Reason for using one route:

- one player component
- one generic feed contract
- one asset-loading model
- theme chosen by `program`

Recommended page titles:

- `t_018`: `五大联赛每日评书`
- `t_019`: `国内大厂每日锐评`

## Decisions to lock before implementation

These points should be treated as design decisions, not optional implementation details.

- one shared player, one shared runtime contract, one shared asset pipeline
- exactly one selected topic per entity per cycle; do not emit multiple same-day cards for the same club/company in one live feed
- daily target is `8-12` topics, but weak days may publish fewer; never pad with weak filler just to hit count
- final live feed for `t_018` and `t_019` should contain only rows that have both a real image and a pre-generated static MP3
- `t_018` and `t_019` should not rely on live TTS fallback in normal operation; if MP3 generation fails, drop the topic from the final feed
- topic switching is strictly audio-ended, not timer-ended
- `summary_facts` and `commentary_script` must stay logically separated
- program differences belong in config: source adapters, entity whitelist, prompt layer, validator layer, and theme tokens

## Shared program matrix

| Dimension | `five-league` | `china-bigtech` |
| --- | --- | --- |
| Room | `t_018` | `t_019` |
| Route | `/stream/topic-commentary?trader=t_018&program=five-league` | `/stream/topic-commentary?trader=t_019&program=china-bigtech` |
| Content unit | one club = one topic | one company / car brand = one topic |
| Tone | 说书、豪门叙事、调侃、势头感 | 锐评、行业对比、互联网语感、舆论张力 |
| Facts vs opinion | facts first, then joke / narrative turn | facts first, then controlled sharp framing |
| Key risk | repetitive weak days | rumor laundering / unsupported allegations |
| Visual language | stadium / tabloid / match-night poster | newsroom / hot-topic card / business bulletin |
| Release gate | skip clubs with no real update | skip companies with no discussable update |

## Why these two programs

Both programs have the same strengths:

- daily freshness
- strong audience opinion and tribal identity
- easy to serialize into many short topics
- suitable for sharp commentary, storytelling, mockery, and recurring host persona
- easy to package as mobile-first autoplay stream pages

They differ mainly in source domain:

- football program is driven by match reports, injuries, transfers, standings, and coach/player quotes
- big-tech program is driven by company news, product launches, AI competition, organization changes, price wars, financial reports, and public controversy

## Program A: Five-League Daily Storytelling

Recommended positioning:

- not a neutral scoreboard
- not full league coverage
- a selective daily show focused on a fixed set of headline clubs
- tone: storytelling + sharp commentary + teasing + momentum

Recommended club pool:

- Real Madrid
- Barcelona
- Atletico Madrid
- Manchester City
- Liverpool
- Arsenal
- Manchester United
- Chelsea
- Bayern Munich
- Borussia Dortmund
- Inter Milan
- Juventus

Optional replacements for traffic reasons:

- Paris Saint-Germain
- Tottenham Hotspur

Recommended topic rule:

- do not force one topic for every club every day
- only generate topics for clubs with real fresh material
- if a club has no meaningful update, skip it
- one club contributes at most one topic to the final live feed of the day

Per-topic structure:

1. what happened today
2. why this matters
3. sharp commentary / joke / narrative turn
4. what to watch next

Recommended runtime:

- `60-90s` per club topic
- `8-12` topics per episode

## Program B: China Big-Tech Daily Sharp Commentary

Recommended positioning:

- a daily commentary show on Chinese internet giants and high-attention car/AI companies
- tone: sharp, fast, opinionated, but clearly separated from factual claims
- closer to public-opinion stream than pure business reporting

Recommended company pool:

- Huawei
- Alibaba
- Tencent
- ByteDance
- Baidu
- Meituan
- JD
- Pinduoduo
- Xiaomi

Recommended vehicle / AI extension pool:

- Xiaomi Auto
- Li Auto
- Xpeng
- Nio
- BYD
- Aito / Harmony Intelligent Mobility
- Zeekr
- Tesla China

Recommended topic rule:

- only keep companies with fresh and discussable events
- prefer controversy, strategy turns, public statements, product launches, financial updates, and direct competition
- one company / vehicle brand contributes at most one topic to the final live feed of the day

Per-topic structure:

1. what happened today
2. why people care
3. sharp commentary / narrative framing
4. what may happen next

Recommended runtime:

- `60-90s` per company topic
- `8-12` topics per episode

## What to copy from `t_017` oral-english

`t_017` already proved several important production lessons:

### 1. Topic feed is the right abstraction

The page should not think in long-form episodes first. It should think in a list of short topics with stable fields:

- `id`
- `title`
- `screen_title`
- `image_file`
- `audio_file`
- `source`
- `published_at`
- `commentary_script`
- `screen_vocabulary` or `screen_tags`

This same model works for:

- one English-news lesson topic
- one football-club rant topic
- one big-tech-company rant topic

### 2. Local generation plus VM push is more stable than live generation

`t_017` showed that live TTS is too fragile for fast topic switching. The reliable pattern is:

1. collect topics on local PC
2. generate scripts locally
3. pre-generate MP3 locally
4. push JSON + images + MP3 to VM
5. frontend plays static assets first

This pattern should be reused unchanged for both new programs.

### 3. Topic switching must follow audio completion

`t_017` exposed a key playback rule:

- topic rotation should not be driven by a blind fixed timer
- topic changes should happen after current audio ends

The same rule is mandatory for football and big-tech commentary streams.

### 4. Image-backed topics are much better than fallback topics

`t_017` became more usable after removing fallback-image rows from the final feed.

Same principle for both new programs:

- only keep topics that have a real visual asset
- do not fill dead air with weak fallback cards unless there is an explicit backup mode

### 5. Mobile poster-style layout is better than split panels

`t_017` moved away from a rigid top/middle/bottom structure toward:

- full-screen background
- large title overlay
- floating tags on image

This visual language is directly reusable:

- football can feel like tabloid poster / match-night bulletin
- big-tech can feel like newsroom poster / internet hot-topic card

### 6. Content quality must be validated after generation

For `t_017`, generated teaching material now has post-generation checks and regeneration.

The same principle should apply here:

- football commentary must not degrade into dry scoreboard reading
- big-tech commentary must not degrade into bland press-release summary

Each program needs a validator before topic enters the final feed.

## Similarity between the two new programs

These are not two different systems. They are two skins on top of one pipeline.

Shared characteristics:

- both are topic-driven, not article-driven
- both depend on a fixed whitelist of high-attention entities
- both should emit `8-12` short topics per cycle
- both need a host persona and recurring voice
- both rely on strong, compressed commentary rather than neutral reporting
- both should prefer static MP3 playback over live TTS
- both need visual topic cards with a real image
- both can use the same frontend player and API contract

Core difference is only:

- adapter inputs
- whitelist
- prompt style
- visual theme

## One shared production pipeline

Both programs should share the same end-to-end workflow.

### Step 1: collect raw news

Per program, use dedicated adapters:

- football:
  - club news
  - match reports
  - standings
  - injury updates
  - transfer updates
  - coach/player quotes
- big tech:
  - company news
  - product launches
  - earnings and guidance
  - executive statements
  - AI and car wars
  - pricing and promotion wars

### Step 2: filter to a fixed entity whitelist

Ignore long-tail noise. Only keep:

- selected clubs for football
- selected companies for big tech

### Step 2.5: normalize into one shared candidate row shape

Before ranking or prompting, both programs should emit the same internal candidate structure:

```json
{
  "entity_key": "real_madrid",
  "entity_label": "Real Madrid",
  "category": "football",
  "title": "Mbappe saves Madrid late again",
  "summary_facts": "fact-only digest before commentary generation",
  "source": "BBC Sport",
  "source_url": "https://example.com/story",
  "published_at": "2026-03-08T09:20:00Z",
  "priority_score": 0.92,
  "topic_reason": "late winner + title-race attention"
}
```

This keeps collectors different, but keeps downstream generation and playback identical.

### Step 3: rank topic candidates

Rank by a weighted score:

- freshness
- audience familiarity
- controversy
- narrative potential
- visual availability

### Step 4: generate a commentary script

Use one shared prompt skeleton:

1. factual opening
2. why it matters
3. sharp commentary
4. forward-looking hook

Program-specific style layer:

- football: more emotion, rivalry, jokes, momentum
- big tech: more strategy framing, internet sarcasm, sector comparison

### Step 5: validate script quality

Reject and regenerate if any of these happen:

- too short
- too long
- too flat
- only factual summary, no commentary
- repetitive host tone
- missing hook
- weak spoken rhythm

This is the same quality-control idea already used in `t_017`.

### Step 6: prepare a visual asset

Per topic, choose:

- article image
- club/team image
- company/product image
- approved fallback per entity only if absolutely necessary

Rule:

- final feed should prefer real topic images
- entity-level fallback should be a last resort, not normal behavior
- if the only available visual is a low-quality generic fallback, prefer dropping the topic from the release feed

### Step 7: pre-generate MP3 locally

Use the same principle as `t_017`:

- generate MP3 on local PC
- cache by `topic id + script hash`
- only upload new or changed files
- if MP3 generation fails for a topic, remove that topic from the final live feed rather than relying on runtime fallback

### Step 8: write a shared feed JSON

Canonical contract reference:

- `docs/design/topic-stream-feed-contract.md`

Recommended generic schema:

```json
{
  "schema_version": "topic.stream.feed.v1",
  "room_id": "t_xxx",
  "program_slug": "football-royal-review",
  "program_title": "五大联赛每日评书",
  "as_of": "2026-03-08T10:00:00Z",
  "headline_count": 10,
  "topics": [
    {
      "id": "topic_001",
      "entity_key": "real_madrid",
      "entity_label": "Real Madrid",
      "category": "football",
      "title": "Mbappe saves Madrid late again",
      "screen_title": "皇马这场又赢得不体面，但赢得很豪门",
      "summary_facts": "short factual digest",
      "commentary_script": "spoken commentary",
      "screen_tags": ["Late winner", "Title race", "Defensive wobble"],
      "source": "BBC Sport",
      "published_at": "2026-03-08T09:20:00Z",
      "image_file": "abc.jpg",
      "audio_file": "abc.mp3"
    }
  ]
}
```

Field contract recommendation:

- top-level:
  - `schema_version`
  - `room_id`
  - `program_slug`
  - `program_title`
  - `program_style`
  - `as_of`
  - `topic_count`
  - `topics`
  - `generation_stats`
- per-topic:
  - `id`
  - `entity_key`
  - `entity_label`
  - `category`
  - `title`
  - `screen_title`
  - `summary_facts`
  - `commentary_script`
  - `screen_tags`
  - `source`
  - `source_url`
  - `published_at`
  - `image_file`
  - `audio_file`
  - `script_estimated_seconds`
  - `priority_score`
  - `topic_reason`

Recommended normalization rule:

- `title` stays closer to source headline
- `screen_title` is host-facing, sharper, shorter, and more opinionated
- `summary_facts` is factual digest only
- `commentary_script` is the spoken host script
- `screen_tags` is the visual overlay list, usually `3-5` items

### Step 9: push to VM

Use the same local-PC-to-VM push model as `t_017`:

- JSON
- images
- MP3

### Step 10: render with one shared frontend player

One player can support all three topic programs:

- oral-english
- football commentary
- big-tech commentary

Page-level differences should be config-driven:

- route
- room id
- program slug
- theme tokens
- topic field labels

## Reusable frontend/player model

Recommended shared page behavior:

- one full-screen topic at a time
- static MP3 required for `t_018` and `t_019`
- auto-advance only after playback completion
- preload current and next topic audio
- large poster title
- 3-5 floating tag chips
- small source/time metadata
- no blind fixed-duration rotation for commentary programs
- if current topic audio is missing or invalid, skip the topic and move on; do not stall the whole page

Recommended per-program theme tokens:

- football:
  - palette: deep green / gold / white / floodlight contrast
  - motion: subtle stadium-light sweep
  - title tone: tabloid + match bulletin
- big tech:
  - palette: graphite / red / acid blue / warning amber
  - motion: ticker + newsroom sweep
  - title tone: internet headline + business bulletin

Theme differences:

- oral-english:
  - classroom / magazine cover
- football:
  - stadium / tabloid / match-night urgency
- big tech:
  - newsroom / app-war / business bulletin

## Reusable backend/runtime model

The runtime API does not need separate logic for every show.

Recommended generic endpoints:

- `GET /api/topic-stream/live?room_id=<room>`
- `GET /api/topic-stream/images/:room_id/:file`
- `GET /api/topic-stream/audio/:room_id/:file`

Then:

- `t_017` can remain on its existing English-classroom route for compatibility
- new shows should prefer the generic topic-stream route

Recommended storage layout:

```text
data/live/onlytrade/topic_stream/
  five_league_live.json
  china_bigtech_live.json

data/live/onlytrade/topic_images/
  t_018/
  t_019/

data/live/onlytrade/topic_audio/
  t_018/
  t_019/
```

Recommended release invariant:

- every row in the released live feed resolves to an existing image file and an existing MP3 file under the room-specific directories above

Recommended local scripts:

- `scripts/topic_stream/run_five_league_cycle.py`
- `scripts/topic_stream/run_china_bigtech_cycle.py`
- `scripts/topic_stream/local_collect_and_push_t018.sh`
- `scripts/topic_stream/local_collect_and_push_t019.sh`

## Content safety and policy differences

The two shows share a pipeline, but not identical risk.

### Football show

Main risks:

- low legal risk
- higher risk of repetitive content or weak days

Operational rule:

- focus on entertainment and momentum

### Big-tech show

Main risks:

- defamation risk
- rumor laundering risk
- overconfident claims about companies or executives

Operational rule:

- separate facts from commentary
- mark rumors as rumors
- avoid unverified accusations
- keep tone sharp without making unsupported factual claims

## Implementation order

Recommended order:

1. build a generic `topic-stream` schema and player
2. keep `t_017` as reference implementation for local generation + MP3 push
3. launch `国内大厂每日锐评` first
4. launch `五大联赛每日评书` second using the same pipeline

Reason:

- big-tech has broader daily traffic
- football can reuse the exact same system once the shared pipeline is stable

## Prompt templates

Use one shared JSON-output prompt contract for both programs.

Shared output target:

```json
{
  "screen_title": "short host-facing headline",
  "summary_facts": "factual digest only",
  "commentary_script": "spoken script",
  "screen_tags": ["tag1", "tag2", "tag3", "tag4"],
  "topic_reason": "why this is worth keeping today"
}
```

### Football prompt skeleton

System intent:

- produce spoken football commentary, not neutral match notes
- keep rhythm suitable for `60-90s` spoken playback
- keep facts and opinion distinguishable
- maintain a recurring storyteller persona

User prompt template:

```text
program: five-league-daily-storytelling
entity: {{entity_label}}
headline: {{headline}}
summary: {{summary}}
source: {{source}}
recent_context: {{recent_context}}

hard_rules:
- do not just restate the match report
- include one sharp opinion or joke
- include one forward-looking hook
- keep spoken rhythm natural
- output valid JSON only
```

Validation goal:

- reject if it feels like a dry recap
- reject if it lacks host personality
- reject if there is no next-step hook

### Big-tech prompt skeleton

System intent:

- produce sharp but controlled commentary on Chinese big-tech and vehicle/AI companies
- separate factual digest from opinionated framing
- avoid unsupported allegations
- keep spoken rhythm suitable for `60-90s`

User prompt template:

```text
program: china-bigtech-daily-commentary
entity: {{entity_label}}
headline: {{headline}}
summary: {{summary}}
source: {{source}}
recent_context: {{recent_context}}

hard_rules:
- facts go in summary_facts
- commentary goes in commentary_script
- mark rumors as unconfirmed in wording
- include one sharp angle and one forward-looking hook
- do not output defaming or unsupported claims
- output valid JSON only
```

Validation goal:

- reject if it reads like a press release
- reject if it makes aggressive unsupported claims
- reject if it lacks a clear hook

## Config files to add

Recommended config paths:

- `config/topic-stream/football_clubs.example.yaml`
- `config/topic-stream/china_bigtech_entities.example.yaml`

Recommended config fields:

- `entity_key`
- `label`
- `aliases`
- `priority_weight`
- `enabled`
- `image_query`
- `fallback_keywords`
- `league` or `sector`
- `tone_notes`

## Practical next step

If implementation starts, the first milestone should be:

1. define one generic topic feed contract
2. define two whitelists:
   - `football_clubs.yaml`
   - `china_bigtech_entities.yaml`
3. implement two collectors that emit the same normalized topic rows
4. reuse one commentary generator, one validator, one MP3 generator, one VM push flow, and one mobile player
