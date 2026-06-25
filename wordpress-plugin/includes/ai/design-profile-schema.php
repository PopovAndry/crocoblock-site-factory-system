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
		'hero_variant'            => [ 'image_left_scrim', 'centered_overlay' ],
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
		'hero_variant'            => factory_ai_design_profile_detect_hero_variant( $lower, (string) ( $style_context['hero_variant'] ?? $defaults['design_profile']['hero_variant'] ) ),
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

function factory_ai_design_profile_detect_hero_variant( string $lower, string $fallback ): string {
	$map = [
		'centered_overlay' => [ 'centered overlay', 'centered hero overlay', 'centered hero', 'hero overlay' ],
		'image_left_scrim' => [ 'left scrim', 'image left scrim', 'left aligned hero', 'left-aligned hero' ],
	];

	foreach ( $map as $variant => $terms ) {
		foreach ( $terms as $term ) {
			if ( false !== strpos( $lower, $term ) ) {
				return $variant;
			}
		}
	}

	return sanitize_key( $fallback );
}

function factory_ai_build_real_estate_apply_design_context( array $input = [] ): array {
	$design_profile = is_array( $input['design_profile'] ?? null ) ? $input['design_profile'] : [];
	$fallback_style = is_array( $input['style_context'] ?? null ) ? $input['style_context'] : [];
	$fallback_image = is_array( $input['image_context'] ?? null ) ? $input['image_context'] : [];
	$contract       = factory_ai_normalize_design_profile_contract(
		[
			'locale'         => is_array( $input['locale'] ?? null ) ? $input['locale'] : [],
			'design_profile' => $design_profile,
		]
	);
	$profile        = is_array( $contract['design_profile'] ?? null ) ? $contract['design_profile'] : factory_ai_design_profile_defaults()['design_profile'];
	$tones          = factory_ai_design_profile_allowed_values()['tone'];
	$hero_variants  = factory_ai_design_profile_allowed_values()['hero_variant'];
	$runtime_presets = [ 'turquoise', 'blue', 'green', 'beige', 'slate' ];
	$tone           = sanitize_key( (string) ( $profile['tone'] ?? $fallback_style['tone'] ?? 'premium' ) );
	$hero_variant   = sanitize_key( (string) ( $profile['hero_variant'] ?? $fallback_style['hero_variant'] ?? 'image_left_scrim' ) );
	$primary_preset = sanitize_key(
		(string) (
			$profile['palette']['preset']
			?? $fallback_style['primary_preset']
			?? 'turquoise'
		)
	);

	if ( ! in_array( $tone, $tones, true ) ) {
		$tone = 'premium';
	}

	if ( ! in_array( $primary_preset, $runtime_presets, true ) ) {
		$primary_preset = 'turquoise';
	}

	if ( ! in_array( $hero_variant, $hero_variants, true ) ) {
		$hero_variant = 'image_left_scrim';
	}

	$style_context = [
		'tone'           => $tone,
		'primary_preset' => $primary_preset,
		'hero_variant'   => $hero_variant,
	];
	$image_strategy = is_array( $profile['image_strategy'] ?? null ) ? $profile['image_strategy'] : [];
	$image_context  = [
		'source' => sanitize_key( (string) ( $image_strategy['source'] ?? $fallback_image['source'] ?? 'demo_pool' ) ),
		'mode'   => sanitize_key( (string) ( $image_strategy['mode'] ?? $fallback_image['mode'] ?? 'round_robin' ) ),
	];

	return [
		'design_profile' => $profile,
		'style_context'  => $style_context,
		'style_tokens'   => function_exists( 'factory_rest_derive_real_estate_style_tokens' )
			? factory_rest_derive_real_estate_style_tokens( $style_context )
			: [],
		'image_context'  => $image_context,
	];
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

function factory_ai_design_profile_capability_matrix( array $input ): array {
	$contract = factory_ai_normalize_design_profile_contract( $input );
	$locale = is_array( $contract['locale'] ?? null ) ? $contract['locale'] : [];
	$profile = is_array( $contract['design_profile'] ?? null ) ? $contract['design_profile'] : [];
	$palette = is_array( $profile['palette'] ?? null ) ? $profile['palette'] : [];
	$image_strategy = is_array( $profile['image_strategy'] ?? null ) ? $profile['image_strategy'] : [];
	$items = [
		factory_ai_design_profile_capability_entry(
			'locale.language',
			(string) ( $locale['language'] ?? 'en' ),
			true,
			true,
			true,
			true,
			'English is the current supported language for planning, preview, and deterministic runtime output.'
		),
		factory_ai_design_profile_capability_entry(
			'design_profile.tone',
			(string) ( $profile['tone'] ?? 'premium' ),
			true,
			true,
			true,
			true,
			'Tone maps to the current deterministic style-context handling.'
		),
		factory_ai_design_profile_palette_capability_entry( (string) ( $palette['preset'] ?? 'turquoise' ) ),
		factory_ai_design_profile_capability_entry(
			'design_profile.typography_profile',
			(string) ( $profile['typography_profile'] ?? 'factory_default' ),
			true,
			true,
			true,
			true,
			'The deterministic runtime already uses the factory default typography profile.'
		),
		factory_ai_design_profile_hero_variant_capability_entry( (string) ( $profile['hero_variant'] ?? 'image_left_scrim' ) ),
		factory_ai_design_profile_capability_entry(
			'design_profile.property_card_variant',
			(string) ( $profile['property_card_variant'] ?? 'factory_default' ),
			true,
			true,
			true,
			true,
			'The current deterministic property card layout uses this default variant.'
		),
		factory_ai_design_profile_capability_entry(
			'design_profile.catalog_variant',
			(string) ( $profile['catalog_variant'] ?? 'stable_catalog_get_filters' ),
			true,
			true,
			true,
			true,
			'The current deterministic catalog flow uses the stable GET-filter layout.'
		),
		factory_ai_design_profile_capability_entry(
			'design_profile.single_property_variant',
			(string) ( $profile['single_property_variant'] ?? 'factory_default' ),
			true,
			true,
			true,
			true,
			'The current single-property page already uses this default variant.'
		),
		factory_ai_design_profile_capability_entry(
			'design_profile.section_order',
			(string) ( $profile['section_order'] ?? 'home_default_v1' ),
			true,
			true,
			true,
			true,
			'The current Real Estate home page follows this default section order.'
		),
		factory_ai_design_profile_capability_entry(
			'design_profile.image_strategy.source',
			(string) ( $image_strategy['source'] ?? 'demo_pool' ),
			true,
			true,
			true,
			true,
			'The deterministic runtime uses the bundled demo image pool.'
		),
		factory_ai_design_profile_capability_entry(
			'design_profile.image_strategy.mode',
			(string) ( $image_strategy['mode'] ?? 'round_robin' ),
			true,
			true,
			true,
			true,
			'The deterministic runtime uses round-robin image assignment.'
		),
	];
	$summary = [
		'supported'       => 0,
		'planning_only'   => 0,
		'unsupported'     => 0,
		'runtime_backed'  => 0,
		'apply_backed'    => 0,
	];

	foreach ( $items as $item ) {
		$status = sanitize_key( (string) ( $item['status'] ?? 'unsupported' ) );

		if ( isset( $summary[ $status ] ) ) {
			++$summary[ $status ];
		}

		if ( ! empty( $item['runtime_supported'] ) ) {
			++$summary['runtime_backed'];
		}

		if ( ! empty( $item['apply_supported'] ) ) {
			++$summary['apply_backed'];
		}
	}

	return [
		'summary' => $summary,
		'items'   => $items,
	];
}

function factory_ai_design_profile_capability_entry(
	string $field,
	string $value,
	bool $planning_supported,
	bool $preview_supported,
	bool $runtime_supported,
	bool $apply_supported,
	string $note
): array {
	$status = 'unsupported';

	if ( $runtime_supported && $apply_supported ) {
		$status = 'supported';
	} elseif ( $planning_supported || $preview_supported ) {
		$status = 'planning_only';
	}

	return [
		'field'               => sanitize_key( str_replace( '.', '_', $field ) ),
		'path'                => $field,
		'value'               => sanitize_key( $value ),
		'planning_supported'  => $planning_supported,
		'preview_supported'   => $preview_supported,
		'runtime_supported'   => $runtime_supported,
		'apply_supported'     => $apply_supported,
		'status'              => $status,
		'note'                => sanitize_text_field( $note ),
	];
}

function factory_ai_design_profile_hero_variant_capability_entry( string $value ): array {
	$value = sanitize_key( $value );

	if ( 'centered_overlay' === $value ) {
		return factory_ai_design_profile_capability_entry(
			'design_profile.hero_variant',
			$value,
			true,
			true,
			true,
			true,
			'The deterministic runtime can persist and render the centered overlay Home hero variant.'
		);
	}

	if ( 'image_left_scrim' === $value ) {
		return factory_ai_design_profile_capability_entry(
			'design_profile.hero_variant',
			$value,
			true,
			true,
			true,
			true,
			'The current Real Estate hero already matches the image-left scrim variant.'
		);
	}

	return factory_ai_design_profile_capability_entry(
		'design_profile.hero_variant',
		$value,
		false,
		false,
		false,
		false,
		'This hero variant is not supported by the current Design/Profile Schema v1 contract.'
	);
}

function factory_ai_design_profile_palette_capability_entry( string $value ): array {
	$value = sanitize_key( $value );

	if ( in_array( $value, [ 'turquoise', 'blue', 'green', 'slate' ], true ) ) {
		return factory_ai_design_profile_capability_entry(
			'design_profile.palette.preset',
			$value,
			true,
			true,
			true,
			true,
			'This palette preset is already consumed by the current deterministic runtime.'
		);
	}

	return factory_ai_design_profile_capability_entry(
		'design_profile.palette.preset',
		$value,
		false,
		false,
		false,
		false,
		'This palette preset is not supported by the current Design/Profile Schema v1 contract.'
	);
}

function factory_ai_design_profile_capability_summary( array $matrix ): array {
	$matrix = is_array( $matrix ) ? $matrix : [];
	$summary = is_array( $matrix['summary'] ?? null ) ? $matrix['summary'] : [];
	$items = is_array( $matrix['items'] ?? null ) ? $matrix['items'] : [];
	$planning_only = [];
	$unsupported = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$path = sanitize_text_field( (string) ( $item['path'] ?? '' ) );
		$value = sanitize_text_field( (string) ( $item['value'] ?? '' ) );
		$status = sanitize_key( (string) ( $item['status'] ?? '' ) );
		$label = '' !== $path && '' !== $value ? sprintf( '%s=%s', $path, $value ) : $path;

		if ( 'planning_only' === $status && '' !== $label ) {
			$planning_only[] = $label;
		}

		if ( 'unsupported' === $status && '' !== $label ) {
			$unsupported[] = $label;
		}
	}

	return [
		'supported'     => max( 0, (int) ( $summary['supported'] ?? 0 ) ),
		'planning_only' => max( 0, (int) ( $summary['planning_only'] ?? 0 ) ),
		'unsupported'   => max( 0, (int) ( $summary['unsupported'] ?? 0 ) ),
		'planning_only_fields' => array_values( array_unique( $planning_only ) ),
		'unsupported_fields'   => array_values( array_unique( $unsupported ) ),
	];
}
