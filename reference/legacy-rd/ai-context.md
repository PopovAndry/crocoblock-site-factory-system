\# Crocoblock Site Factory — AI Context



\## Goal

Build a multi-agent WordPress/Crocoblock site generator from Blueprint JSON.



\## Current milestone

Stable MVP v0.2 works end-to-end.



\## Pipeline

Blueprint JSON → WP-CLI → Factory MU-plugin → Adapters → WordPress site



\## Current adapters

\- Factory\_Plugin\_Adapter

\- Factory\_Theme\_Adapter

\- Factory\_WP\_Core\_Adapter

\- Factory\_JetEngine\_Adapter

\- Factory\_JetEngine\_Listing\_Adapter

\- Factory\_Render\_Adapter

\- Factory\_Single\_Adapter



\## Working URLs

\- /properties/

\- /property/modern-apartment-in-berlin/



\## Current working blueprint

Use full `blueprints/real-estate.json` as source of truth.



It includes:

\- theme: Kava

\- plugin: JetEngine

\- site permalink: /%postname%/

\- archive page: /properties/

\- CPT: property

\- meta: price, address, bedrooms

\- demo content

\- listing layout: property-card

\- single layout: property



\## Commands

docker compose run --rm wpcli wp factory apply --allow-root

docker compose run --rm wpcli wp factory validate --allow-root

docker compose run --rm wpcli wp factory fix --allow-root



\## Next step

AI-ready Blueprint Generator:

User prompt → structured blueprint JSON → factory apply → validate → report.

