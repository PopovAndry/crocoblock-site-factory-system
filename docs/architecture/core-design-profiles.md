# Core Design Profiles

## Purpose

This document defines controlled design profiles for Crocoblock Site Factory.

The goal is to support visual variety without allowing AI to generate arbitrary frontend code, unstable CSS, or unsupported layouts.

Design variation must be structured, validated, and executable by the WordPress/Crocoblock plugin runtime.

## Product context

Crocoblock Site Factory generates dynamic WordPress/Crocoblock sites from blueprints.

The design pipeline should be:

Prompt / user intent
→ DesignProfile selection
→ Core validation
→ Core Preview Plan
→ Plugin Dry-run
→ User confirmation
→ Plugin Apply
→ Runtime validation

## Responsibility split

### Core owns

- Design profile contracts
- Allowed design tokens
- Allowed component variants
- AI-safe design selection
- Design change preview
- Validation of design configuration

### Plugin owns

- Actual frontend rendering
- Elementor/Crocoblock/JetEngine output
- CSS generation or token application
- Template/layout implementation
- Responsive behavior
- Runtime validation of rendered/generated assets

## Important rule

AI should act as a creative director, not as an uncontrolled code generator.

AI may choose:

- profile
- palette
- typography preset
- spacing preset
- radius preset
- component variants
- image mood
- content tone

AI must not directly generate:

- arbitrary CSS
- arbitrary PHP
- arbitrary JavaScript
- unsupported layout structures
- direct WordPress mutations

## Blueprint design shape

Suggested future blueprint section:

```json
{
  "design": {
    "profile": "premium_agency",
    "palette": "turquoise_gold",
    "typography": "classic_sans",
    "spacing": "comfortable",
    "radius": "soft",
    "shadow": "medium",
    "image_style": "cinematic",
    "components": {
      "hero": "premium_split",
      "property_card": "image_first",
      "archive": "filter_panel",
      "single": "gallery_hero",
      "filters": "compact_selects",
      "cta": "agency_card"
    }
  }
}