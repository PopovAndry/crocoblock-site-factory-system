# Crocoblock Capability Research v1

## Purpose

This document summarizes Crocoblock capability research for **Crocoblock Site Factory**.

It is an architecture and product research document, not an implementation plan and not runtime code.

The goal is to define how Site Factory can evolve from a single Real Estate beta into a multi-vertical Crocoblock-powered site engine.

## Product direction

Crocoblock Site Factory should not be a generic “AI page generator”.

It should become a blueprint-first system that creates dynamic WordPress/Crocoblock sites through a safe pipeline:

```text
User input / Business intent
→ BlueprintCandidate / BlueprintPatch
→ Core Normalize
→ Core Validate
→ Core Preview
→ Plugin Dry-run
→ Ownership Check
→ User Confirmation
→ Plugin Apply
→ Runtime Validation
→ Manifest / Proof
→ Doctor / Fix
```

Core remains pre-runtime.

The WordPress plugin remains the runtime cockpit.

Crocoblock plugins provide the actual site-building capabilities.

AI must propose changes only. AI must not directly apply changes to WordPress.

---

## Executive summary

The strongest product direction is:

```text
JetEngine + JetSmartFilters + JetFormBuilder
```

as the core multi-vertical foundation.

This stack covers:

* structured content models;
* CPTs;
* custom fields;
* taxonomies;
* listings;
* dynamic fields/images/links;
* queries;
* filters;
* forms;
* frontend editing paths;
* request/lead flows;
* validation/proof opportunities.

For retail verticals, the product needs a separate commerce layer:

```text
WooCommerce + JetWooBuilder
```

For hourly service verticals:

```text
JetAppointment
```

For date-range rental/reservation verticals:

```text
JetBooking
```

The product should not force all verticals into a Real Estate schema. Real Estate is the first proof vertical, not the architecture itself.

---

## Source boundary

Official Crocoblock and JetFormBuilder documentation mostly describes UI/dashboard workflows, feature capabilities, and plugin configuration paths.

It does not always provide a stable, general-purpose, public automation API for programmatically creating every JetEngine, JetSmartFilters, JetWooBuilder, JetAppointment, or JetBooking structure.

Therefore, every automated adapter should follow this rule:

```text
Official docs
→ storage/code inspection
→ small runtime experiment
→ adapter contract
→ dry-run
→ apply
→ validation proof
```

Do not assume that every dashboard feature is safe to automate.

Do not build adapters from guesses.

---

## Strategic product model

### Core owns

* Blueprint contracts
* BlueprintCandidate
* BlueprintPatch
* Normalization
* Validation
* Review Plan
* Formatted Review
* Core Preview Response
* AI-safe proposal models
* DesignProfile contracts
* Ownership policy vocabulary
* Future schema definitions

### Plugin owns

* Adapter registry
* Runtime dry-run
* Runtime apply
* Runtime validation
* Ownership markers
* Manifest/run storage
* Doctor/Fix
* REST endpoints
* Dashboard UI
* WordPress/Crocoblock API calls

### Crocoblock plugins provide

* Dynamic data structures
* Listings
* Filters
* Forms
* WooCommerce templates
* Appointments
* Bookings
* Dynamic visibility
* Options
* Maps
* Relations
* Frontend edit/write paths

---

# 1. Crocoblock capability map

Legend:

* **Y** — suitable for controlled adapter design.
* **P** — partially suitable; requires experiments or constraints.
* **N** — not safe for early automation.
* **Low/Medium/High** — automation risk, not feature value.

| Capability                           | Plugin                   | What it does                                                                                       | Relevant verticals                           | Blueprint section                      | Adapter needed                        | Can plan? | Can apply? | Can validate? | Frontend editable?   | Risk        | Notes                                                                  |
| ------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------- | --------- | ---------- | ------------- | -------------------- | ----------- | ---------------------------------------------------------------------- |
| CPT / Custom Content Types           | JetEngine / WP Core      | Main business entities such as properties, doctors, vehicles, jobs, services                       | All directory/catalog verticals              | `content_model`, `cpt`                 | WP Core / JetEngine structure adapter | Y         | Y          | Y             | P                    | Low         | Foundation of the multi-vertical engine.                               |
| Meta Boxes / Meta Fields             | JetEngine                | Structured entity fields: price, address, duration, doctor experience, mileage, gallery, map, etc. | All                                          | `fields`, `meta_boxes`                 | JetEngine Meta adapter                | Y         | P          | Y             | Y                    | Medium      | Must support only validated field types first.                         |
| Taxonomies / Terms                   | JetEngine / WP Core      | Categories, districts, specialties, job types, product-like classification                         | All                                          | `taxonomies`, `terms`                  | Taxonomy adapter                      | Y         | Y          | Y             | P                    | Low         | Core catalog/filter foundation.                                        |
| Relations                            | JetEngine                | Entity relationships: doctor-service, property-agent, company-job                                  | Clinic, Real Estate, Job Board, Directory    | `relations`                            | Relations adapter                     | Y         | P          | Y             | P                    | Medium/High | Very important, but should be MVP+ after structure/listing stability.  |
| Listings / Listing Grid              | JetEngine                | Cards, grids, archive items, dynamic item templates                                                | All                                          | `listings`, `components`               | Listing adapter                       | Y         | P          | Y             | N                    | Medium      | Main visual output layer. Should use validated template variants.      |
| Query Builder                        | JetEngine                | Declarative queries for posts, products, users, terms, SQL, relations, etc.                        | All                                          | `queries`                              | Query adapter                         | Y         | P          | Y             | N                    | Medium      | Key bridge between blueprint and dynamic sections.                     |
| Dynamic Field/Image/Link             | JetEngine                | Renders meta, images, links, options, query variables                                              | All                                          | `components.dynamic_*`                 | Render/component adapter              | Y         | P          | Y             | Data source editable | Low/Medium  | Use controlled component variants, not arbitrary HTML.                 |
| Dynamic Visibility                   | JetEngine                | Conditional display rules                                                                          | All                                          | `visibility_rules`                     | Visibility adapter                    | Y         | P          | Y             | N                    | Medium      | Good for sale/rent states, empty fields, out-of-stock, booking status. |
| Options Pages                        | JetEngine                | Site-wide business info: phone, address, social links, hours, global CTA                           | All                                          | `business_profile`, `global_settings`  | Options adapter                       | Y         | P          | Y             | Y, later             | Medium      | High value for frontend edit and assistant.                            |
| Glossary                             | JetEngine                | Reusable value-label lists: colors, sizes, fuel types, statuses                                    | Auto, Store, Directory, Forms                | `glossaries`, `vocabularies`           | Glossary adapter                      | Y         | P          | Y             | Rarely               | Medium      | Useful for normalized option sets.                                     |
| Maps / Location                      | JetEngine + SmartFilters | Map listings, geo fields, distance filters                                                         | Real Estate, Auto, Clinic, Directory         | `maps`, `location`, `filters.location` | Map adapter                           | Y         | P          | P             | N                    | High        | API keys/provider setup makes it risky for MVP.                        |
| Profile Builder                      | JetEngine                | User account/dashboard/profile pages                                                               | Job Board, Directory, Marketplace-like flows | `profiles`, `account_experience`       | Profile adapter                       | Y         | P          | Y             | Y                    | High        | Later; useful for user-generated content flows.                        |
| JetSmartFilters basics               | JetSmartFilters          | Select, checkbox, radio, search, range, sorting filters                                            | All catalogs                                 | `filters`                              | SmartFilters adapter                  | Y         | P          | Y             | N                    | Medium/High | Major catalog wow; must control provider/query binding.                |
| JetSmartFilters providers / Query ID | JetSmartFilters          | Binds filters to listings, Woo grids, maps, query providers                                        | All catalogs                                 | `filters.provider`, `query_id`         | SmartFilters adapter                  | Y         | P          | Y             | N                    | High        | Critical failure point; must validate.                                 |
| Active Filters / Reset / Tags        | JetSmartFilters          | User-facing filter UX                                                                              | Catalogs/stores                              | `filters.ui`                           | SmartFilters adapter                  | Y         | P          | Y             | N                    | Medium      | Good MVP enhancement after basic filters.                              |
| Forms                                | JetFormBuilder           | Contact, request, application, quote, edit forms                                                   | All                                          | `forms`                                | JetFormBuilder adapter                | Y         | P          | Y             | Y                    | Medium      | Business action layer.                                                 |
| Hidden Fields / Dynamic Values       | JetFormBuilder           | Current post/user/entity values                                                                    | All request/edit flows                       | `forms.hidden_fields`                  | Form adapter                          | Y         | P          | Y             | N                    | Medium      | Required for request viewing, appointment, frontend edit.              |
| Insert/Update Post                   | JetFormBuilder           | Frontend create/update CPT posts                                                                   | Job Board, Directory, frontend edit          | `frontend_edit`, `forms.actions`       | Form/edit adapter                     | Y         | P          | Y             | Y                    | High        | Must be ownership/permission gated.                                    |
| Update User / Options / Terms        | JetFormBuilder           | Frontend account, global options, terms editing                                                    | Directory, profiles, global settings         | `frontend_edit_map`                    | Form/edit adapter                     | Y         | P          | Y             | Y                    | High        | Powerful but needs strict permissions.                                 |
| Woo Products                         | WooCommerce              | Products, prices, stock, categories, attributes                                                    | Clothing, Souvenir, Pizzeria                 | `commerce.products`                    | Woo product adapter                   | Y         | P          | Y             | Y, admin only        | Medium/High | Use Woo-native model for commerce verticals.                           |
| JetWooBuilder templates              | JetWooBuilder            | Product archive, single, cart, checkout, account, thank-you templates                              | Retail/food                                  | `commerce.templates`                   | JetWoo adapter                        | Y         | P          | Y             | N                    | Medium/High | Product display is good; checkout customization is risky.              |
| JetAppointment                       | JetAppointment + JFB     | Services, providers, slots, appointments, workflows                                                | Clinic, Barbershop, Beauty                   | `appointments`                         | Appointment adapter                   | Y         | P          | Y             | P                    | High        | Later/pro after forms and relations stabilize.                         |
| JetBooking                           | JetBooking + JFB         | Date-range rentals, units, availability, bookings                                                  | Rentals, rooms, cars, spaces                 | `bookings`                             | Booking adapter                       | Y         | P          | Y             | P                    | High        | Separate from appointments; do not mix.                                |

---

# 2. Plugin-by-plugin conclusions

## JetEngine

JetEngine is the core runtime target for most non-commerce dynamic sites.

It should power:

* Real Estate
* Auto Dealer
* Medical Clinic
* Barbershop
* Job Board
* Service Directory
* General catalogs

MVP-safe JetEngine layer:

* CPT
* Taxonomies
* Terms
* Basic meta fields
* Content posts
* Listings via validated variants
* Archive/single render via existing adapters
* Basic Query Builder recipes after experiments

Later/pro JetEngine layer:

* Relations
* Profile Builder
* Data Stores
* Maps
* Glossary automation
* CCT
* Advanced dynamic visibility
* Dynamic tables/charts

Important rule:

```text
Do not generate arbitrary templates.
Use validated component variants.
```

## JetSmartFilters

JetSmartFilters is the highest-impact catalog UX upgrade.

It should be implemented through controlled recipes first:

* one provider per page;
* explicit Query ID;
* known filter types;
* known source types;
* validation checks.

MVP-safe filter types:

* Select
* Checkbox
* Range
* Search
* Sorting
* Active filters / reset

High-risk areas:

* multiple providers on one page;
* Query ID mismatch;
* location/distance;
* indexer rules;
* Woo Product Loop limitations;
* URL aliases/permalink behavior.

## JetFormBuilder

JetFormBuilder should become the main write/action layer.

It should power:

* Request Viewing
* Contact
* Appointment request
* Quote request
* Job application
* Submit listing
* Frontend edit forms
* Woo product edit basics later

MVP-safe forms:

* Contact form
* Request Viewing form
* Request Quote form
* Simple application form
* Thank-you redirect

Risky/later:

* Update User
* Update Options
* Booking update
* Complex calculated fields
* Payments/checkout actions
* Public post submission without moderation

Frontend edit should use JetFormBuilder-driven structured forms, not a free inline editor.

## WooCommerce + JetWooBuilder

WooCommerce should be the source of truth for commerce verticals.

Use Woo-native:

* products;
* categories;
* tags;
* attributes;
* stock;
* cart;
* checkout.

Use JetWooBuilder for:

* product archive templates;
* product single templates;
* product grids/cards;
* category tiles;
* shop presentation.

Do not over-generate checkout in MVP.

Keep checkout native/stable first.

## JetAppointment vs JetBooking

Do not mix these.

```text
JetAppointment = hourly services
JetBooking = date-range rentals
```

JetAppointment fits:

* Medical Clinic
* Barbershop
* Beauty Salon
* Consultations

JetBooking fits:

* Rental properties
* Hotel/rooms
* Car rentals
* Equipment rentals
* Workspaces

They need different blueprint sections:

```text
appointments
bookings
```

---

# 3. Vertical-by-vertical map

## Real Estate

Core model:

* CPT: `property`
* optional later: `agent`, `agency`
* taxonomies: `property_type`, `purpose`, `district`, `amenities`, `status`
* meta: price, address, area, bedrooms, bathrooms, floor, year, gallery, map, featured flag
* listings: property card, featured properties, similar properties
* filters: type, purpose, district, price, bedrooms, search, sorting
* forms: request viewing, contact agency, list property
* images: local property image pool + user upload
* design: premium catalog, strong cards, gallery single, CTA
* frontend edit: title, price, address, status, description, gallery
* proof: CPT exists, fields exist, content count, filters connected, form connected

Plugins:

* JetEngine
* JetSmartFilters
* JetFormBuilder
* Maps later
* JetBooking only for rental/reservation scenario

Priority:

```text
Current first vertical slice
```

## Medical Clinic

Core model:

* CPT: `doctor`, `service`, `department`
* taxonomies: specialty, branch, service category
* relations: department → service → doctor
* meta: doctor credentials, experience, languages, price, duration, branch, photo
* listings: doctor cards, service cards, department sections
* filters: specialty, department, branch, price, search
* forms: appointment request, callback, ask doctor
* appointment: JetAppointment later
* images: doctors, clinic interior, service icons
* design: clean, trust, medical calm
* frontend edit: doctor bio, service price, duration, photo
* proof: relations valid, forms connected, appointment model later

Plugins:

* JetEngine
* JetSmartFilters
* JetFormBuilder
* JetAppointment later

Priority:

```text
Strong relational/service vertical after catalog stability
```

## Barbershop / Beauty Salon

Core model:

* CPT: `service`, `specialist`, `portfolio_item`
* taxonomies: service category, specialist role, branch
* relations: service ↔ specialist, specialist → portfolio
* meta: price, duration, experience, gallery, social links
* listings: service cards, specialist cards, portfolio gallery
* filters: service category, specialist, price
* forms: booking request, callback, gift certificate
* appointment: JetAppointment later
* frontend edit: service price, duration, staff bio, portfolio images

Plugins:

* JetEngine
* JetFormBuilder
* JetSmartFilters
* JetAppointment later

Priority:

```text
Good service vertical after Real Estate / Auto
```

## Clothing Store

Core model:

* Woo product source of truth
* categories: product categories
* attributes: size, color, material, brand, season
* templates: product archive, single product, product card
* filters: category, size, color, price, brand, search, sorting
* forms: contact, size help, back-in-stock later
* frontend edit: product title, price, image, stock, attributes — admin only
* proof: products exist, attributes exist, filters connected, cart/checkout available

Plugins:

* WooCommerce
* JetWooBuilder
* JetSmartFilters
* JetFormBuilder

Priority:

```text
First commerce vertical after non-commerce foundation
```

## Pizzeria / Food Delivery

Core model:

* Woo products for menu items
* categories: pizza, drinks, sides, desserts
* attributes: size, crust, spicy, vegetarian, allergens
* templates: menu/product grid, product single, category sections
* filters: category, vegetarian/spicy, price, search
* forms: catering request, contact
* checkout: Woo native first
* appointment/reservation: later, separate
* frontend edit: menu price, description, image, availability

Plugins:

* WooCommerce
* JetWooBuilder
* JetSmartFilters
* JetFormBuilder
* JetAppointment optional for table reservation

Priority:

```text
Commerce/food vertical after retail basics
```

## Souvenir / Gift Shop

Core model:

* Woo products
* categories: gifts, handmade, occasions, recipient types
* attributes: material, color, personalization, recipient, occasion
* templates: product grid, gift guide, category tiles
* filters: occasion, recipient, price, material, color
* forms: personalization request, corporate gifts
* frontend edit: product basics, stock, images

Plugins:

* WooCommerce
* JetWooBuilder
* JetSmartFilters
* JetFormBuilder

Priority:

```text
Simpler commerce vertical after Clothing Store
```

## Auto Dealer

Core model:

* CPT: `vehicle`
* optional: `dealer`, `salesperson`
* taxonomies: brand, model, fuel type, transmission, body type, location
* meta: price, mileage, year, engine, VIN/stock ID, gallery, condition
* listings: vehicle cards, featured vehicles, similar vehicles
* filters: brand/model, price, year, mileage, fuel, transmission, search
* forms: test drive request, trade-in request, ask about vehicle
* frontend edit: price, mileage, status, gallery, description
* proof: specs present, filters connected, form records

Plugins:

* JetEngine
* JetSmartFilters
* JetFormBuilder
* Maps later

Priority:

```text
Recommended second catalog vertical because it proves the engine is not Real Estate-only
```

## Job Board / Directory

Core model:

* CPT: `job`, `company`
* optional: `candidate_profile`
* relations: company → jobs, user → company, candidate → applications later
* meta: salary, location, remote type, deadline, company logo, industry
* filters: job type, location, salary, remote, search
* forms: apply, submit job, edit company profile
* frontend edit: job/company fields with strict ownership
* profile builder: later

Plugins:

* JetEngine
* JetSmartFilters
* JetFormBuilder
* Profile Builder later
* WooCommerce optional for paid listings

Priority:

```text
Strong later vertical for frontend accounts and user-generated content
```

---

# 4. Recommended engine categories

Instead of thinking in “templates”, Site Factory should think in **business engines**.

## Property / Inventory Catalog Engine

Verticals:

* Real Estate
* Auto Dealer
* Equipment rentals
* Directories

Core capabilities:

* CPT
* meta fields
* taxonomies
* listings
* filters
* request forms
* gallery
* maps later

## Appointment Business Engine

Verticals:

* Medical Clinic
* Barbershop
* Beauty Salon
* Consultations

Core capabilities:

* services
* providers
* specialist profiles
* appointment request
* JetAppointment later
* filters
* staff/service listings

## Commerce Store Engine

Verticals:

* Clothing Store
* Souvenir Shop
* Cosmetics
* Furniture

Core capabilities:

* Woo products
* categories
* attributes
* product archive/single
* filters
* cart/checkout native first

## Food Menu / Delivery Engine

Verticals:

* Pizzeria
* Cafe
* Restaurant
* Sushi delivery

Core capabilities:

* Woo products or menu CPT depending business model
* menu categories
* add-to-cart
* catering/contact forms
* reservation later

## Directory / Job Board Engine

Verticals:

* Job Board
* Business Directory
* Specialist Directory

Core capabilities:

* multiple CPTs
* relations
* frontend submission/edit
* filters
* profile/account pages later

---

# 5. Blueprint schema implications

Current blueprint should evolve toward these sections:

```text
vertical
business_profile
design_profile
content_model
fields
taxonomies
relations
glossaries
media_strategy
queries
listings
templates
filters
forms
commerce
appointments
bookings
frontend_edit_map
ownership_policy
validation_plan
proof_manifest
assistant_capabilities
```

## `vertical`

Defines business type and enabled capability groups.

Examples:

```text
real_estate
auto_dealer
medical_clinic
barbershop
clothing_store
pizzeria
souvenir_shop
job_board
service_business
```

## `business_profile`

Stores global business information:

* business name
* city/region
* phone
* email
* address
* opening hours
* logo
* social links
* global CTA

Runtime target:

* JetEngine Options Pages or WordPress options.

## `design_profile`

Must not be arbitrary CSS.

Should reference validated profiles and component variants:

```text
premium_agency
minimal_urban
family_friendly
medical_clean
barber_dark
fashion_minimal
food_warm
gift_soft
vehicle_inventory
```

## `content_model`

Describes CPTs / products / user entities.

Must distinguish:

* JetEngine CPT
* Woo product
* user profile
* term
* booking/appointment record

## `filters`

Needs explicit provider contract:

* provider type;
* query ID;
* target listing/grid/page;
* source: taxonomy/meta/manual/glossary/query;
* apply type: AJAX/page reload/mixed;
* validation rules.

## `forms`

Needs explicit field/action contract:

* fields;
* hidden fields;
* dynamic defaults;
* post-submit actions;
* email recipients;
* redirect behavior;
* record storage;
* permissions;
* anti-spam;
* ownership mapping.

## `frontend_edit_map`

Must be whitelist-based.

Example fields:

* entity type;
* entity key;
* storage target;
* editable fields;
* permission rule;
* ownership state;
* sync policy;
* validation after save.

## `commerce`

Separate from CPT.

Should include:

* product types;
* categories;
* attributes;
* product card variants;
* archive/single templates;
* checkout mode;
* shipping/payment assumptions.

## `appointments` and `bookings`

Keep separate.

Appointments:

* services;
* providers;
* schedules;
* slots;
* workflows.

Bookings:

* booking item;
* date range;
* availability;
* units;
* pricing;
* optional services.

## `validation_plan`

Entity-aware validation plan.

Should include checks for:

* entities created;
* fields registered;
* terms exist;
* relations valid;
* listings bound;
* queries return results;
* filters bound to provider/query;
* forms contain required hidden fields;
* form actions configured;
* Woo pages exist;
* appointment/booking bindings exist;
* ownership markers present.

## `proof_manifest`

Structured evidence after apply.

Should store:

* entity IDs;
* slugs;
* field keys;
* relation IDs;
* listing IDs;
* query IDs;
* filter-provider bindings;
* page/template assignments;
* form IDs;
* action maps;
* validation timestamps;
* ownership decisions;
* skipped/locked fields;
* warnings and errors.

---

# 6. Frontend editing and ownership

Frontend edit mode should not be an Elementor clone.

It should be:

```text
structured frontend editing for generated Crocoblock entities
```

The safest path is JetFormBuilder-driven editing, because it has documented action paths for posts, users, options, terms, Woo products, and bookings.

## Safe early editable fields

| Field                       | Storage                         | Safe early?     | Notes                               |
| --------------------------- | ------------------------------- | --------------- | ----------------------------------- |
| Title                       | `post_title`                    | Yes             | Use ownership and capability checks |
| Description                 | `post_content` or meta textarea | Yes             | Diff and sanitize                   |
| Price                       | post meta / Woo price           | Yes, admin only | Validate numeric format             |
| Status                      | taxonomy/meta                   | Yes             | Whitelist values                    |
| Featured image              | `_thumbnail_id`                 | Later           | Media permissions                   |
| Gallery                     | JetEngine gallery meta          | Later           | Storage experiment                  |
| Taxonomies                  | WP terms                        | Yes carefully   | Only allowed taxonomies             |
| Woo attributes              | Woo product attributes          | Later           | Variation complexity                |
| Options page values         | JetEngine options               | Later           | Site-wide risk                      |
| Relations                   | JetEngine relations             | Later           | Requires relation adapter           |
| Booking/appointment records | Plugin storage                  | Later/Pro       | High risk                           |

## Ownership model

Every generated entity should carry ownership metadata:

* factory-managed marker;
* source blueprint key;
* source hash;
* last applied manifest ID;
* user-modified state;
* locked/frozen field list;
* assistant-safe editable whitelist.

Better than one global ownership flag:

```text
blueprint_managed
user_managed
mixed
locked
unknown
```

at the field or field-group level.

## Safe sync policy

Apply should use a three-way comparison:

```text
desired blueprint state
current runtime state
user-owned overrides
```

If a field is user-managed, the system must not overwrite it automatically.

It should show:

```text
This field was edited manually.
Keep user version?
Replace with generated version?
Create variant?
Lock field?
```

---

# 7. Adapter roadmap

## MVP / high priority

| Adapter                            | Scope                                            | Priority  |
| ---------------------------------- | ------------------------------------------------ | --------- |
| `jetengine_structure_adapter`      | CPT, taxonomies, meta boxes, options, glossaries | Very high |
| `jetengine_listing_adapter`        | Listings, cards, dynamic fields/images/links     | Very high |
| `jetengine_query_adapter`          | Query Builder recipes and validation             | High      |
| `jetsmartfilters_adapter`          | Select/checkbox/range/search/sorting filters     | Very high |
| `jetformbuilder_schema_adapter`    | Form structure, fields, hidden fields            | Very high |
| `jetformbuilder_action_adapter`    | Email, redirect, request actions                 | High      |
| `business_profile_options_adapter` | Global business info / options pages             | High      |
| `media_gallery_adapter`            | Images, galleries, image pools                   | High      |
| `proof_manifest_adapter`           | Evidence capture and validation results          | Very high |

## MVP+ / phase 2

| Adapter                   | Scope                                          | Priority    |
| ------------------------- | ---------------------------------------------- | ----------- |
| `frontend_edit_adapter`   | Whitelisted structured frontend editing        | High        |
| `relations_adapter`       | Entity relationships                           | Medium/High |
| `woo_product_adapter`     | Products, categories, attributes, stock basics | Medium/High |
| `jetwoo_catalog_adapter`  | Product archive/single/cards                   | Medium      |
| `map_adapter`             | Location fields and map listings               | Medium      |
| `profile_builder_adapter` | Account/profile dashboards                     | Later       |

## Later / Pro

| Adapter                       | Scope                                             | Priority  |
| ----------------------------- | ------------------------------------------------- | --------- |
| `jetappointment_adapter`      | Services, providers, schedules, appointment forms | Later/Pro |
| `jetbooking_adapter`          | Date-range bookings, units, availability, pricing | Later/Pro |
| `woo_checkout_adapter`        | Checkout/cart/account template customization      | Later/Pro |
| `advanced_visibility_adapter` | Complex dynamic visibility rules                  | Later     |
| `data_store_adapter`          | Favorites/recently viewed                         | Later     |

---

# 8. MVP priority list

## Nearest product value

1. Real Estate Smart Filters:

   * purpose;
   * property type;
   * district;
   * price;
   * bedrooms;
   * search;
   * sorting.

2. Request Viewing Form:

   * hidden property ID;
   * current property title/link;
   * email notification;
   * thank-you redirect;
   * form record/proof.

3. Business Profile Options:

   * phone;
   * email;
   * address;
   * social links;
   * opening hours;
   * global CTA.

4. Controlled Design Profiles:

   * premium agency;
   * minimal urban;
   * family friendly;
   * no arbitrary CSS.

5. Frontend Edit v0:

   * property title;
   * price;
   * description;
   * status;
   * address;
   * ownership-aware.

6. Second catalog vertical:

   * Auto Dealer is safer than Clinic for the next proof because it reuses catalog/filter logic without appointment complexity.

7. Clinic vertical after relations spike:

   * department → service → doctor;
   * appointment request fallback first;
   * JetAppointment later.

---

# 9. Risks and unknowns

## Automation API uncertainty

Official docs confirm features but often describe UI/dashboard workflows.

Many adapters require:

* code inspection;
* DB/storage inspection;
* manual setup experiment;
* export/import review;
* runtime validation design.

## SmartFilters provider risk

Filter/provider/query ID mismatch can silently break catalog UX.

Start with one provider per page and controlled recipes.

## WooCommerce complexity

Product categories and simple products are reasonable.

Variable products, checkout templates, payment/shipping logic are high-risk and should be later/pro.

## Appointment and booking complexity

Schedules, providers, capacity, recurring appointments, booking units, pricing, sync and payments are too complex for early MVP.

## Frontend editing security

Update Post/User/Options/Term/Product actions are powerful.

They need:

* role/capability checks;
* nonces;
* ownership markers;
* field whitelist;
* validation after save;
* manifest change log.

## Medical content risk

AI must not invent medical credentials, diagnoses, guarantees, prices, or treatment claims.

Clinic assistant should be conservative and require user confirmation for sensitive content.

## Maps/API keys

Map listings and location filters require provider/API key setup.

Do not hide this behind invisible auto-apply.

---

# 10. Recommended research / implementation order

1. Save this canonical research document in:

```text
docs/research/crocoblock-capability-research-v1.md
```

2. Create architecture document:

```text
docs/architecture/crocoblock-adapter-roadmap.md
```

3. Run JetSmartFilters research spike:

```text
manual create filters
inspect storage/export
document stable contract
then implement adapter
```

4. Run JetFormBuilder schema capture spike:

```text
Request Viewing form
hidden property_id/current post
email action
redirect/thank-you
records
validation
```

5. Define `frontend_edit_map` contract:

```text
entity
field
storage
permission
ownership
sync policy
validation after save
```

6. Run Auto Dealer vertical prototype:

```text
vehicle CPT
brand/model taxonomies
price/year/mileage filters
test drive form
proof
```

7. Run Clinic relations prototype:

```text
department
service
doctor
relations
appointment request fallback
```

---

# 11. Final positioning

Crocoblock Site Factory should be positioned as:

```text
Describe a business.
Get a validated Crocoblock-powered dynamic website.
Safely evolve it with previews, proof, frontend editing, and an assistant.
```

The strongest product difference is not AI generation by itself.

The strongest product difference is:

```text
dynamic Crocoblock structure
+
preview before apply
+
runtime validation
+
manifest/proof
+
ownership-safe editing
+
assistant proposals instead of direct mutation
```

This is the path from Real Estate beta to a true multi-vertical Site Factory.
