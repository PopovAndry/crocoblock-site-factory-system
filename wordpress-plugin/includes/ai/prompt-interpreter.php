<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_interpret_prompt_local( string $prompt, array $current_context = [] ): array {
	$prompt = trim( sanitize_textarea_field( wp_unslash( $prompt ) ) );
	$lower  = strtolower( $prompt );

	$city     = factory_ai_interpreter_detect_city( $prompt );
	$business = factory_ai_interpreter_detect_business_name( $prompt, $city );
	$tone     = factory_ai_interpreter_detect_enum( $lower, [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ], 'premium' );
	$color    = factory_ai_interpreter_detect_enum( $lower, [ 'turquoise', 'blue', 'green', 'beige' ], 'turquoise' );
	$vertical = factory_ai_interpreter_detect_vertical( $lower );
	$features = factory_ai_interpreter_requested_features( $lower );
	$unsupported = factory_ai_interpreter_unsupported_requests( $lower );
	$missing = [];

	if ( '' === $business ) {
		$missing[] = 'What agency name should appear on the site?';
		$business  = factory_ai_interpreter_context_value( $current_context, 'preset_variables', 'agency_name', 'Kyiv Turquoise Realty' );
	}

	if ( '' === $city ) {
		$missing[] = 'Which city or market should the site emphasize?';
		$city      = 'Kyiv';
	}

	$hero_subtitle = sprintf( 'Find apartments, houses, and commercial spaces in %s', $city );
	$contact_intro = sprintf( 'Schedule a viewing or request more details about %s properties.', $city );
	$confidence = 'real_estate' === $vertical ? 0.78 : 0.42;

	$raw = [
		'version'                          => '1.0',
		'mode'                             => 'interpretation_only',
		'applies_changes'                  => false,
		'detected_vertical'                => $vertical,
		'recommended_preset'               => 'real-estate',
		'business_name'                    => [
			'value'      => $business,
			'confidence' => '' !== $business ? 0.78 : 0.0,
		],
		'location'                         => [
			'value'      => $city,
			'confidence' => '' !== $city ? 0.72 : 0.0,
		],
		'tone'                             => [
			'value'          => $tone,
			'allowed_values' => [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ],
			'confidence'     => false !== strpos( $lower, $tone ) ? 0.72 : 0.44,
		],
		'color_preference'                 => [
			'value'          => $color,
			'allowed_values' => [ 'turquoise', 'blue', 'green', 'beige' ],
			'confidence'     => false !== strpos( $lower, $color ) ? 0.74 : 0.44,
		],
		'image_preference'                 => [
			'source'     => 'demo_pool',
			'mode'       => 'round_robin',
			'confidence' => 1.0,
		],
		'requested_features'               => $features,
		'unsupported_requests'             => $unsupported,
		'missing_questions'                => $missing,
		'safe_preset_variable_suggestions' => [
			'agency_name'   => factory_ai_interpreter_suggestion( $business, 0.78 ),
			'hero_title'    => factory_ai_interpreter_suggestion( $business, 0.74 ),
			'hero_subtitle' => factory_ai_interpreter_suggestion( $hero_subtitle, 0.72 ),
			'contact_title' => factory_ai_interpreter_suggestion( 'Contact ' . $business, 0.72 ),
			'contact_intro' => factory_ai_interpreter_suggestion( $contact_intro, 0.7 ),
		],
		'safe_style_context_suggestions'    => [
			'tone'           => factory_ai_interpreter_suggestion( $tone, 0.72 ),
			'primary_preset' => factory_ai_interpreter_suggestion( $color, 0.74 ),
		],
		'safe_image_context_suggestions'    => [
			'source' => [
				'value'                 => 'demo_pool',
				'confidence'            => 1.0,
				'requires_confirmation' => false,
			],
			'mode'   => [
				'value'                 => 'round_robin',
				'confidence'            => 1.0,
				'requires_confirmation' => false,
			],
		],
		'confidence'                       => $confidence,
	];

	return factory_ai_normalize_prompt_interpretation( $raw );
}

function factory_ai_interpreter_detect_vertical( string $lower ): string {
	foreach ( [ 'real estate', 'property', 'properties', 'apartment', 'apartments', 'house', 'rental', 'rent', 'sale' ] as $term ) {
		if ( false !== strpos( $lower, $term ) ) {
			return 'real_estate';
		}
	}

	foreach ( [ 'job', 'restaurant', 'hotel', 'clinic', 'shop', 'portfolio' ] as $term ) {
		if ( false !== strpos( $lower, $term ) ) {
			return 'unsupported';
		}
	}

	return 'unknown';
}

function factory_ai_interpreter_detect_city( string $prompt ): string {
	$cities = [ 'Kyiv', 'Kiev', 'Lviv', 'Odesa', 'Odessa', 'Dnipro', 'Kharkiv', 'Warsaw', 'Berlin', 'London', 'Paris' ];

	foreach ( $cities as $city ) {
		if ( preg_match( '/\b' . preg_quote( $city, '/' ) . '\b/i', $prompt ) ) {
			return 'Kiev' === $city ? 'Kyiv' : ( 'Odessa' === $city ? 'Odesa' : $city );
		}
	}

	if ( preg_match( '/\bin\s+([A-Z][A-Za-z\'-]{2,})\b/', $prompt, $matches ) ) {
		return sanitize_text_field( $matches[1] );
	}

	return '';
}

function factory_ai_interpreter_detect_business_name( string $prompt, string $city ): string {
	foreach ( [
		'/agency\s+(?:called|named)\s+([A-Z][A-Za-z0-9 &\'-]{2,80})/i',
		'/company\s+(?:called|named)\s+([A-Z][A-Za-z0-9 &\'-]{2,80})/i',
		'/brand\s+(?:called|named)\s+([A-Z][A-Za-z0-9 &\'-]{2,80})/i',
		'/for\s+([A-Z][A-Za-z0-9 &\'-]{2,80})\s+(?:real estate|property|agency|website)/i',
	] as $pattern ) {
		if ( preg_match( $pattern, $prompt, $matches ) ) {
			return factory_ai_interpreter_clean_business_name( $matches[1] );
		}
	}

	if ( '' !== $city ) {
		return $city . ' Realty';
	}

	return '';
}

function factory_ai_interpreter_clean_business_name( string $value ): string {
	$value = preg_replace( '/\s+(with|in|for|that|and)\s+.*$/i', '', $value );
	$value = trim( sanitize_text_field( $value ), " \t\n\r\0\x0B.,;:" );

	return factory_ai_clamp_prompt_string( $value, 80 );
}

function factory_ai_interpreter_detect_enum( string $lower, array $allowed, string $fallback ): string {
	foreach ( $allowed as $value ) {
		if ( false !== strpos( $lower, $value ) ) {
			return $value;
		}
	}

	return $fallback;
}

function factory_ai_interpreter_requested_features( string $lower ): array {
	$map = [
		'Property catalog'        => [ 'catalog', 'properties page', 'listing page' ],
		'Single property pages'   => [ 'single property', 'property details' ],
		'Contact page'            => [ 'contact', 'request viewing', 'viewing' ],
		'Native filters proof'    => [ 'filter', 'filters' ],
		'Bundled property images' => [ 'images', 'photos', 'gallery' ],
	];
	$features = [];

	foreach ( $map as $label => $terms ) {
		foreach ( $terms as $term ) {
			if ( false !== strpos( $lower, $term ) ) {
				$features[] = [
					'label'     => $label,
					'supported' => true,
				];
				break;
			}
		}
	}

	return $features;
}

function factory_ai_interpreter_unsupported_requests( string $lower ): array {
	$unsupported = [];

	if ( preg_match( '/\b\d+\s+(?:properties|listings|apartments|houses)\b/', $lower, $matches ) ) {
		$unsupported[] = [
			'label'            => $matches[0],
			'reason'           => 'Property count is fixed in this beta preset.',
			'safe_alternative' => 'Use the prepared Real Estate preset property set.',
		];
	}

	$checks = [
		[ [ 'upload', 'my images' ], 'Uploaded images', 'Image upload flows are not implemented in this beta.', 'Use bundled real estate image pools.' ],
		[ [ 'ai generated images', 'ai images', 'generate images', 'generated images', 'image ai' ], 'AI generated images', 'AI image generation is not implemented in this beta.', 'Use bundled real estate image pools.' ],
		[ [ 'custom filter', 'custom filters' ], 'Custom filters', 'Filter schema is not prompt-controlled.', 'Use the prepared Real Estate filter set.' ],
		[ [ 'custom layout', 'arbitrary layout', 'new layout' ], 'Arbitrary layouts', 'Layout topology is not prompt-controlled.', 'Use the prepared Real Estate layout.' ],
		[ [ 'job board', 'restaurant', 'hotel', 'clinic', 'shop' ], 'Other vertical', 'Only the Real Estate preset is available in this beta flow.', 'Use the Real Estate demo preset.' ],
	];

	foreach ( $checks as $check ) {
		foreach ( $check[0] as $term ) {
			if ( false !== strpos( $lower, $term ) ) {
				$unsupported[] = [
					'label'            => $check[1],
					'reason'           => $check[2],
					'safe_alternative' => $check[3],
				];
				break;
			}
		}
	}

	return $unsupported;
}

function factory_ai_interpreter_context_value( array $context, string $group, string $key, string $fallback ): string {
	$value = $context[ $group ][ $key ] ?? '';

	return is_string( $value ) && '' !== trim( $value ) ? sanitize_text_field( $value ) : $fallback;
}

function factory_ai_interpreter_suggestion( string $value, float $confidence ): array {
	return [
		'value'                 => $value,
		'confidence'            => $confidence,
		'requires_confirmation' => true,
	];
}

function factory_ai_normalize_prompt_interpretation( array $raw ): array {
	$tones  = [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ];
	$colors = [ 'turquoise', 'blue', 'green', 'beige' ];

	return [
		'version'                          => '1.0',
		'mode'                             => 'interpretation_only',
		'applies_changes'                  => false,
		'detected_vertical'                => factory_ai_normalize_enum( $raw['detected_vertical'] ?? 'unknown', [ 'real_estate', 'unsupported', 'unknown' ], 'unknown' ),
		'recommended_preset'               => 'real-estate',
		'business_name'                    => factory_ai_normalize_value_confidence( $raw['business_name'] ?? [], 80 ),
		'location'                         => factory_ai_normalize_value_confidence( $raw['location'] ?? [], 80 ),
		'tone'                             => [
			'value'          => factory_ai_normalize_enum( $raw['tone']['value'] ?? 'premium', $tones, 'premium' ),
			'allowed_values' => $tones,
			'confidence'     => factory_ai_normalize_confidence( $raw['tone']['confidence'] ?? 0 ),
		],
		'color_preference'                 => [
			'value'          => factory_ai_normalize_enum( $raw['color_preference']['value'] ?? 'turquoise', $colors, 'turquoise' ),
			'allowed_values' => $colors,
			'confidence'     => factory_ai_normalize_confidence( $raw['color_preference']['confidence'] ?? 0 ),
		],
		'image_preference'                 => [
			'source'     => 'demo_pool',
			'mode'       => 'round_robin',
			'confidence' => 1.0,
		],
		'requested_features'               => factory_ai_normalize_label_items( $raw['requested_features'] ?? [], true ),
		'unsupported_requests'             => factory_ai_normalize_unsupported_items( $raw['unsupported_requests'] ?? [] ),
		'missing_questions'                => factory_ai_normalize_string_list( $raw['missing_questions'] ?? [], 160 ),
		'safe_preset_variable_suggestions' => factory_ai_normalize_suggestions(
			$raw['safe_preset_variable_suggestions'] ?? [],
			[
				'agency_name'   => 80,
				'hero_title'    => 120,
				'hero_subtitle' => 240,
				'contact_title' => 120,
				'contact_intro' => 400,
			]
		),
		'safe_style_context_suggestions'    => [
			'tone'           => factory_ai_normalize_enum_suggestion( $raw['safe_style_context_suggestions']['tone'] ?? [], $tones, 'premium' ),
			'primary_preset' => factory_ai_normalize_enum_suggestion( $raw['safe_style_context_suggestions']['primary_preset'] ?? [], $colors, 'turquoise' ),
		],
		'safe_image_context_suggestions'    => [
			'source' => [
				'value'                 => 'demo_pool',
				'confidence'            => 1.0,
				'requires_confirmation' => false,
			],
			'mode'   => [
				'value'                 => 'round_robin',
				'confidence'            => 1.0,
				'requires_confirmation' => false,
			],
		],
		'confidence'                       => factory_ai_normalize_confidence( $raw['confidence'] ?? 0 ),
	];
}

function factory_ai_normalize_value_confidence( $item, int $max ): array {
	$item = is_array( $item ) ? $item : [];

	return [
		'value'      => factory_ai_clamp_prompt_string( $item['value'] ?? '', $max ),
		'confidence' => factory_ai_normalize_confidence( $item['confidence'] ?? 0 ),
	];
}

function factory_ai_normalize_enum_suggestion( $item, array $allowed, string $fallback ): array {
	$item = is_array( $item ) ? $item : [];

	return [
		'value'                 => factory_ai_normalize_enum( $item['value'] ?? $fallback, $allowed, $fallback ),
		'confidence'            => factory_ai_normalize_confidence( $item['confidence'] ?? 0 ),
		'requires_confirmation' => true,
	];
}

function factory_ai_normalize_suggestions( $items, array $schema ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $schema as $key => $max ) {
		$item = is_array( $items[ $key ] ?? null ) ? $items[ $key ] : [];
		$normalized[ $key ] = [
			'value'                 => factory_ai_clamp_prompt_string( $item['value'] ?? '', $max ),
			'confidence'            => factory_ai_normalize_confidence( $item['confidence'] ?? 0 ),
			'requires_confirmation' => true,
		];
	}

	return $normalized;
}

function factory_ai_normalize_label_items( $items, bool $include_supported ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$label = factory_ai_clamp_prompt_string( $item['label'] ?? '', 120 );

		if ( '' === $label ) {
			continue;
		}

		$next = [ 'label' => $label ];

		if ( $include_supported ) {
			$next['supported'] = (bool) ( $item['supported'] ?? false );
		}

		$normalized[] = $next;
	}

	return $normalized;
}

function factory_ai_normalize_unsupported_items( $items ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$label = factory_ai_clamp_prompt_string( $item['label'] ?? '', 120 );

		if ( '' === $label ) {
			continue;
		}

		$normalized[] = [
			'label'            => $label,
			'reason'           => factory_ai_clamp_prompt_string( $item['reason'] ?? '', 240 ),
			'safe_alternative' => factory_ai_clamp_prompt_string( $item['safe_alternative'] ?? '', 240 ),
		];
	}

	return $normalized;
}

function factory_ai_normalize_string_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$value = factory_ai_clamp_prompt_string( $item, $max );

		if ( '' !== $value ) {
			$normalized[] = $value;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_normalize_enum( $value, array $allowed, string $fallback ): string {
	$value = sanitize_key( is_string( $value ) ? $value : '' );

	return in_array( $value, $allowed, true ) ? $value : $fallback;
}

function factory_ai_normalize_confidence( $value ): float {
	$value = is_numeric( $value ) ? (float) $value : 0.0;

	return max( 0.0, min( 1.0, round( $value, 2 ) ) );
}

function factory_ai_clamp_prompt_string( $value, int $max ): string {
	if ( is_array( $value ) || is_object( $value ) ) {
		return '';
	}

	$value = sanitize_text_field( wp_unslash( (string) $value ) );
	$value = trim( $value );

	if ( function_exists( 'mb_substr' ) ) {
		return mb_substr( $value, 0, $max );
	}

	return substr( $value, 0, $max );
}
