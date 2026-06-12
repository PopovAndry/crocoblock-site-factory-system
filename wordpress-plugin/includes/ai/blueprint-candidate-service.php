<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_blueprint_candidate( array $input = [] ): array {
	$prompt = $input['prompt'] ?? '';
	$site_plan = is_array( $input['site_plan'] ?? null ) ? $input['site_plan'] : [];
	$context = is_array( $input['context'] ?? null ) ? $input['context'] : [];
	$requested_site_type = factory_ai_blueprint_candidate_normalize_site_type(
		(string) ( $input['site_type'] ?? $input['vertical'] ?? '' )
	);

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$context = factory_ai_blueprint_candidate_normalize_context( $context );

	if ( empty( $site_plan ) && '' === trim( $prompt ) ) {
		return factory_ai_blueprint_candidate_response(
			[
				'status'       => 'error',
				'code'         => 'missing_candidate_input',
				'message'      => 'Provide a prompt or a site plan before building a blueprint candidate.',
				'vertical'     => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'site_type'    => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'next_step'    => 'enter_prompt',
				'warnings'     => [
					'No provider call was made.',
					'No site changes were made.',
				],
			]
		);
	}

	$source_site_plan = ! empty( $site_plan )
		? factory_ai_blueprint_candidate_normalize_site_plan( $site_plan )
		: factory_ai_build_site_plan(
			$prompt,
			$context,
			[
				'site_type' => $requested_site_type,
			]
		);

	$site_type = factory_ai_blueprint_candidate_normalize_site_type(
		(string) ( $source_site_plan['site_type'] ?? $source_site_plan['vertical'] ?? $requested_site_type )
	);
	$vertical = factory_ai_blueprint_candidate_normalize_site_type(
		(string) ( $source_site_plan['vertical'] ?? $site_type )
	);

	if ( 'real_estate' !== $site_type || 'real_estate' !== $vertical ) {
		return factory_ai_blueprint_candidate_response(
			[
				'status'               => 'warning',
				'code'                 => 'unsupported_site_type',
				'message'              => 'Blueprint Candidate v1 currently supports the Real Estate vertical only.',
				'vertical'             => 'unknown' !== $vertical ? $vertical : $site_type,
				'site_type'            => 'unknown' !== $site_type ? $site_type : $vertical,
				'source_site_plan'     => $source_site_plan,
				'candidate'            => null,
				'supported_sections'   => [],
				'unsupported_requests' => factory_ai_blueprint_candidate_merge_unsupported(
					$source_site_plan['unsupported_requests'] ?? [],
					[
						[
							'label'            => 'Unsupported vertical',
							'reason'           => 'Blueprint Candidate v1 can only shape a Real Estate candidate in this beta.',
							'safe_alternative' => 'Use the Real Estate site type for the current supported flow.',
						],
					]
				),
				'risks'                => [
					'A supported preset does not exist yet for this site type.',
					'No candidate was generated because the current beta only supports Real Estate.',
				],
				'warnings'             => [
					'Candidate only. No blueprint was applied.',
					'No site changes were made.',
				],
				'next_step'            => 'choose_supported_vertical',
			]
		);
	}

	$baseline = factory_ai_blueprint_candidate_load_real_estate_preset();

	if ( empty( $baseline ) ) {
		return factory_ai_blueprint_candidate_response(
			[
				'status'           => 'error',
				'code'             => 'baseline_unavailable',
				'message'          => 'The Real Estate preset baseline is unavailable for Blueprint Candidate v1.',
				'vertical'         => 'real_estate',
				'site_type'        => 'real_estate',
				'source_site_plan' => $source_site_plan,
				'candidate'        => null,
				'risks'            => [
					'Without the Real Estate preset baseline, the candidate cannot be shaped safely.',
				],
				'warnings'         => [
					'Candidate only. No blueprint was applied.',
					'No site changes were made.',
				],
				'next_step'        => 'restore_baseline_preset',
			]
		);
	}

	$display_name = factory_ai_blueprint_candidate_display_name( $source_site_plan, $context, $baseline );
	$candidate = factory_ai_blueprint_candidate_build_from_baseline( $baseline, $source_site_plan, $context, $display_name );
	$unsupported_requests = factory_ai_blueprint_candidate_merge_unsupported(
		$source_site_plan['unsupported_requests'] ?? [],
		[]
	);
	$warnings = [
		'Candidate only. No blueprint was applied.',
		'No site changes were made.',
	];

	if ( ! empty( $unsupported_requests ) ) {
		$warnings[] = 'Some requested capabilities remain outside the current deterministic Real Estate beta flow.';
	}

	return factory_ai_blueprint_candidate_response(
		[
			'status'               => ! empty( $unsupported_requests ) ? 'warning' : 'ok',
			'code'                 => ! empty( $unsupported_requests ) ? 'blueprint_candidate_ready_with_warnings' : 'blueprint_candidate_ready',
			'message'              => ! empty( $unsupported_requests )
				? 'Blueprint candidate ready for review with warnings.'
				: 'Blueprint candidate ready for review.',
			'vertical'             => 'real_estate',
			'site_type'            => 'real_estate',
			'recommended_preset'   => 'real-estate',
			'source_site_plan'     => $source_site_plan,
			'candidate'            => $candidate,
			'supported_sections'   => [
				'site',
				'theme',
				'plugins',
				'pages',
				'cpt',
				'meta_fields',
				'taxonomies',
				'content_model',
				'queries',
				'listings',
				'templates',
				'forms',
				'filters',
				'assets',
				'validation_expectations',
			],
			'unsupported_requests' => $unsupported_requests,
			'risks'                => factory_ai_blueprint_candidate_risks( $source_site_plan, $unsupported_requests ),
			'warnings'             => array_merge(
				$warnings,
				is_array( $source_site_plan['warnings'] ?? null ) ? factory_ai_normalize_string_list( $source_site_plan['warnings'], 200 ) : []
			),
			'next_step'            => 'review_blueprint_candidate',
		]
	);
}

function factory_ai_blueprint_candidate_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$status = 'error';
	}

	$vertical = factory_ai_blueprint_candidate_normalize_site_type(
		(string) ( $overrides['vertical'] ?? 'unknown' )
	);
	$site_type = factory_ai_blueprint_candidate_normalize_site_type(
		(string) ( $overrides['site_type'] ?? $vertical )
	);

	return [
		'status'               => $status,
		'code'                 => sanitize_key( (string) ( $overrides['code'] ?? 'blueprint_candidate_unavailable' ) ),
		'message'              => sanitize_text_field( (string) ( $overrides['message'] ?? 'Blueprint candidate is unavailable.' ) ),
		'provider'             => 'local',
		'mode'                 => 'blueprint_candidate_v1',
		'applies_changes'      => false,
		'provider_called'      => false,
		'vertical'             => $vertical,
		'recommended_preset'   => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'source_site_plan'     => factory_ai_blueprint_candidate_normalize_site_plan( $overrides['source_site_plan'] ?? [] ),
		'candidate'            => factory_ai_blueprint_candidate_normalize_candidate( $overrides['candidate'] ?? null ),
		'supported_sections'   => factory_ai_blueprint_candidate_text_list( $overrides['supported_sections'] ?? [], 80 ),
		'unsupported_requests' => factory_ai_normalize_unsupported_items( $overrides['unsupported_requests'] ?? [] ),
		'risks'                => factory_ai_blueprint_candidate_text_list( $overrides['risks'] ?? [], 220 ),
		'warnings'             => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 220 ),
		'next_step'            => sanitize_key( (string) ( $overrides['next_step'] ?? 'review_blueprint_candidate' ) ),
		'usage'                => null,
		'site_type'            => $site_type,
	];
}

function factory_ai_blueprint_candidate_load_real_estate_preset(): array {
	$path = FACTORY_PLUGIN_DIR . 'presets/real-estate.json';

	if ( ! file_exists( $path ) ) {
		return [];
	}

	$decoded = json_decode( file_get_contents( $path ), true );

	return is_array( $decoded ) ? $decoded : [];
}

function factory_ai_blueprint_candidate_display_name( array $site_plan, array $context, array $baseline ): string {
	$agency_name = factory_ai_site_plan_context_value( $context, 'preset_variables', 'agency_name', '' );

	if ( '' !== $agency_name ) {
		return factory_ai_blueprint_candidate_clamp_text( $agency_name, 120 );
	}

	$summary = (string) ( $site_plan['business_summary'] ?? '' );

	if ( preg_match( '/^(.+?)\s+is a real estate business/i', $summary, $matches ) ) {
		return factory_ai_blueprint_candidate_clamp_text( $matches[1], 120 );
	}

	return factory_ai_blueprint_candidate_clamp_text( $baseline['site']['name'] ?? 'Real Estate Demo', 120 );
}

function factory_ai_blueprint_candidate_build_from_baseline( array $baseline, array $site_plan, array $context, string $display_name ): array {
	$pages = factory_ai_blueprint_candidate_pages( $baseline, $display_name );
	$cpt = factory_ai_blueprint_candidate_cpt( $baseline );
	$taxonomies = factory_ai_blueprint_candidate_taxonomies( $baseline );
	$queries = factory_ai_blueprint_candidate_queries( $baseline );
	$listings = factory_ai_blueprint_candidate_listings( $baseline );
	$templates = factory_ai_blueprint_candidate_templates( $baseline );
	$filters = factory_ai_blueprint_candidate_filters( $baseline );
	$forms = factory_ai_blueprint_candidate_forms( $baseline, $context );
	$meta_fields = factory_ai_blueprint_candidate_meta_fields( $baseline );

	return [
		'version'                 => 'candidate-v1',
		'baseline_version'        => sanitize_text_field( (string) ( $baseline['version'] ?? '0.2' ) ),
		'site'                    => [
			'name'               => $display_name,
			'language'           => sanitize_text_field( (string) ( $baseline['site']['language'] ?? 'en' ) ),
			'permalink'          => sanitize_text_field( (string) ( $baseline['site']['permalink'] ?? '/%postname%/' ) ),
			'theme'              => sanitize_text_field( (string) ( $baseline['theme']['slug'] ?? 'kava' ) ),
			'style'              => [
				'primary'    => sanitize_hex_color( (string) ( $baseline['site']['style']['primary'] ?? '#0f766e' ) ) ?: '#0f766e',
				'accent'     => sanitize_hex_color( (string) ( $baseline['site']['style']['accent'] ?? '#14b8a6' ) ) ?: '#14b8a6',
				'background' => sanitize_hex_color( (string) ( $baseline['site']['style']['background'] ?? '#ecfeff' ) ) ?: '#ecfeff',
			],
			'navigation'         => factory_ai_blueprint_candidate_navigation( $baseline ),
			'business_summary'   => factory_ai_blueprint_candidate_clamp_text( $site_plan['business_summary'] ?? '', 280 ),
			'front_page_slug'    => 'home',
			'archive_page_slug'  => 'properties',
			'contact_page_slug'  => 'contact',
		],
		'pages'                   => $pages,
		'cpt'                     => $cpt,
		'meta_fields'             => $meta_fields,
		'taxonomies'              => $taxonomies,
		'content_model'           => [
			'entity'                 => 'property',
			'items_planned'          => isset( $baseline['content']['property'] ) && is_array( $baseline['content']['property'] ) ? count( $baseline['content']['property'] ) : 0,
			'featured_image_strategy'=> 'bundled_demo_pool',
			'sample_titles'          => factory_ai_blueprint_candidate_sample_titles( $baseline ),
		],
		'queries'                 => $queries,
		'listings'                => $listings,
		'templates'               => $templates,
		'forms'                   => $forms,
		'filters'                 => $filters,
		'assets'                  => factory_ai_blueprint_candidate_assets( $baseline ),
		'validation_expectations' => [
			'Required runtime dependencies must be available before controlled generate.',
			'Factory-managed pages should render Home, Properties, and Contact correctly.',
			'Property CPT, taxonomies, listing, and single property template should validate after apply.',
			'JetSmartFilters and JetFormBuilder remain optional in the current beta flow.',
		],
	];
}

function factory_ai_blueprint_candidate_pages( array $baseline, string $display_name ): array {
	$pages = [];
	$pages_config = is_array( $baseline['pages'] ?? null ) ? $baseline['pages'] : [];

	foreach ( [ 'home', 'archive', 'native_filters', 'contact' ] as $key ) {
		$page = is_array( $pages_config[ $key ] ?? null ) ? $pages_config[ $key ] : [];

		if ( empty( $page ) ) {
			continue;
		}

		$title = (string) ( $page['title'] ?? ucfirst( $key ) );

		if ( 'home' === $key ) {
			$title = $display_name;
		} elseif ( 'contact' === $key ) {
			$title = 'Contact ' . $display_name;
		}

		$pages[] = [
			'key'             => $key,
			'slug'            => sanitize_title( (string) ( $page['slug'] ?? $key ) ),
			'title'           => factory_ai_blueprint_candidate_clamp_text( $title, 140 ),
			'front_page'      => ! empty( $page['front_page'] ),
			'experimental'    => ! empty( $page['experimental'] ),
			'planned_sections' => factory_ai_blueprint_candidate_page_sections( $page ),
		];
	}

	return $pages;
}

function factory_ai_blueprint_candidate_page_sections( array $page ): array {
	$sections = is_array( $page['sections'] ?? null ) ? $page['sections'] : [];
	$planned = [];

	foreach ( $sections as $section ) {
		if ( ! is_array( $section ) ) {
			continue;
		}

		$planned[] = [
			'type'    => sanitize_key( (string) ( $section['type'] ?? 'section' ) ),
			'title'   => factory_ai_blueprint_candidate_clamp_text( $section['title'] ?? '', 140 ),
			'purpose' => factory_ai_blueprint_candidate_section_purpose( $section ),
		];
	}

	return $planned;
}

function factory_ai_blueprint_candidate_section_purpose( array $section ): string {
	$type = sanitize_key( (string) ( $section['type'] ?? '' ) );

	$map = [
		'hero'    => 'Introduce the business and primary call to action.',
		'listing' => 'Display a deterministic property collection.',
		'cta'     => 'Encourage contact or request viewing actions.',
	];

	return $map[ $type ] ?? 'Support the page structure in the deterministic Real Estate flow.';
}

function factory_ai_blueprint_candidate_cpt( array $baseline ): array {
	$cpt_items = is_array( $baseline['cpt'] ?? null ) ? $baseline['cpt'] : [];
	$normalized = [];

	foreach ( $cpt_items as $cpt ) {
		if ( ! is_array( $cpt ) ) {
			continue;
		}

		$normalized[] = [
			'slug'     => sanitize_key( (string) ( $cpt['slug'] ?? '' ) ),
			'label'    => factory_ai_blueprint_candidate_clamp_text( $cpt['label'] ?? '', 120 ),
			'singular' => factory_ai_blueprint_candidate_clamp_text( $cpt['singular'] ?? '', 120 ),
			'supports' => factory_ai_blueprint_candidate_text_list( $cpt['supports'] ?? [], 60 ),
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_meta_fields( array $baseline ): array {
	$meta_fields = [];
	$cpt_items = is_array( $baseline['cpt'] ?? null ) ? $baseline['cpt'] : [];

	foreach ( $cpt_items as $cpt ) {
		if ( ! is_array( $cpt ) ) {
			continue;
		}

		$post_type = sanitize_key( (string) ( $cpt['slug'] ?? '' ) );

		foreach ( is_array( $cpt['meta'] ?? null ) ? $cpt['meta'] : [] as $meta ) {
			if ( ! is_array( $meta ) ) {
				continue;
			}

			$meta_fields[] = [
				'post_type' => $post_type,
				'key'       => sanitize_key( (string) ( $meta['key'] ?? '' ) ),
				'type'      => sanitize_key( (string) ( $meta['type'] ?? 'text' ) ),
				'label'     => factory_ai_blueprint_candidate_clamp_text( $meta['label'] ?? '', 120 ),
			];
		}
	}

	return $meta_fields;
}

function factory_ai_blueprint_candidate_taxonomies( array $baseline ): array {
	$items = is_array( $baseline['taxonomies'] ?? null ) ? $baseline['taxonomies'] : [];
	$normalized = [];

	foreach ( $items as $taxonomy ) {
		if ( ! is_array( $taxonomy ) ) {
			continue;
		}

		$normalized[] = [
			'slug'       => sanitize_key( (string) ( $taxonomy['slug'] ?? '' ) ),
			'label'      => factory_ai_blueprint_candidate_clamp_text( $taxonomy['label'] ?? '', 120 ),
			'post_type'  => sanitize_key( (string) ( $taxonomy['post_type'] ?? '' ) ),
			'term_count' => is_array( $taxonomy['terms'] ?? null ) ? count( $taxonomy['terms'] ) : 0,
			'sample_terms' => array_slice( factory_ai_blueprint_candidate_text_list( $taxonomy['terms'] ?? [], 80 ), 0, 4 ),
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_queries( array $baseline ): array {
	$items = is_array( $baseline['queries'] ?? null ) ? $baseline['queries'] : [];
	$normalized = [];

	foreach ( $items as $query ) {
		if ( ! is_array( $query ) ) {
			continue;
		}

		$normalized[] = [
			'slug'           => sanitize_key( str_replace( '-', '_', (string) ( $query['slug'] ?? '' ) ) ),
			'label'          => factory_ai_blueprint_candidate_clamp_text( $query['label'] ?? '', 120 ),
			'provider'       => sanitize_key( (string) ( $query['provider'] ?? '' ) ),
			'type'           => sanitize_key( (string) ( $query['type'] ?? '' ) ),
			'post_type'      => sanitize_key( (string) ( $query['post_type'] ?? '' ) ),
			'posts_per_page' => isset( $query['posts_per_page'] ) ? (int) $query['posts_per_page'] : 0,
			'native_filters' => ! empty( $query['native_filters'] ),
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_listings( array $baseline ): array {
	$items = is_array( $baseline['listings'] ?? null ) ? $baseline['listings'] : [];
	$normalized = [];

	foreach ( $items as $listing ) {
		if ( ! is_array( $listing ) ) {
			continue;
		}

		$normalized[] = [
			'slug'           => sanitize_key( str_replace( '-', '_', (string) ( $listing['slug'] ?? '' ) ) ),
			'title'          => factory_ai_blueprint_candidate_clamp_text( $listing['title'] ?? '', 120 ),
			'post_type'      => sanitize_key( (string) ( $listing['post_type'] ?? '' ) ),
			'query'          => sanitize_key( str_replace( '-', '_', (string) ( $listing['query'] ?? '' ) ) ),
			'layout_items'   => is_array( $listing['layout'] ?? null ) ? count( $listing['layout'] ) : 0,
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_templates( array $baseline ): array {
	$single = is_array( $baseline['single'] ?? null ) ? $baseline['single'] : [];
	$templates = [];

	foreach ( $single as $entity => $config ) {
		if ( ! is_array( $config ) ) {
			continue;
		}

		$templates[] = [
			'entity'       => sanitize_key( (string) $entity ),
			'layout_items' => is_array( $config['layout'] ?? null ) ? count( $config['layout'] ) : 0,
			'layout_types' => array_values(
				array_filter(
					array_map(
						static function ( $item ) {
							return is_array( $item ) ? sanitize_key( (string) ( $item['type'] ?? '' ) ) : '';
						},
						is_array( $config['layout'] ?? null ) ? $config['layout'] : []
					)
				)
			),
		];
	}

	return $templates;
}

function factory_ai_blueprint_candidate_filters( array $baseline ): array {
	$items = is_array( $baseline['filters'] ?? null ) ? $baseline['filters'] : [];
	$normalized = [];

	foreach ( $items as $filter ) {
		if ( ! is_array( $filter ) ) {
			continue;
		}

		$normalized[] = [
			'slug'      => sanitize_key( str_replace( '-', '_', (string) ( $filter['slug'] ?? '' ) ) ),
			'label'     => factory_ai_blueprint_candidate_clamp_text( $filter['label'] ?? '', 120 ),
			'provider'  => sanitize_key( (string) ( $filter['provider'] ?? '' ) ),
			'type'      => sanitize_key( (string) ( $filter['type'] ?? '' ) ),
			'source'    => sanitize_key( (string) ( $filter['source'] ?? '' ) ),
			'taxonomy'  => sanitize_key( (string) ( $filter['taxonomy'] ?? '' ) ),
			'query_var' => sanitize_key( (string) ( $filter['query_var'] ?? '' ) ),
			'required'  => ! empty( $filter['required'] ),
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_forms( array $baseline, array $context ): array {
	$forms = [];
	$request_viewing = is_array( $baseline['site']['forms']['request_viewing'] ?? null )
		? $baseline['site']['forms']['request_viewing']
		: [];

	if ( ! empty( $request_viewing ) ) {
		$fallback_email = factory_ai_site_plan_context_value(
			$context,
			'preset_variables',
			'email',
			(string) ( $request_viewing['fallback_email'] ?? '' )
		);

		$forms[] = [
			'slug'           => 'request_viewing',
			'title'          => factory_ai_blueprint_candidate_clamp_text( $request_viewing['title'] ?? 'Request a Viewing', 120 ),
			'enabled'        => ! empty( $request_viewing['enabled'] ),
			'provider'       => sanitize_key( (string) ( $request_viewing['provider'] ?? 'auto' ) ),
			'fallback_email' => sanitize_email( $fallback_email ),
		];
	}

	return $forms;
}

function factory_ai_blueprint_candidate_assets( array $baseline ): array {
	$property_images = is_array( $baseline['site']['assets']['property_images'] ?? null )
		? $baseline['site']['assets']['property_images']
		: [];
	$pools = [];

	foreach ( $property_images as $label => $items ) {
		$pools[] = [
			'pool'   => factory_ai_blueprint_candidate_clamp_text( $label, 80 ),
			'count'  => is_array( $items ) ? count( $items ) : 0,
			'source' => 'bundled_demo_pool',
		];
	}

	return [
		'image_strategy' => 'bundled_demo_pool',
		'image_mode'     => 'round_robin',
		'image_pools'    => $pools,
	];
}

function factory_ai_blueprint_candidate_navigation( array $baseline ): array {
	$items = is_array( $baseline['pages']['navigation']['items'] ?? null ) ? $baseline['pages']['navigation']['items'] : [];
	$labels = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$label = factory_ai_blueprint_candidate_clamp_text( $item['label'] ?? '', 80 );

		if ( '' !== $label ) {
			$labels[] = $label;
		}
	}

	return [
		'menu_name'       => factory_ai_blueprint_candidate_clamp_text( $baseline['pages']['navigation']['menu_name'] ?? 'Factory Main Menu', 120 ),
		'theme_location'  => sanitize_key( (string) ( $baseline['pages']['navigation']['theme_location'] ?? 'main' ) ),
		'planned_labels'  => $labels,
	];
}

function factory_ai_blueprint_candidate_sample_titles( array $baseline ): array {
	$items = is_array( $baseline['content']['property'] ?? null ) ? $baseline['content']['property'] : [];
	$titles = [];

	foreach ( array_slice( $items, 0, 3 ) as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$title = factory_ai_blueprint_candidate_clamp_text( $item['title'] ?? '', 120 );

		if ( '' !== $title ) {
			$titles[] = $title;
		}
	}

	return $titles;
}

function factory_ai_blueprint_candidate_risks( array $site_plan, array $unsupported_requests ): array {
	$risks = [
		'Candidate review does not validate runtime dependencies or apply behavior by itself.',
		'Controlled generation will still depend on the current Real Estate preset and available Crocoblock runtime.',
	];

	foreach ( factory_ai_blueprint_candidate_text_list( $site_plan['risks'] ?? [], 220 ) as $risk ) {
		$risks[] = $risk;
	}

	if ( ! empty( $unsupported_requests ) ) {
		$risks[] = 'Unsupported requests still require a future candidate or patch flow outside Blueprint Candidate v1.';
	}

	return array_values( array_unique( $risks ) );
}

function factory_ai_blueprint_candidate_normalize_site_plan( $site_plan ): array {
	if ( ! is_array( $site_plan ) ) {
		return [];
	}

	return [
		'status'               => sanitize_key( (string) ( $site_plan['status'] ?? 'error' ) ),
		'code'                 => sanitize_key( (string) ( $site_plan['code'] ?? '' ) ),
		'message'              => factory_ai_blueprint_candidate_clamp_text( $site_plan['message'] ?? '', 200 ),
		'provider'             => sanitize_key( (string) ( $site_plan['provider'] ?? 'local' ) ),
		'mode'                 => sanitize_key( (string) ( $site_plan['mode'] ?? 'site_plan_v1' ) ),
		'applies_changes'      => false,
		'provider_called'      => false,
		'vertical'             => factory_ai_blueprint_candidate_normalize_site_type( (string) ( $site_plan['vertical'] ?? 'unknown' ) ),
		'confidence'           => factory_ai_normalize_confidence( $site_plan['confidence'] ?? 0 ),
		'recommended_preset'   => sanitize_text_field( (string) ( $site_plan['recommended_preset'] ?? '' ) ),
		'site_type'            => factory_ai_blueprint_candidate_normalize_site_type( (string) ( $site_plan['site_type'] ?? 'unknown' ) ),
		'business_summary'     => factory_ai_blueprint_candidate_clamp_text( $site_plan['business_summary'] ?? '', 280 ),
		'pages'                => factory_ai_blueprint_candidate_page_summary_list( $site_plan['pages'] ?? [] ),
		'sections'             => factory_ai_blueprint_candidate_section_summary_list( $site_plan['sections'] ?? [] ),
		'required_structures'  => factory_ai_blueprint_candidate_text_list( $site_plan['required_structures'] ?? [], 120 ),
		'crocoblock_components'=> factory_ai_blueprint_candidate_text_list( $site_plan['crocoblock_components'] ?? [], 120 ),
		'supported_features'   => factory_ai_blueprint_candidate_text_list( $site_plan['supported_features'] ?? [], 120 ),
		'unsupported_requests' => factory_ai_normalize_unsupported_items( $site_plan['unsupported_requests'] ?? [] ),
		'risks'                => factory_ai_blueprint_candidate_text_list( $site_plan['risks'] ?? [], 220 ),
		'next_step'            => sanitize_key( (string) ( $site_plan['next_step'] ?? 'review_site_plan' ) ),
		'warnings'             => factory_ai_normalize_string_list( $site_plan['warnings'] ?? [], 200 ),
		'usage'                => null,
	];
}

function factory_ai_blueprint_candidate_normalize_candidate( $candidate ) {
	if ( ! is_array( $candidate ) ) {
		return null;
	}

	return [
		'version'                 => factory_ai_blueprint_candidate_clamp_text( $candidate['version'] ?? '', 80 ),
		'baseline_version'        => factory_ai_blueprint_candidate_clamp_text( $candidate['baseline_version'] ?? '', 80 ),
		'site'                    => is_array( $candidate['site'] ?? null ) ? $candidate['site'] : [],
		'pages'                   => factory_ai_blueprint_candidate_page_summary_list( $candidate['pages'] ?? [] ),
		'cpt'                     => is_array( $candidate['cpt'] ?? null ) ? array_values( $candidate['cpt'] ) : [],
		'meta_fields'             => is_array( $candidate['meta_fields'] ?? null ) ? array_values( $candidate['meta_fields'] ) : [],
		'taxonomies'              => is_array( $candidate['taxonomies'] ?? null ) ? array_values( $candidate['taxonomies'] ) : [],
		'content_model'           => is_array( $candidate['content_model'] ?? null ) ? $candidate['content_model'] : [],
		'queries'                 => is_array( $candidate['queries'] ?? null ) ? array_values( $candidate['queries'] ) : [],
		'listings'                => is_array( $candidate['listings'] ?? null ) ? array_values( $candidate['listings'] ) : [],
		'templates'               => is_array( $candidate['templates'] ?? null ) ? array_values( $candidate['templates'] ) : [],
		'forms'                   => is_array( $candidate['forms'] ?? null ) ? array_values( $candidate['forms'] ) : [],
		'filters'                 => is_array( $candidate['filters'] ?? null ) ? array_values( $candidate['filters'] ) : [],
		'assets'                  => is_array( $candidate['assets'] ?? null ) ? $candidate['assets'] : [],
		'validation_expectations' => factory_ai_blueprint_candidate_text_list( $candidate['validation_expectations'] ?? [], 220 ),
	];
}

function factory_ai_blueprint_candidate_page_summary_list( $pages ): array {
	$pages = is_array( $pages ) ? $pages : [];
	$normalized = [];

	foreach ( $pages as $page ) {
		if ( ! is_array( $page ) ) {
			continue;
		}

		$normalized[] = [
			'key'              => sanitize_key( (string) ( $page['key'] ?? '' ) ),
			'slug'             => sanitize_title( (string) ( $page['slug'] ?? '' ) ),
			'title'            => factory_ai_blueprint_candidate_clamp_text( $page['title'] ?? '', 140 ),
			'front_page'       => ! empty( $page['front_page'] ),
			'experimental'     => ! empty( $page['experimental'] ),
			'planned_sections' => factory_ai_blueprint_candidate_section_summary_list( $page['planned_sections'] ?? [] ),
			'purpose'          => factory_ai_blueprint_candidate_clamp_text( $page['purpose'] ?? '', 180 ),
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_section_summary_list( $sections ): array {
	$sections = is_array( $sections ) ? $sections : [];
	$normalized = [];

	foreach ( $sections as $section ) {
		if ( ! is_array( $section ) ) {
			continue;
		}

		$normalized[] = [
			'page'    => sanitize_title( (string) ( $section['page'] ?? '' ) ),
			'type'    => sanitize_key( (string) ( $section['type'] ?? '' ) ),
			'title'   => factory_ai_blueprint_candidate_clamp_text( $section['title'] ?? '', 140 ),
			'purpose' => factory_ai_blueprint_candidate_clamp_text( $section['purpose'] ?? '', 180 ),
		];
	}

	return $normalized;
}

function factory_ai_blueprint_candidate_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_blueprint_candidate_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_blueprint_candidate_clamp_text( $value, int $max ): string {
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

function factory_ai_blueprint_candidate_normalize_context( array $context ): array {
	if ( function_exists( 'factory_rest_ai_site_plan_sanitize_context' ) ) {
		return factory_rest_ai_site_plan_sanitize_context( $context );
	}

	return $context;
}

function factory_ai_blueprint_candidate_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}

function factory_ai_blueprint_candidate_merge_unsupported( $left, $right ): array {
	$items = array_merge(
		is_array( $left ) ? $left : [],
		is_array( $right ) ? $right : []
	);
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
