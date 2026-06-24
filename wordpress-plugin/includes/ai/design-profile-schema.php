<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_design_profile_allowed_values(): array {
	return [
		'language'                => [ 'en' ],
		'tone'                    => [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ],
		'palette_preset'          => [ 'turquoise', 'blue', 'green', 'slate' ],
		'typography_profile'      => [ 'factory_default' ],
		'hero_variant'            => [ 'image_left_scrim' ],
		'property_card_variant'   => [ 'factory_default' ],
		'catalog_variant'         => [ 'stable_catalog_get_filters' ],
		'single_property_variant' => [ 'factory_default' ],
		'section_order'           => [ 'home_default_v1' ],
		'image_source'            => [ 'demo_pool' ],
		'image_mode'              => [ 'round_robin' ],
	];
}

function factory_ai_design_profile_defaults(): array {
	return [
		'locale'         => [
			'language' => 'en',
		],
		'design_profile' => [
			'tone'                    => 'premium',
			'palette'                 => [
				'preset' => 'turquoise',
			],
			'typography_profile'      => 'factory_default',
			'hero_variant'            => 'image_left_scrim',
			'property_card_variant'   => 'factory_default',
			'catalog_variant'         => 'stable_catalog_get_filters',
			'single_property_variant' => 'factory_default',
			'section_order'           => 'home_default_v1',
			'image_strategy'          => [
				'source' => 'demo_pool',
				'mode'   => 'round_robin',
			],
		],
	];
}

function factory_ai_normalize_design_profile_contract( array $input ): array {
	$defaults = factory_ai_design_profile_defaults();
	$allowed  = factory_ai_design_profile_allowed_values();
	$locale   = is_array( $input['locale'] ?? null ) ? $input['locale'] : [];
	$profile  = is_array( $input['design_profile'] ?? null ) ? $input['design_profile'] : [];
	$palette  = is_array( $profile['palette'] ?? null ) ? $profile['palette'] : [];
	$image    = is_array( $profile['image_strategy'] ?? null ) ? $profile['image_strategy'] : [];
	$language = sanitize_key( (string) ( $locale['language'] ?? $defaults['locale']['language'] ) );
	$tone     = sanitize_key( (string) ( $profile['tone'] ?? $defaults['design_profile']['tone'] ) );
	$preset   = factory_ai_design_profile_normalize_palette_input( (string) ( $palette['preset'] ?? '' ) );
	$typography_profile = sanitize_key( (string) ( $profile['typography_profile'] ?? $defaults['design_profile']['typography_profile'] ) );
	$hero_variant = sanitize_key( (string) ( $profile['hero_variant'] ?? $defaults['design_profile']['hero_variant'] ) );
	$property_card_variant = sanitize_key( (string) ( $profile['property_card_variant'] ?? $defaults['design_profile']['property_card_variant'] ) );
	$catalog_variant = sanitize_key( (string) ( $profile['catalog_variant'] ?? $defaults['design_profile']['catalog_variant'] ) );
	$single_property_variant = sanitize_key( (string) ( $profile['single_property_variant'] ?? $defaults['design_profile']['single_property_variant'] ) );
	$section_order = sanitize_key( (string) ( $profile['section_order'] ?? $defaults['design_profile']['section_order'] ) );
	$image_source = sanitize_key( (string) ( $image['source'] ?? $defaults['design_profile']['image_strategy']['source'] ) );
	$image_mode = sanitize_key( (string) ( $image['mode'] ?? $defaults['design_profile']['image_strategy']['mode'] ) );

	if ( ! in_array( $language, $allowed['language'], true ) ) {
		$language = $defaults['locale']['language'];
	}

	if ( ! in_array( $tone, $allowed['tone'], true ) ) {
		$tone = $defaults['design_profile']['tone'];
	}

	if ( ! in_array( $preset, $allowed['palette_preset'], true ) ) {
		$preset = $defaults['design_profile']['palette']['preset'];
	}

	if ( ! in_array( $typography_profile, $allowed['typography_profile'], true ) ) {
		$typography_profile = $defaults['design_profile']['typography_profile'];
	}

	if ( ! in_array( $hero_variant, $allowed['hero_variant'], true ) ) {
		$hero_variant = $defaults['design_profile']['hero_variant'];
	}

	if ( ! in_array( $property_card_variant, $allowed['property_card_variant'], true ) ) {
		$property_card_variant = $defaults['design_profile']['property_card_variant'];
	}

	if ( ! in_array( $catalog_variant, $allowed['catalog_variant'], true ) ) {
		$catalog_variant = $defaults['design_profile']['catalog_variant'];
	}

	if ( ! in_array( $single_property_variant, $allowed['single_property_variant'], true ) ) {
		$single_property_variant = $defaults['design_profile']['single_property_variant'];
	}

	if ( ! in_array( $section_order, $allowed['section_order'], true ) ) {
		$section_order = $defaults['design_profile']['section_order'];
	}

	if ( ! in_array( $image_source, $allowed['image_source'], true ) ) {
		$image_source = $defaults['design_profile']['image_strategy']['source'];
	}

	if ( ! in_array( $image_mode, $allowed['image_mode'], true ) ) {
		$image_mode = $defaults['design_profile']['image_strategy']['mode'];
	}

	return [
		'locale'         => [
			'language' => $language,
		],
		'design_profile' => [
			'tone'                    => $tone,
			'palette'                 => [
				'preset' => $preset,
			],
			'typography_profile'      => $typography_profile,
			'hero_variant'            => $hero_variant,
			'property_card_variant'   => $property_card_variant,
			'catalog_variant'         => $catalog_variant,
			'single_property_variant' => $single_property_variant,
			'section_order'           => $section_order,
			'image_strategy'          => [
				'source' => $image_source,
				'mode'   => $image_mode,
			],
		],
	];
}

function factory_ai_build_design_profile_context( string $prompt, array $context = [] ): array {
	$defaults      = factory_ai_design_profile_defaults();
	$style_context = is_array( $context['style_context'] ?? null ) ? $context['style_context'] : [];
	$image_context = is_array( $context['image_context'] ?? null ) ? $context['image_context'] : [];
	$lower         = strtolower( $prompt );
	$locale        = [
		'language' => factory_ai_design_profile_detect_language( $lower, $defaults['locale']['language'] ),
	];
	$profile       = [
		'tone'                    => factory_ai_design_profile_detect_tone( $lower, (string) ( $style_context['tone'] ?? $defaults['design_profile']['tone'] ) ),
		'palette'                 => [
			'preset' => factory_ai_design_profile_detect_palette( $lower, (string) ( $style_context['primary_preset'] ?? $defaults['design_profile']['palette']['preset'] ) ),
		],
		'typography_profile'      => 'factory_default',
		'hero_variant'            => 'image_left_scrim',
		'property_card_variant'   => 'factory_default',
		'catalog_variant'         => 'stable_catalog_get_filters',
		'single_property_variant' => 'factory_default',
		'section_order'           => 'home_default_v1',
		'image_strategy'          => [
			'source' => (string) ( $image_context['source'] ?? 'demo_pool' ),
			'mode'   => (string) ( $image_context['mode'] ?? 'round_robin' ),
		],
	];
	$normalized    = factory_ai_normalize_design_profile_contract(
		[
			'locale'         => $locale,
			'design_profile' => $profile,
		]
	);
	$warnings      = [];
	$unsupported   = factory_ai_design_profile_prompt_unsupported_requests( $prompt );

	if ( $locale['language'] !== $normalized['locale']['language'] ) {
		$warnings[] = 'Requested language is not supported in Design/Profile Schema v1. English was used.';
		$unsupported[] = [
			'label'            => 'Unsupported language',
			'reason'           => 'Design/Profile Schema v1 supports English only for the current Real Estate beta flow.',
			'safe_alternative' => 'Use English content and safe copy variables in the current beta.',
		];
	}

	if ( $profile['tone'] !== $normalized['design_profile']['tone'] ) {
		$warnings[] = 'Requested design tone is not supported in Design/Profile Schema v1. The default tone was used.';
	}

	if ( $profile['palette']['preset'] !== $normalized['design_profile']['palette']['preset'] ) {
		$warnings[] = 'Requested palette preset is not supported in Design/Profile Schema v1. The default palette was used.';
	}

	if ( 'slate' === $normalized['design_profile']['palette']['preset'] ) {
		$warnings[] = 'Slate palette is normalized for planning only in Phase 8a. Current deterministic apply and render behavior remains unchanged.';
	}

	return [
		'locale'               => $normalized['locale'],
		'design_profile'       => $normalized['design_profile'],
		'warnings'             => array_values( array_unique( $warnings ) ),
		'unsupported_requests' => factory_ai_design_profile_unique_unsupported( $unsupported ),
	];
}

function factory_ai_design_profile_detect_language( string $lower, string $fallback ): string {
	$checks = [
		'ukrainian' => 'uk',
		'ukrainian language' => 'uk',
		'english' => 'en',
		'english language' => 'en',
	];

	foreach ( $checks as $needle => $language ) {
		if ( false !== strpos( $lower, $needle ) ) {
			return $language;
		}
	}

	return $fallback;
}

function factory_ai_design_profile_detect_tone( string $lower, string $fallback ): string {
	$map = [
		'minimal'   => [ 'minimal', 'clean', 'pared back' ],
		'modern'    => [ 'modern', 'contemporary' ],
		'corporate' => [ 'corporate', 'businesslike', 'professional' ],
		'warm'      => [ 'warm', 'inviting', 'friendly' ],
		'premium'   => [ 'premium', 'luxury', 'high end' ],
	];

	foreach ( $map as $tone => $terms ) {
		foreach ( $terms as $term ) {
			if ( false !== strpos( $lower, $term ) ) {
				return $tone;
			}
		}
	}

	return sanitize_key( $fallback );
}

function factory_ai_design_profile_detect_palette( string $lower, string $fallback ): string {
	$map = [
		'turquoise' => [ 'turquoise', 'teal', 'aqua' ],
		'blue'      => [ 'blue', 'navy', 'azure', 'cobalt' ],
		'green'     => [ 'green', 'emerald', 'forest' ],
		'slate'     => [ 'slate', 'graphite', 'charcoal', 'steel' ],
	];

	foreach ( $map as $preset => $terms ) {
		foreach ( $terms as $term ) {
			if ( false !== strpos( $lower, $term ) ) {
				return $preset;
			}
		}
	}

	return factory_ai_design_profile_normalize_palette_input( $fallback );
}

function factory_ai_design_profile_normalize_palette_input( string $value ): string {
	$value = sanitize_key( $value );

	if ( 'beige' === $value ) {
		return 'beige';
	}

	return $value;
}

function factory_ai_design_profile_prompt_unsupported_requests( string $prompt ): array {
	$lower = strtolower( $prompt );
	$items = [];

	if ( preg_match( '/#[0-9a-f]{3}([0-9a-f]{3})?\b/i', $prompt ) || false !== strpos( $lower, 'rgb(' ) || false !== strpos( $lower, 'hsl(' ) ) {
		$items[] = [
			'label'            => 'Raw color values',
			'reason'           => 'Design/Profile Schema v1 accepts palette presets only and does not allow raw color values as authoritative input.',
			'safe_alternative' => 'Use a supported palette preset such as turquoise, blue, green, or slate.',
		];
	}

	if ( false !== strpos( $lower, 'html' ) || false !== strpos( $lower, 'css' ) || false !== strpos( $lower, 'php' ) || false !== strpos( $lower, 'javascript' ) || false !== strpos( $lower, 'shortcode' ) ) {
		$items[] = [
			'label'            => 'Raw implementation instructions',
			'reason'           => 'Design/Profile Schema v1 does not accept raw HTML, CSS, PHP, JavaScript, or shortcodes.',
			'safe_alternative' => 'Use supported design_profile enum values and safe copy variables only.',
		];
	}

	if ( false !== strpos( $lower, 'font' ) || false !== strpos( $lower, 'typography' ) || false !== strpos( $lower, 'serif' ) || false !== strpos( $lower, 'inter' ) || false !== strpos( $lower, 'playfair' ) || false !== strpos( $lower, 'montserrat' ) ) {
		$items[] = [
			'label'            => 'Custom typography',
			'reason'           => 'Typography selection is not configurable in Design/Profile Schema v1.',
			'safe_alternative' => 'Use the default factory typography profile in the current beta.',
		];
	}

	return factory_ai_design_profile_unique_unsupported( $items );
}

function factory_ai_design_profile_unique_unsupported( array $items ): array {
	$seen = [];
	$unique = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$label = sanitize_text_field( (string) ( $item['label'] ?? '' ) );
		$reason = sanitize_text_field( (string) ( $item['reason'] ?? '' ) );
		$safe_alternative = sanitize_text_field( (string) ( $item['safe_alternative'] ?? '' ) );

		if ( '' === $label ) {
			continue;
		}

		$key = strtolower( $label . '|' . $reason );

		if ( isset( $seen[ $key ] ) ) {
			continue;
		}

		$seen[ $key ] = true;
		$unique[] = [
			'label'            => $label,
			'reason'           => $reason,
			'safe_alternative' => $safe_alternative,
		];
	}

	return $unique;
}
