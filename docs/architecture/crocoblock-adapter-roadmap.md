# Crocoblock Adapter Roadmap

## Purpose

This document converts `docs/research/crocoblock-capability-research-v1.md` into an actionable adapter roadmap for Crocoblock Site Factory.

It defines which Crocoblock-related adapters should be built first, which should be delayed, and what each adapter must be able to plan, apply, validate, and report.

This is an architecture roadmap, not an implementation task.

## Product boundary

Crocoblock Site Factory is a blueprint-first system.

The responsibility split stays unchanged:

```text
Core
→ contracts, normalization, validation, preview, AI-safe proposals

WordPress Plugin
→ dry-run, ownership check, apply, runtime validation, manifest, doctor/fix, dashboard

Crocoblock Plugins
→ actual WordPress/Crocoblock structures and runtime behavior
```

Core must not execute WordPress or Crocoblock runtime logic.

Adapters belong to the WordPress plugin runtime layer.

## Adapter principles

Every adapter must follow the same lifecycle:

```text
Blueprint section
→ Plan
→ Dry-run item
→ Apply after confirmation
→ Runtime validation
→ Manifest/proof evidence
```

No adapter should directly mutate runtime state without:

1. Blueprint input.
2. Dry-run output.
3. Ownership check where applicable.
4. User confirmation for destructive or overwrite-prone changes.
5. Validation after apply.
6. Manifest evidence.

## General adapter contract

Each runtime adapter should eventually support:

```text
supports()
plan()
apply()
validate()
explain()
capabilities()
```

Where:

* `supports()` confirms whether the blueprint section is relevant.
* `plan()` returns expected create/update/skip/warning/error items.
* `apply()` performs runtime changes only after approved execution.
* `validate()` proves runtime state matches the blueprint.
* `explain()` provides user-facing or developer-facing descriptions.
* `capabilities()` exposes read-only adapter capabilities for dashboard/Core bridge use.

## MVP adapters

These adapters are required for the nearest practical multi-vertical product.

### 1. JetEngine Structure Adapter

Scope:

* CPTs
* taxonomies
* terms
* meta boxes
* supported meta fields
* basic options pages
* basic glossaries later

Blueprint sections:

```text
content_model
cpt
taxonomies
terms
fields
meta_boxes
business_profile
glossaries
```

Priority:

```text
Very high
```

Why:

JetEngine structure is the foundation of most non-commerce verticals:

* Real Estate
* Auto Dealer
* Medical Clinic
* Barbershop
* Job Board
* Service Directory

Plan output should show:

```text
+ Create CPT: property
+ Create taxonomy: district
+ Create meta field: price
= Meta field up-to-date: address
~ Update field label: area
```

Validation should check:

* CPT exists.
* Taxonomies exist.
* Terms exist.
* Meta boxes exist.
* Field keys exist.
* Field types match expected supported types.
* No missing required entity definitions.

Risk:

```text
Low / Medium
```

Notes:

Start with validated field types only:

* text
* textarea
* number
* select
* radio
* checkbox
* switcher
* media
* gallery later
* map later
* repeater later

Do not implement every JetEngine field type in v1.

---

### 2. JetEngine Listing Adapter

Scope:

* listing templates
* listing cards
* dynamic fields
* dynamic images
* dynamic links
* listing grid bindings
* controlled component variants

Blueprint sections:

```text
listings
components
templates
design_profile
```

Priority:

```text
Very high
```

Why:

Listings are the visible layer of dynamic sites.

They power:

* property cards
* vehicle cards
* doctor cards
* service cards
* job cards
* product-like directory cards

Plan output should show:

```text
+ Create listing: Property Card
~ Update listing variant: premium_property_card
= Listing up-to-date: Vehicle Card
```

Validation should check:

* Listing exists.
* Listing has the expected source post type.
* Required dynamic fields are present.
* Required dynamic images/links are present.
* Listing is connected to expected page/render block where possible.

Risk:

```text
Medium
```

Notes:

Do not generate arbitrary layout.

Use validated component variants:

```text
property_card_v1
vehicle_card_v1
doctor_card_v1
service_card_v1
product_card_v1
job_card_v1
```

---

### 3. JetEngine Query Adapter

Scope:

* query recipes
* query IDs
* query result checks
* dynamic sections powered by queries

Blueprint sections:

```text
queries
```

Priority:

```text
High
```

Why:

Queries power dynamic homepage sections, related content, featured items, latest items, and filtered catalogs.

Plan output should show:

```text
+ Create query: featured_properties
~ Update query: vehicles_by_brand
= Query up-to-date: latest_jobs
```

Validation should check:

* Query exists.
* Query ID matches blueprint.
* Query source matches expected entity type.
* Query returns valid results or expected empty state.
* Query is compatible with linked listings/filters.

Risk:

```text
Medium
```

Notes:

Start with controlled query recipes:

* latest posts by CPT
* featured items by meta
* taxonomy filtered query
* related by taxonomy
* Woo product query later

Avoid arbitrary SQL query generation in MVP.

---

### 4. JetSmartFilters Adapter v1

Scope:

* select filters
* checkbox filters
* range filters
* search filter
* sorting filter
* reset/active filters
* provider binding
* Query ID binding

Blueprint sections:

```text
filters
```

Priority:

```text
Very high
```

Why:

Filters are one of the clearest user-facing “wow” features.

They make generated sites feel like real catalogs:

* properties
* vehicles
* doctors
* services
* jobs
* products

Plan output should show:

```text
+ Create filter: District
+ Create filter: Price Range
~ Bind filter to provider: Properties Listing Grid
= Filter up-to-date: Search
```

Validation should check:

* Filter exists.
* Filter type matches blueprint.
* Filter source matches taxonomy/meta/manual/glossary source.
* Provider is correct.
* Query ID matches the target listing/query.
* Filtered URL or AJAX behavior does not break the page.
* Reset/active filter widgets exist if declared.

Risk:

```text
High
```

Notes:

This adapter must be built after a storage/API research spike.

Do not start with generalized SmartFilters automation.

Start with one controlled provider per page.

MVP supported filter types:

```text
select
checkboxes
range
search
sorting
reset
active_filters
```

Avoid in v1:

```text
location_distance
complex hierarchical filters
multiple provider grids on one page
advanced indexer automation
custom URL alias rules
```

---

### 5. JetFormBuilder Schema Adapter

Scope:

* forms
* fields
* hidden fields
* dynamic values
* required fields
* simple validation
* submit button
* form records

Blueprint sections:

```text
forms
```

Priority:

```text
Very high
```

Why:

Forms turn generated sites into business tools.

MVP form targets:

* Request Viewing
* Contact Agency
* Ask About Vehicle
* Appointment Request fallback
* Job Application
* Request Quote

Plan output should show:

```text
+ Create form: Request Viewing
+ Add hidden field: property_id
+ Add email field: visitor_email
= Form up-to-date: Contact Agency
```

Validation should check:

* Form exists.
* Required fields exist.
* Hidden current entity field exists.
* Required fields have correct names.
* Form can be embedded/rendered.
* Form records are enabled where expected.

Risk:

```text
Medium
```

Notes:

First research target:

```text
Request Viewing form
```

Required fields:

```text
name
email
phone
message
hidden property_id
hidden property_title
hidden property_url
```

---

### 6. JetFormBuilder Action Adapter

Scope:

* email notifications
* redirect / thank-you page
* insert/update post later
* update options later
* update user later
* form records/proof

Blueprint sections:

```text
forms.actions
```

Priority:

```text
High
```

Why:

A form without correct post-submit actions is incomplete.

Plan output should show:

```text
+ Add email notification: agency_email
+ Add redirect action: thank_you_page
~ Update email subject
```

Validation should check:

* Email action exists.
* Recipient is configured.
* Redirect action exists if declared.
* Thank-you page exists.
* Required hidden values are included in notification.
* Form record/proof is available.

Risk:

```text
Medium / High
```

Notes:

MVP should support:

```text
email
redirect
save_record
```

Later:

```text
insert_update_post
update_user
update_options
update_term
woocommerce_checkout
booking_actions
```

---

### 7. Business Profile / Options Adapter

Scope:

* global business name
* phone
* email
* address
* social links
* opening hours
* global CTA
* logo reference

Blueprint sections:

```text
business_profile
global_settings
site_options
```

Priority:

```text
High
```

Why:

Every vertical needs shared business information.

This enables quick setup with only a few user inputs.

Plan output should show:

```text
+ Create business profile option: phone
~ Update business email
= Global CTA up-to-date
```

Validation should check:

* Option values exist.
* Required global fields are present.
* Values render in expected components where possible.
* Frontend edit map can reference these fields later.

Risk:

```text
Medium
```

Notes:

Options are useful but dangerous when edited from the frontend.

Frontend editing of options should be later and permission-gated.

---

### 8. Media / Gallery Adapter

Scope:

* image pools
* featured images
* galleries
* image assignment by vertical/entity type
* media provenance later

Blueprint sections:

```text
media_strategy
image_context
assets
```

Priority:

```text
High
```

Why:

Generated sites need good images without exhausting the user.

MVP image strategy:

```text
local curated image pool
entity-type based assignment
featured images
simple galleries later
```

Plan output should show:

```text
+ Assign featured image: property/apartment-01
+ Assign gallery images: vehicle-gallery-01
= Image pool available: real-estate
```

Validation should check:

* Image files exist or media attachments exist.
* Featured images are assigned.
* Gallery meta exists if used.
* Missing image fallback is available.

Risk:

```text
Medium
```

Notes:

Do not use AI-generated property photos as real property images without clear labeling.

Image provenance should later be stored in manifest.

---

### 9. Proof Manifest Adapter

Scope:

* evidence capture
* validation result references
* ownership decisions
* skipped/locked fields
* generated entity IDs
* adapter execution trace

Blueprint sections:

```text
proof_manifest
validation_plan
ownership_policy
```

Priority:

```text
Very high
```

Why:

Proof is a product differentiator.

Generated sites should not just say “done”.

They should prove:

```text
CPT exists
fields exist
filters are bound
forms are connected
pages render
ownership is respected
```

Validation should store:

* entity IDs
* slugs
* field keys
* relation IDs
* listing IDs
* query IDs
* filter/provider bindings
* form IDs
* action maps
* validation timestamps
* warnings/errors

Risk:

```text
Low / Medium
```

Notes:

This should stay plugin-side.

Core can define contract shapes but must not perform runtime proof.

---

## MVP+ adapters

These are important but should come after the MVP foundation.

### 10. Frontend Edit Adapter

Scope:

* whitelisted frontend editing
* JetFormBuilder-driven update forms
* field-level ownership
* safe sync to blueprint later

Blueprint sections:

```text
frontend_edit_map
ownership_policy
forms
```

Priority:

```text
High, but after forms and ownership contracts
```

Why:

Frontend edit mode is a major product feature.

But it is also a mutation layer and must be protected.

MVP editable fields:

```text
post_title
post_content
selected post_meta
selected taxonomy terms
price
status
business profile fields later
```

Plan output should show:

```text
+ Create frontend edit form: Edit Property Basics
+ Map field price → post_meta: price
! Field gallery skipped: not supported in edit v0
```

Validation should check:

* Edit form exists.
* Field mapping is whitelisted.
* Permissions are configured.
* Ownership markers are updated after submit.
* User-edited state is recorded.

Risk:

```text
High
```

Notes:

Do not build a free inline editor in MVP.

Use structured forms and editable maps.

---

### 11. Relations Adapter

Scope:

* JetEngine relations
* relation mappings
* related listings
* related queries

Blueprint sections:

```text
relations
```

Priority:

```text
Medium / High
```

Why:

Required for:

* Clinic: department → service → doctor
* Job Board: company → jobs
* Real Estate later: agent → properties
* Directory: business → services

Plan output should show:

```text
+ Create relation: doctor_to_service
+ Connect doctor: Dr Smith → Cardiology Consultation
```

Validation should check:

* Relation exists.
* Relation type matches.
* Expected related items are connected.
* Related listing/query can resolve.

Risk:

```text
Medium / High
```

Notes:

Not required for Real Estate v1 if agent is simplified.

Required before serious Clinic/Job Board verticals.

---

### 12. Woo Product Adapter

Scope:

* Woo products
* categories
* attributes
* simple products
* basic stock/price
* product images

Blueprint sections:

```text
commerce
commerce.products
commerce.categories
commerce.attributes
```

Priority:

```text
Medium / High
```

Why:

Required for:

* Clothing Store
* Souvenir Shop
* Pizzeria / Food Delivery
* Cosmetics
* Furniture

Plan output should show:

```text
+ Create product: Classic T-Shirt
+ Create attribute: Size
~ Update price: Margherita Pizza
```

Validation should check:

* Products exist.
* Product categories exist.
* Attributes exist.
* Product prices exist.
* Stock status exists where expected.
* Product archive/single renders.

Risk:

```text
Medium / High
```

Notes:

Start with simple products.

Variable products and complex variation matrices are later.

---

### 13. JetWoo Catalog Adapter

Scope:

* product card variants
* product archive template
* product single template
* Woo product grids
* category tiles

Blueprint sections:

```text
commerce.templates
commerce.catalog
listings
```

Priority:

```text
Medium
```

Why:

Commerce verticals need polished product presentation.

Plan output should show:

```text
+ Create product archive template
+ Create product card variant: fashion_card_v1
= Product single template up-to-date
```

Validation should check:

* Shop/archive template exists.
* Product single template exists.
* Product grid renders.
* Add-to-cart controls exist.
* Product image/price/title render.

Risk:

```text
Medium / High
```

Notes:

Do not over-customize checkout in v1.

Keep checkout native/stable first.

---

### 14. Map Adapter

Scope:

* map fields
* map listings
* coordinates
* location filters
* provider/API key awareness

Blueprint sections:

```text
maps
location
filters.location
```

Priority:

```text
Medium
```

Why:

High visual value for:

* Real Estate
* Auto Dealer
* Clinic branches
* Directories

Risk:

```text
High
```

Notes:

Map provider/API keys must be explicit.

Do not silently auto-apply map features without provider readiness.

---

## Later / Pro adapters

### 15. Profile Builder Adapter

Scope:

* user account pages
* profile dashboards
* post management pages
* editable user/company profiles

Priority:

```text
Later
```

Best for:

* Job Board
* Directory
* Marketplace-like flows

Risk:

```text
High
```

---

### 16. JetAppointment Adapter

Scope:

* services
* providers
* schedules
* appointment forms
* workflows
* confirmations

Priority:

```text
Later / Pro
```

Best for:

* Medical Clinic
* Barbershop
* Beauty Salon
* Consultations

Risk:

```text
High
```

Notes:

Do not use JetAppointment for date-range rentals.

---

### 17. JetBooking Adapter

Scope:

* booking items
* date ranges
* availability
* units
* pricing
* booking forms
* Woo/plain booking modes

Priority:

```text
Later / Pro
```

Best for:

* Rentals
* Rooms
* Cars
* Equipment
* Workspaces

Risk:

```text
High
```

Notes:

Do not use JetBooking for hourly services.

---

### 18. Woo Checkout Adapter

Scope:

* cart templates
* checkout templates
* account templates
* thank-you templates

Priority:

```text
Later / Pro
```

Risk:

```text
Very high
```

Notes:

Payment, shipping, tax, and gateway logic make checkout customization risky.

Keep native checkout in early commerce MVP.

---

## Adapter dependency graph

Recommended dependency order:

```text
JetEngine Structure
→ Content
→ Listings
→ Queries
→ Filters
→ Forms
→ Form Actions
→ Business Profile / Options
→ Proof Manifest
→ Frontend Edit
→ Relations
→ Commerce
→ Woo Templates
→ Appointments / Bookings
```

For Real Estate:

```text
Structure
→ Content
→ Listings
→ Render/Single
→ Filters
→ Request Viewing Form
→ Business Profile
→ Frontend Edit
```

For Auto Dealer:

```text
Structure
→ Content
→ Listings
→ Filters
→ Test Drive Form
→ Gallery/Media
```

For Clinic:

```text
Structure
→ Relations
→ Listings
→ Filters
→ Appointment Request Form
→ JetAppointment later
```

For Clothing Store:

```text
Woo Products
→ Woo Categories/Attributes
→ Product Cards/Templates
→ Product Filters
→ Native Checkout
```

## Validation requirements

Every adapter must produce validation evidence.

Minimum validation output:

```text
status: ok|warning|error
adapter: adapter_name
entity: human-readable entity
message: validation result
details: structured evidence
```

Required validation categories:

### Structure validation

* CPT exists.
* Taxonomy exists.
* Terms exist.
* Meta box exists.
* Field keys exist.
* Field types match supported schema.

### Listing validation

* Listing exists.
* Listing source matches blueprint.
* Required dynamic fields/images/links exist.
* Listing renders without fatal errors.

### Query validation

* Query exists.
* Query ID matches.
* Query returns expected result count or expected empty state.

### Filter validation

* Filter exists.
* Filter type matches.
* Filter source exists.
* Provider binding exists.
* Query ID matches.
* Target listing/page exists.

### Form validation

* Form exists.
* Required fields exist.
* Hidden fields exist.
* Actions exist.
* Redirect/thank-you page exists if declared.
* Records/proof are available if expected.

### Ownership validation

* Entity has factory marker.
* Entity has blueprint source key/hash.
* User-modified fields are detected.
* Locked fields are skipped.
* Overwrite-prone fields require confirmation.

### Commerce validation

* Products exist.
* Categories exist.
* Attributes exist.
* Product price/stock exists.
* Product archive/single renders.
* Cart/checkout available.

### Appointment / Booking validation

* Services exist.
* Providers exist.
* Schedule exists.
* Booking/appointment form binds correctly.
* Confirmation action exists.
* Availability rules are valid.

## Risk matrix

| Area                   | Risk        | Why                                                | Decision                |
| ---------------------- | ----------- | -------------------------------------------------- | ----------------------- |
| JetEngine CPT/tax/meta | Low/Medium  | WordPress-native concepts plus JetEngine structure | MVP                     |
| Listings               | Medium      | Builder/template storage can be sensitive          | MVP with variants       |
| Query Builder          | Medium      | Query semantics can break if overgeneralized       | MVP with recipes        |
| JetSmartFilters        | High        | Provider/Query ID mismatch can silently break UX   | Research spike first    |
| JetFormBuilder forms   | Medium      | Form block/action schema must be captured          | Research spike first    |
| Frontend edit          | High        | Mutation/security/ownership risk                   | MVP+ after contracts    |
| Relations              | Medium/High | Storage/runtime complexity                         | Phase 2                 |
| Woo products           | Medium/High | Product attributes/variations complexity           | Commerce MVP+           |
| JetWoo checkout        | Very high   | Payments/shipping/tax/gateway risk                 | Later/Pro               |
| JetAppointment         | High        | Schedule/provider/workflow complexity              | Later/Pro               |
| JetBooking             | High        | Availability/units/pricing complexity              | Later/Pro               |
| Maps                   | High        | API keys/geocoding/provider setup                  | Later or explicit setup |

## First implementation candidates

Do not start with a broad adapter.

Start with research spikes.

### Candidate 1: JetSmartFilters research spike

Goal:

```text
Create Real Estate filters manually
inspect storage/export
define stable blueprint filter schema
define validation checks
```

Target filters:

```text
purpose
property_type
district
price_range
bedrooms
search
sorting
reset
active_filters
```

Expected output:

```text
docs/research/jetsmartfilters-storage-spike.md
docs/architecture/jetsmartfilters-adapter-contract.md
```

### Candidate 2: JetFormBuilder Request Viewing schema capture

Goal:

```text
Create Request Viewing form manually
inspect form post content/actions/storage
define form blueprint schema
define validation checks
```

Target fields:

```text
name
email
phone
message
hidden property_id
hidden property_title
hidden property_url
```

Actions:

```text
email notification
redirect to thank-you page
save record
```

Expected output:

```text
docs/research/jetformbuilder-request-viewing-spike.md
docs/architecture/jetformbuilder-form-adapter-contract.md
```

### Candidate 3: Frontend Edit Map contract

Goal:

```text
Define safe mapping from frontend editable fields to runtime storage
```

Target entity:

```text
property
```

Target fields:

```text
title
price
address
description
status
```

Expected output:

```text
docs/architecture/frontend-edit-map-contract.md
```

### Candidate 4: Auto Dealer vertical prototype

Goal:

```text
Prove catalog engine is not Real Estate-specific
```

Target model:

```text
vehicle CPT
brand/model/fuel/transmission/body taxonomies
price/year/mileage meta
filters
test drive form
```

Expected output:

```text
blueprints/presets/auto-dealer.json
adapter validation proof
```

### Candidate 5: Clinic relations prototype

Goal:

```text
Prove relation-based vertical
```

Target model:

```text
department
service
doctor
department → service
service → doctor
appointment request fallback
```

Expected output:

```text
blueprints/presets/medical-clinic.json
relations adapter research
```

## What not to automate yet

Do not automate these until separate research and validation exist:

```text
JetWoo custom checkout generation
complex Woo variable products
payment gateway configuration
shipping/tax rules
JetAppointment full schedule automation
JetBooking advanced pricing/units
map provider/API key setup
public frontend post submission without moderation
Update User / Update Options from public frontend
arbitrary CSS/JS/PHP generation
AI direct apply
```

## Next recommended tasks

1. Save this roadmap as:

```text
docs/architecture/crocoblock-adapter-roadmap.md
```

2. Add:

```text
docs/architecture/frontend-edit-map-contract.md
```

3. Define:

```text
plugin dry-run placeholder contract
ownership placeholder contract
```

4. Start JetSmartFilters storage spike.

5. Start JetFormBuilder Request Viewing schema capture.

6. Only after those, implement first adapter v1.
