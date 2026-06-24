<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_site_plan( string $prompt, array $context = [], array $options = [] ): array {
	$prompt = trim( sanitize_textarea_field( wp_unslash( $prompt ) ) );
	$requested_site_type = factory_ai_site_plan_normalize_site_type( (string) ( $options['site_type'] ?? '' ) );

	if ( '' === $prompt ) {
		return factory_ai_site_plan_response(
			[
				'status'       => 'error',
				'code'         => 'empty_prompt',
				'message'      => 'Enter a prompt before creating a site plan.',
				'site_type'    => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'next_step'    => 'enter_prompt',
				'warnings'     => [
					'No provider call was made.',
					'No site changes were applied.',
				],
				'confidence'   => 0.0,
				'provider'     => 'local',
				'usage'        => null,
			]
		);
	}

	$lower = strtolower( $prompt );
	$detected_site_type = factory_ai_site_plan_detect_site_type( $prompt, $requested_site_type );
	$unsupported_requests = array_merge(
		factory_ai_interpreter_unsupported_requests( $lower ),
		factory_ai_site_plan_additional_unsupported_requests( $lower )
	);
	$unsupported_requests = factory_ai_site_plan_dedupe_unsupported_requests( $unsupported_requests );

	if ( 'real_estate' !== $detected_site_type ) {
		return factory_ai_site_plan_unsupported_vertical_response(
			$prompt,
			$detected_site_type,
			$requested_site_type,
			$unsupported_requests
		);
	}

	$city = factory_ai_site_plan_detect_city( $prompt );
	$agency_name = factory_ai_site_plan_detect_business_name( $prompt, $city );
	$agency_name = '' !== $agency_name
		? $agency_name
		: factory_ai_site_plan_context_value( $context, 'preset_variables', 'agency_name', '' );
	$city = '' !== $city ? $city : factory_ai_site_plan_context_value( $context, 'business', 'city', 'the selected market' );
	$business_summary = factory_ai_site_plan_business_summary( $agency_name, $city, $prompt );
	$design_context = function_exists( 'factory_ai_build_design_profile_context' )
		? factory_ai_build_design_profile_context( $prompt, $context )
		: [
			'locale'               => [ 'language' => 'en' ],
			'design_profile'       => [],
			'warnings'             => [],
			'unsupported_requests' => [],
		];
	$supported_features = factory_ai_site_plan_supported_features( $lower );
	$warnings = [
		'Interpretation only. No blueprint, candidate, or patch was generated.',
		'No site changes were applied.',
	];
	$unsupported_requests = factory_ai_site_plan_dedupe_unsupported_requests(
		array_merge(
			$unsupported_requests,
			is_array( $design_context['unsupported_requests'] ?? null ) ? $design_context['unsupported_requests'] : []
		)
	);
	$risks = factory_ai_site_plan_risks( $unsupported_requests );

	return factory_ai_site_plan_response(
		[
			'status'                => ! empty( $unsupported_requests ) ? 'warning' : 'ok',
			'code'                  => ! empty( $unsupported_requests ) ? 'site_plan_supported_with_warnings' : 'site_plan_ready',
			'message'               => ! empty( $unsupported_requests )
				? 'Site plan ready with warnings for unsupported requests.'
				: 'Site plan ready for review.',
			'provider'              => 'local',
			'site_type'             => 'real_estate',
			'vertical'              => 'real_estate',
			'locale'                => array_merge(
				is_array( $design_context['locale'] ?? null ) ? $design_context['locale'] : [ 'language' => 'en' ],
				[ 'city' => $city ]
			),
			'business'              => [
				'agency_name'      => $agency_name,
				'business_summary' => $business_summary,
				'city'             => $city,
			],
			'design_profile'        => $design_context['design_profile'] ?? [],
			'confidence'            => factory_ai_site_plan_confidence( $agency_name, $city, $unsupported_requests ),
			'recommended_preset'    => 'real-estate',
			'business_summary'      => $business_summary,
			'pages'                 => factory_ai_site_plan_pages(),
			'sections'              => factory_ai_site_plan_sections( $city ),
			'required_structures'   => factory_ai_site_plan_required_structures(),
			'crocoblock_components' => factory_ai_site_plan_crocoblock_components(),
			'supported_features'    => $supported_features,
			'unsupported_requests'  => $unsupported_requests,
			'risks'                 => $risks,
			'next_step'             => 'review_site_plan',
			'warnings'              => array_merge(
				$warnings,
				is_array( $design_context['warnings'] ?? null ) ? factory_ai_normalize_string_list( $design_context['warnings'], 200 ) : [],
				! empty( $unsupported_requests )
					? [ 'Some requested capabilities are outside the current Real Estate beta flow.' ]
					: []
			),
			'usage'                 => null,
		]
	);
}

function factory_ai_site_plan_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'disabled', 'error' ], true ) ) {
		$status = 'error';
	}

	$site_type = factory_ai_site_plan_normalize_site_type( (string) ( $overrides['site_type'] ?? 'unknown' ) );
	$vertical = factory_ai_site_plan_normalize_site_type( (string) ( $overrides['vertical'] ?? $site_type ) );
	$raw_locale = is_array( $overrides['locale'] ?? null ) ? $overrides['locale'] : [];
	$raw_business = is_array( $overrides['business'] ?? null ) ? $overrides['business'] : [];
	$design_contract = function_exists( 'factory_ai_normalize_design_profile_contract' )
		? factory_ai_normalize_design_profile_contract(
			[
				'locale'         => $raw_locale,
				'design_profile' => is_array( $overrides['design_profile'] ?? null ) ? $overrides['design_profile'] : [],
			]
		)
		: [
			'locale'         => [ 'language' => 'en' ],
			'design_profile' => [],
		];
	$design_capabilities = function_exists( 'factory_ai_design_profile_capability_matrix' )
		? factory_ai_design_profile_capability_matrix( $design_contract )
		: [ 'summary' => [], 'items' => [] ];

	return [
		'status'                => $status,
		'code'                  => sanitize_key( (string) ( $overrides['code'] ?? 'site_plan_unavailable' ) ),
		'message'               => sanitize_text_field( (string) ( $overrides['message'] ?? 'Site plan is unavailable.' ) ),
		'provider'              => sanitize_key( (string) ( $overrides['provider'] ?? 'local' ) ),
		'mode'                  => 'site_plan_v1',
		'applies_changes'       => false,
		'provider_called'       => false,
		'vertical'              => $vertical,
		'locale'                => [
			'language' => sanitize_key( (string) ( $design_contract['locale']['language'] ?? 'en' ) ),
			'city'     => factory_ai_site_plan_clamp_text( $raw_locale['city'] ?? '', 80 ),
		],
		'business'              => [
			'agency_name'      => factory_ai_site_plan_clamp_text( $raw_business['agency_name'] ?? '', 120 ),
			'business_summary' => factory_ai_site_plan_clamp_text( $raw_business['business_summary'] ?? $overrides['business_summary'] ?? '', 280 ),
			'city'             => factory_ai_site_plan_clamp_text( $raw_business['city'] ?? $raw_locale['city'] ?? '', 80 ),
		],
		'design_profile'        => is_array( $design_contract['design_profile'] ?? null ) ? $design_contract['design_profile'] : [],
		'design_profile_capabilities' => $design_capabilities,
		'confidence'            => factory_ai_normalize_confidence( $overrides['confidence'] ?? 0 ),
		'recommended_preset'    => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'site_type'             => $site_type,
		'business_summary'      => factory_ai_site_plan_clamp_text( $overrides['business_summary'] ?? '', 280 ),
		'pages'                 => factory_ai_site_plan_pages_list( $overrides['pages'] ?? [] ),
		'sections'              => factory_ai_site_plan_sections_list( $overrides['sections'] ?? [] ),
		'required_structures'   => factory_ai_site_plan_text_list( $overrides['required_structures'] ?? [], 120 ),
		'crocoblock_components' => factory_ai_site_plan_text_list( $overrides['crocoblock_components'] ?? [], 120 ),
		'supported_features'    => factory_ai_site_plan_text_list( $overrides['supported_features'] ?? [], 120 ),
		'unsupported_requests'  => factory_ai_normalize_unsupported_items( $overrides['unsupported_requests'] ?? [] ),
		'risks'                 => factory_ai_site_plan_text_list( $overrides['risks'] ?? [], 200 ),
		'next_step'             => sanitize_key( (string) ( $overrides['next_step'] ?? 'review_site_plan' ) ),
		'warnings'              => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 200 ),
		'usage'                 => null,
	];
}

function factory_ai_site_plan_detect_site_type( string $prompt, string $requested_site_type = '' ): string {
	if ( '' !== $requested_site_type && 'unknown' !== $requested_site_type ) {
		return $requested_site_type;
	}

	$lower = strtolower( $prompt );
	$map = [
		'real_estate' => [ 'real estate', 'property', 'properties', 'apartment', 'apartments', 'house', 'houses', 'listing', 'listings', 'realtor', 'realty' ],
		'job_board'   => [ 'job board', 'jobs', 'vacancy', 'vacancies', 'recruitment', 'career' ],
		'restaurant'  => [ 'restaurant', 'pizzeria', 'pizza', 'cafe', 'menu', 'reservation' ],
		'clinic'      => [ 'clinic', 'medical', 'doctor', 'dentist', 'hospital' ],
		'auto'        => [ 'car dealer', 'automotive', 'auto', 'vehicle', 'vehicles' ],
		'travel'      => [ 'travel', 'tour', 'agency', 'hotel', 'vacation' ],
		'marketplace' => [ 'marketplace', 'store', 'shop', 'ecommerce', 'e-commerce', 'seller' ],
	];

	foreach ( $map as $site_type => $terms ) {
		foreach ( $terms as $term ) {
			if ( false !== strpos( $lower, $term ) ) {
				return $site_type;
			}
		}
	}

	return 'unknown';
}

function factory_ai_site_plan_detect_city( string $prompt ): string {
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

function factory_ai_site_plan_detect_business_name( string $prompt, string $city ): string {
	$patterns = [
		'/\b(?:agency|company|brand)\s+(?:called|named)\s+([A-Z][A-Za-z0-9&\' -]{2,60})/i',
		'/\bfor\s+([A-Z][A-Za-z0-9&\' -]{2,60}?)(?:\s+(?:real estate|realty|agency|website)\b|\s+with\b|[,.]|$)/i',
	];

	foreach ( $patterns as $pattern ) {
		if ( preg_match( $pattern, $prompt, $matches ) ) {
			return factory_ai_site_plan_clean_business_name( $matches[1] );
		}
	}

	if ( '' !== $city ) {
		return $city . ' Realty';
	}

	return '';
}

function factory_ai_site_plan_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}

function factory_ai_site_plan_additional_unsupported_requests( string $lower ): array {
	$unsupported = [];
	$checks = [
		[ [ 'custom plugin', 'plugin generation', 'build a plugin' ], 'Custom plugin generation', 'Custom plugin generation is outside Site Plan v1.', 'Review a supported Site Plan first, then implement plugin logic separately.' ],
		[ [ 'custom code', 'php code', 'write code', 'generate code' ], 'Custom code generation', 'Arbitrary custom code generation is not part of Site Plan v1.', 'Use the structured site plan to review supported product scope first.' ],
		[ [ 'ai image', 'ai generated image', 'generate images', 'image generation' ], 'AI image generation', 'AI image generation is outside the current Site Factory beta flow.', 'Use bundled deterministic images in the current Real Estate flow.' ],
		[ [ 'apply now', 'generate now', 'build now', 'publish now', 'deploy now' ], 'Direct apply request', 'Site Plan v1 is read-only and does not generate or apply a site.', 'Review the site plan first, then use the controlled generation flow separately.' ],
		[ [ 'update wordpress', 'mutate wordpress', 'change posts directly', 'write to wordpress' ], 'Direct WordPress mutation', 'Site Plan v1 cannot mutate WordPress directly.', 'Use Preview and controlled Generate later in the product flow.' ],
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

function factory_ai_site_plan_dedupe_unsupported_requests( array $items ): array {
	$normalized = factory_ai_normalize_unsupported_items( $items );
	$seen = [];
	$unique = [];

	foreach ( $normalized as $item ) {
		$key = strtolower( (string) ( $item['label'] ?? '' ) ) . '|' . strtolower( (string) ( $item['reason'] ?? '' ) );

		if ( isset( $seen[ $key ] ) ) {
			continue;
		}

		$seen[ $key ] = true;
		$unique[] = $item;
	}

	return $unique;
}

function factory_ai_site_plan_unsupported_vertical_response( string $prompt, string $detected_site_type, string $requested_site_type, array $unsupported_requests ): array {
	$site_type = 'unknown' !== $detected_site_type ? $detected_site_type : ( '' !== $requested_site_type ? $requested_site_type : 'unknown' );
	$warnings = [
		'Site Plan v1 currently supports the Real Estate vertical only.',
		'No provider call was made.',
		'No site changes were applied.',
	];

	$unsupported_requests[] = [
		'label'            => strtoupper( str_replace( '_', ' ', $site_type ) ),
		'reason'           => 'This site type is not supported in the current beta planner.',
		'safe_alternative' => 'Use the Real Estate vertical for the current supported flow.',
	];

	return factory_ai_site_plan_response(
		[
			'status'                => 'warning',
			'code'                  => 'unsupported_site_type',
			'message'               => 'This prompt maps to a future or unsupported site type in Site Plan v1.',
			'provider'              => 'local',
			'site_type'             => $site_type,
			'vertical'              => $site_type,
			'confidence'            => 'unknown' === $site_type ? 0.25 : 0.52,
			'recommended_preset'    => '',
			'business_summary'      => factory_ai_site_plan_clamp_text( $prompt, 220 ),
			'pages'                 => [],
			'sections'              => [],
			'required_structures'   => [],
			'crocoblock_components' => [],
			'supported_features'    => [],
			'unsupported_requests'  => factory_ai_site_plan_dedupe_unsupported_requests( $unsupported_requests ),
			'risks'                 => [
				'Generating a site for this vertical would require a future preset and contract.',
				'Closest supported output is the Real Estate beta only, and it is not a safe automatic substitute here.',
			],
			'next_step'             => 'choose_supported_vertical',
			'warnings'              => $warnings,
			'usage'                 => null,
		]
	);
}

function factory_ai_site_plan_business_summary( string $agency_name, string $city, string $prompt ): string {
	if ( '' !== $agency_name && '' !== $city && 'the selected market' !== $city ) {
		return sprintf( '%s is a real estate business focused on properties in %s.', $agency_name, $city );
	}

	if ( '' !== $agency_name ) {
		return sprintf( '%s is a real estate business prepared for the current deterministic beta flow.', $agency_name );
	}

	if ( '' !== $city && 'the selected market' !== $city ) {
		return sprintf( 'This prompt describes a real estate site focused on properties in %s.', $city );
	}

	return factory_ai_site_plan_clamp_text( $prompt, 220 );
}

function factory_ai_site_plan_pages(): array {
	return [
		[
			'slug'    => 'home',
			'title'   => 'Home',
			'purpose' => 'Landing page for the agency and featured properties.',
		],
		[
			'slug'    => 'properties',
			'title'   => 'Properties',
			'purpose' => 'Catalog page for property browsing and filters.',
		],
		[
			'slug'    => 'contact',
			'title'   => 'Contact',
			'purpose' => 'Lead capture and request viewing contact page.',
		],
	];
}

function factory_ai_site_plan_sections( string $city ): array {
	$city = '' !== $city ? $city : 'the target market';

	return [
		[
			'page'    => 'home',
			'type'    => 'hero',
			'purpose' => sprintf( 'Introduce the agency and highlight the %s real estate market.', $city ),
		],
		[
			'page'    => 'home',
			'type'    => 'featured_properties',
			'purpose' => 'Show highlighted property cards from the prepared demo content.',
		],
		[
			'page'    => 'properties',
			'type'    => 'catalog_header',
			'purpose' => 'Present the property archive and browsing context.',
		],
		[
			'page'    => 'properties',
			'type'    => 'filters_and_listing',
			'purpose' => 'Provide deterministic filtering and property listing results.',
		],
		[
			'page'    => 'contact',
			'type'    => 'contact_intro',
			'purpose' => 'Invite visitors to request more details or a viewing.',
		],
		[
			'page'    => 'contact',
			'type'    => 'request_viewing',
			'purpose' => 'Capture property lead requests through the supported contact flow.',
		],
	];
}

function factory_ai_site_plan_required_structures(): array {
	return [
		'Property CPT',
		'Property meta fields',
		'Property taxonomy terms',
		'Property listing',
		'Single property template',
		'Navigation menu',
	];
}

function factory_ai_site_plan_crocoblock_components(): array {
	return [
		'JetEngine required',
		'JetSmartFilters optional',
		'JetFormBuilder optional',
	];
}

function factory_ai_site_plan_supported_features( string $lower ): array {
	$features = [
		'Deterministic Real Estate preset',
		'Property catalog page',
		'Single property pages',
		'Contact and request viewing flow',
	];

	if ( false !== strpos( $lower, 'filter' ) || false !== strpos( $lower, 'filters' ) ) {
		$features[] = 'Prepared property filtering';
	}

	if ( false !== strpos( $lower, 'image' ) || false !== strpos( $lower, 'photo' ) || false !== strpos( $lower, 'gallery' ) ) {
		$features[] = 'Bundled deterministic property images';
	}

	if ( false !== strpos( $lower, 'style' ) || false !== strpos( $lower, 'color' ) || false !== strpos( $lower, 'design' ) ) {
		$features[] = 'Deterministic style token selection';
	}

	return array_values( array_unique( $features ) );
}

function factory_ai_site_plan_risks( array $unsupported_requests ): array {
	$risks = [
		'JetEngine and the required theme must be available before controlled generation.',
		'JetSmartFilters and JetFormBuilder are optional and may limit enhanced proof features when missing.',
	];

	if ( ! empty( $unsupported_requests ) ) {
		$risks[] = 'Unsupported requests will need follow-up planning beyond the current Site Plan v1 contract.';
	}

	return $risks;
}

function factory_ai_site_plan_confidence( string $agency_name, string $city, array $unsupported_requests ): float {
	$confidence = 0.7;

	if ( '' !== $agency_name ) {
		$confidence += 0.08;
	}

	if ( '' !== $city && 'the selected market' !== $city ) {
		$confidence += 0.07;
	}

	if ( ! empty( $unsupported_requests ) ) {
		$confidence -= 0.12;
	}

	return factory_ai_normalize_confidence( $confidence );
}

function factory_ai_site_plan_pages_list( $pages ): array {
	$pages = is_array( $pages ) ? $pages : [];
	$normalized = [];

	foreach ( $pages as $page ) {
		if ( ! is_array( $page ) ) {
			continue;
		}

		$slug = sanitize_title( (string) ( $page['slug'] ?? '' ) );
		$title = factory_ai_site_plan_clamp_text( $page['title'] ?? '', 120 );
		$purpose = factory_ai_site_plan_clamp_text( $page['purpose'] ?? '', 180 );

		if ( '' === $slug || '' === $title ) {
			continue;
		}

		$normalized[] = [
			'slug'    => $slug,
			'title'   => $title,
			'purpose' => $purpose,
		];
	}

	return $normalized;
}

function factory_ai_site_plan_sections_list( $sections ): array {
	$sections = is_array( $sections ) ? $sections : [];
	$normalized = [];

	foreach ( $sections as $section ) {
		if ( ! is_array( $section ) ) {
			continue;
		}

		$page = sanitize_title( (string) ( $section['page'] ?? '' ) );
		$type = sanitize_key( (string) ( $section['type'] ?? '' ) );
		$purpose = factory_ai_site_plan_clamp_text( $section['purpose'] ?? '', 180 );

		if ( '' === $page || '' === $type ) {
			continue;
		}

		$normalized[] = [
			'page'    => $page,
			'type'    => $type,
			'purpose' => $purpose,
		];
	}

	return $normalized;
}

function factory_ai_site_plan_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_site_plan_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_site_plan_clamp_text( $value, int $max ): string {
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

function factory_ai_site_plan_clean_business_name( string $value ): string {
	$value = preg_replace( '/\s+(with|in|for|that|and)\s+.*$/i', '', $value );
	$value = trim( sanitize_text_field( $value ), " \t\n\r\0\x0B.,;:" );

	return factory_ai_site_plan_clamp_text( $value, 80 );
}

function factory_ai_site_plan_context_value( array $context, string $group, string $key, string $fallback ): string {
	$value = $context[ $group ][ $key ] ?? '';

	return is_string( $value ) && '' !== trim( $value ) ? sanitize_text_field( $value ) : $fallback;
}
