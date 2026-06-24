<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_preview_diff( array $input = [] ): array {
	$prompt = $input['prompt'] ?? '';
	$site_plan = is_array( $input['site_plan'] ?? null ) ? $input['site_plan'] : [];
	$blueprint_candidate = $input['blueprint_candidate'] ?? [];
	$context = is_array( $input['context'] ?? null ) ? $input['context'] : [];
	$requested_site_type = factory_ai_preview_diff_normalize_site_type(
		(string) ( $input['site_type'] ?? $input['vertical'] ?? '' )
	);

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$context = factory_ai_preview_diff_normalize_context( $context );

	if ( empty( $site_plan ) && empty( $blueprint_candidate ) && '' === trim( $prompt ) ) {
		return factory_ai_preview_diff_response(
			[
				'status'    => 'error',
				'code'      => 'missing_preview_input',
				'message'   => 'Provide a prompt, site plan, or blueprint candidate before building a preview.',
				'vertical'  => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'warnings'  => [
					'Preview only. No site changes were made.',
					'No BlueprintPatch was generated.',
				],
				'next_step' => 'enter_prompt',
			]
		);
	}

	$source_site_plan = ! empty( $site_plan )
		? factory_ai_preview_diff_normalize_site_plan_source( $site_plan )
		: factory_ai_build_site_plan(
			$prompt,
			$context,
			[
				'site_type' => $requested_site_type,
			]
		);

	$source_blueprint_candidate = factory_ai_preview_diff_resolve_candidate(
		$blueprint_candidate,
		$source_site_plan,
		$prompt,
		$context,
		$requested_site_type
	);

	$vertical = factory_ai_preview_diff_normalize_site_type(
		(string) (
			$source_blueprint_candidate['vertical']
			?? $source_site_plan['vertical']
			?? $source_site_plan['site_type']
			?? $requested_site_type
			?? 'unknown'
		)
	);

	if ( 'real_estate' !== $vertical ) {
		return factory_ai_preview_diff_response(
			[
				'status'                   => 'warning',
				'code'                     => 'unsupported_site_type',
				'message'                  => 'Preview/Diff v1 currently supports the Real Estate vertical only.',
				'vertical'                 => $vertical,
				'recommended_preset'       => '',
				'source_site_plan'         => $source_site_plan,
				'source_blueprint_candidate' => $source_blueprint_candidate,
				'preview'                  => [
					'summary'            => 'A supported preview/diff cannot be prepared for this site type in the current beta.',
					'readiness'          => 'unsupported',
					'can_generate_later' => false,
				],
				'diff_summary'             => [
					'creates'     => 0,
					'updates'     => 0,
					'skips'       => 0,
					'warnings'    => 1,
					'unsupported' => 1,
					'note'        => 'Preview only. A supported Real Estate candidate is required before controlled generate later.',
				],
				'unsupported_requests'     => factory_ai_preview_diff_merge_unsupported(
					$source_site_plan['unsupported_requests'] ?? [],
					$source_blueprint_candidate['unsupported_requests'] ?? []
				),
				'risks'                    => [
					'No supported candidate is available for this site type in Preview/Diff v1.',
				],
				'warnings'                 => [
					'Preview only. No site changes were made.',
					'No BlueprintPatch was generated.',
				],
				'next_step'                => 'choose_supported_vertical',
			]
		);
	}

	$candidate_body = is_array( $source_blueprint_candidate['candidate'] ?? null ) ? $source_blueprint_candidate['candidate'] : [];

	if ( empty( $candidate_body ) ) {
		return factory_ai_preview_diff_response(
			[
				'status'                   => 'error',
				'code'                     => 'candidate_unavailable',
				'message'                  => 'Preview/Diff v1 requires a valid Real Estate blueprint candidate.',
				'vertical'                 => 'real_estate',
				'recommended_preset'       => sanitize_text_field( (string) ( $source_blueprint_candidate['recommended_preset'] ?? 'real-estate' ) ),
				'source_site_plan'         => $source_site_plan,
				'source_blueprint_candidate' => $source_blueprint_candidate,
				'preview'                  => [
					'summary'            => 'The candidate is unavailable, so a human-readable preview cannot be prepared yet.',
					'readiness'          => 'candidate_required',
					'can_generate_later' => false,
				],
				'diff_summary'             => [
					'creates'     => 0,
					'updates'     => 0,
					'skips'       => 0,
					'warnings'    => 1,
					'unsupported' => 0,
					'note'        => 'Preview only. Candidate data is required before controlled generate later.',
				],
				'risks'                    => [
					'Without a structured candidate, the preview cannot describe the planned site safely.',
				],
				'warnings'                 => [
					'Preview only. No site changes were made.',
					'No BlueprintPatch was generated.',
				],
				'next_step'                => 'review_blueprint_candidate',
			]
		);
	}

	$create_preview = factory_ai_preview_diff_build_create_preview( $candidate_body );
	$update_preview = factory_ai_preview_diff_build_update_preview( $candidate_body, $source_site_plan );
	$skip_preview = factory_ai_preview_diff_build_skip_preview( $source_blueprint_candidate, $source_site_plan );
	$optional_features = factory_ai_preview_diff_optional_features( $source_site_plan, $candidate_body );
	$design_capabilities = function_exists( 'factory_ai_design_profile_capability_matrix' )
		? factory_ai_design_profile_capability_matrix(
			[
				'locale'         => is_array( $source_site_plan['locale'] ?? null ) ? $source_site_plan['locale'] : [],
				'design_profile' => is_array( $candidate_body['design_profile'] ?? null ) ? $candidate_body['design_profile'] : [],
			]
		)
		: [ 'summary' => [], 'items' => [] ];
	$design_capability_summary = function_exists( 'factory_ai_design_profile_capability_summary' )
		? factory_ai_design_profile_capability_summary( $design_capabilities )
		: [ 'planning_only' => 0, 'planning_only_fields' => [], 'unsupported' => 0, 'unsupported_fields' => [] ];
	$unsupported_requests = factory_ai_preview_diff_merge_unsupported(
		$source_site_plan['unsupported_requests'] ?? [],
		$source_blueprint_candidate['unsupported_requests'] ?? []
	);
	$risks = factory_ai_preview_diff_risks( $source_site_plan, $source_blueprint_candidate, $unsupported_requests );
	$warnings = [
		'Preview only. No site changes were made.',
		'No BlueprintPatch was generated.',
		'Runtime diff will be computed during controlled generate or dry-run later.',
	];

	if ( ! empty( $unsupported_requests ) ) {
		$warnings[] = 'Some requested capabilities remain outside the supported Real Estate beta flow.';
	}

	if ( ! empty( $design_capability_summary['planning_only'] ) ) {
		$warnings[] = 'Some design choices are planning-only and will not affect current deterministic generation output yet.';
	}

	return factory_ai_preview_diff_response(
		[
			'status'                     => ! empty( $unsupported_requests ) ? 'warning' : 'ok',
			'code'                       => ! empty( $unsupported_requests ) ? 'preview_diff_ready_with_warnings' : 'preview_diff_ready',
			'message'                    => ! empty( $unsupported_requests )
				? 'Preview/diff ready for review with warnings.'
				: 'Preview/diff ready for review.',
			'vertical'                   => 'real_estate',
			'recommended_preset'         => sanitize_text_field( (string) ( $source_blueprint_candidate['recommended_preset'] ?? 'real-estate' ) ),
			'source_site_plan'           => $source_site_plan,
			'source_blueprint_candidate' => $source_blueprint_candidate,
			'preview'                    => factory_ai_preview_diff_preview_summary( $candidate_body, $unsupported_requests ),
			'diff_summary'               => [
				'creates'     => count( $create_preview ),
				'updates'     => count( $update_preview ),
				'skips'       => count( $skip_preview ),
				'warnings'    => count( $warnings ),
				'unsupported' => count( $unsupported_requests ),
				'note'        => 'This is a proposal preview only. Runtime diff will be computed during controlled generate or dry-run later.',
			],
			'design_profile_summary'     => factory_ai_preview_diff_design_profile_summary(
				is_array( $candidate_body['design_profile'] ?? null ) ? $candidate_body['design_profile'] : [],
				is_array( $source_site_plan['locale'] ?? null ) ? $source_site_plan['locale'] : [],
				$design_capabilities
			),
			'design_profile_capabilities' => $design_capabilities,
			'create_preview'             => $create_preview,
			'update_preview'             => $update_preview,
			'skip_preview'               => $skip_preview,
			'optional_features'          => $optional_features,
			'unsupported_requests'       => $unsupported_requests,
			'risks'                      => $risks,
			'warnings'                   => array_values(
				array_unique(
					array_merge(
						$warnings,
						factory_ai_normalize_string_list( $source_site_plan['warnings'] ?? [], 220 ),
						factory_ai_normalize_string_list( $source_blueprint_candidate['warnings'] ?? [], 220 )
					)
				)
			),
			'next_step'                  => 'review_preview_diff',
		]
	);
}

function factory_ai_preview_diff_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$status = 'error';
	}

	$vertical = factory_ai_preview_diff_normalize_site_type(
		(string) ( $overrides['vertical'] ?? 'unknown' )
	);

	return [
		'status'                     => $status,
		'code'                       => sanitize_key( (string) ( $overrides['code'] ?? 'preview_diff_unavailable' ) ),
		'message'                    => sanitize_text_field( (string) ( $overrides['message'] ?? 'Preview/diff is unavailable.' ) ),
		'provider'                   => 'local',
		'mode'                       => 'preview_diff_v1',
		'applies_changes'            => false,
		'provider_called'            => false,
		'vertical'                   => $vertical,
		'recommended_preset'         => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'source_site_plan'           => factory_ai_preview_diff_normalize_site_plan_source( $overrides['source_site_plan'] ?? [] ),
		'source_blueprint_candidate' => factory_ai_preview_diff_normalize_candidate_source( $overrides['source_blueprint_candidate'] ?? [] ),
		'preview'                    => factory_ai_preview_diff_normalize_preview( $overrides['preview'] ?? [] ),
		'diff_summary'               => factory_ai_preview_diff_normalize_diff_summary( $overrides['diff_summary'] ?? [] ),
		'design_profile_summary'     => factory_ai_preview_diff_design_choice_items( $overrides['design_profile_summary'] ?? [] ),
		'design_profile_capabilities' => factory_ai_preview_diff_normalize_design_capabilities( $overrides['design_profile_capabilities'] ?? [] ),
		'create_preview'             => factory_ai_preview_diff_preview_items( $overrides['create_preview'] ?? [] ),
		'update_preview'             => factory_ai_preview_diff_preview_items( $overrides['update_preview'] ?? [] ),
		'skip_preview'               => factory_ai_preview_diff_preview_items( $overrides['skip_preview'] ?? [] ),
		'unsupported_requests'       => factory_ai_normalize_unsupported_items( $overrides['unsupported_requests'] ?? [] ),
		'optional_features'          => factory_ai_preview_diff_optional_feature_items( $overrides['optional_features'] ?? [] ),
		'risks'                      => factory_ai_normalize_string_list( $overrides['risks'] ?? [], 220 ),
		'warnings'                   => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 220 ),
		'next_step'                  => sanitize_key( (string) ( $overrides['next_step'] ?? 'review_preview_diff' ) ),
		'usage'                      => null,
	];
}

function factory_ai_preview_diff_resolve_candidate( $blueprint_candidate, array $source_site_plan, string $prompt, array $context, string $requested_site_type ): array {
	if ( is_array( $blueprint_candidate ) && ! empty( $blueprint_candidate ) ) {
		if ( isset( $blueprint_candidate['candidate'] ) || isset( $blueprint_candidate['mode'] ) ) {
			return factory_ai_preview_diff_normalize_candidate_source( $blueprint_candidate );
		}

		return factory_ai_preview_diff_normalize_candidate_source(
			[
				'status'             => 'ok',
				'code'               => 'blueprint_candidate_ready',
				'message'            => 'Blueprint candidate ready for review.',
				'provider'           => 'local',
				'mode'               => 'blueprint_candidate_v1',
				'vertical'           => $source_site_plan['vertical'] ?? $source_site_plan['site_type'] ?? $requested_site_type,
				'recommended_preset' => $source_site_plan['recommended_preset'] ?? '',
				'source_site_plan'   => $source_site_plan,
				'candidate'          => $blueprint_candidate,
				'warnings'           => [
					'Candidate only. No blueprint was applied.',
					'No site changes were made.',
				],
			]
		);
	}

	return factory_ai_build_blueprint_candidate(
		[
			'prompt'    => $prompt,
			'site_plan' => $source_site_plan,
			'site_type' => $requested_site_type,
			'context'   => $context,
		]
	);
}

function factory_ai_preview_diff_preview_summary( array $candidate_body, array $unsupported_requests ): array {
	$site_name = sanitize_text_field( (string) ( $candidate_body['site']['name'] ?? 'the supported Real Estate baseline' ) );

	return [
		'summary'            => sprintf(
			'This will prepare %s as a Real Estate site based on the supported deterministic baseline.',
			$site_name
		),
		'readiness'          => ! empty( $unsupported_requests ) ? 'review_required_with_warnings' : 'review_required',
		'can_generate_later' => empty( $candidate_body ) ? false : true,
	];
}

function factory_ai_preview_diff_build_create_preview( array $candidate_body ): array {
	$items = [];

	foreach ( is_array( $candidate_body['pages'] ?? null ) ? $candidate_body['pages'] : [] as $page ) {
		$items[] = [
			'type'    => 'page',
			'label'   => sanitize_text_field( (string) ( $page['title'] ?? '' ) ),
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Create the %s page as part of the generated Real Estate site.', (string) ( $page['title'] ?? 'planned' ) ),
				220
			),
		];
	}

	foreach ( is_array( $candidate_body['cpt'] ?? null ) ? $candidate_body['cpt'] : [] as $cpt ) {
		$items[] = [
			'type'    => 'cpt',
			'label'   => sanitize_text_field( (string) ( $cpt['label'] ?? $cpt['slug'] ?? '' ) ),
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Prepare the %s content structure for generated property content.', (string) ( $cpt['label'] ?? 'planned content type' ) ),
				220
			),
		];
	}

	foreach ( is_array( $candidate_body['taxonomies'] ?? null ) ? $candidate_body['taxonomies'] : [] as $taxonomy ) {
		$items[] = [
			'type'    => 'taxonomy',
			'label'   => sanitize_text_field( (string) ( $taxonomy['label'] ?? $taxonomy['slug'] ?? '' ) ),
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Prepare the %s taxonomy for property browsing and filtering.', (string) ( $taxonomy['label'] ?? 'planned taxonomy' ) ),
				220
			),
		];
	}

	foreach ( is_array( $candidate_body['listings'] ?? null ) ? $candidate_body['listings'] : [] as $listing ) {
		$items[] = [
			'type'    => 'listing',
			'label'   => sanitize_text_field( (string) ( $listing['title'] ?? $listing['slug'] ?? '' ) ),
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Prepare the %s listing for deterministic property cards.', (string) ( $listing['title'] ?? 'planned listing' ) ),
				220
			),
		];
	}

	foreach ( is_array( $candidate_body['templates'] ?? null ) ? $candidate_body['templates'] : [] as $template ) {
		$entity = sanitize_text_field( (string) ( $template['entity'] ?? 'content' ) );
		$items[] = [
			'type'    => 'template',
			'label'   => ucfirst( $entity ) . ' template',
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Prepare the single %s template for the Real Estate site.', $entity ),
				220
			),
		];
	}

	foreach ( is_array( $candidate_body['forms'] ?? null ) ? $candidate_body['forms'] : [] as $form ) {
		$items[] = [
			'type'    => 'form',
			'label'   => sanitize_text_field( (string) ( $form['title'] ?? $form['slug'] ?? '' ) ),
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Prepare the %s form flow when the optional form runtime is available.', (string) ( $form['title'] ?? 'planned form' ) ),
				220
			),
		];
	}

	foreach ( is_array( $candidate_body['filters'] ?? null ) ? $candidate_body['filters'] : [] as $filter ) {
		$items[] = [
			'type'    => 'filter',
			'label'   => sanitize_text_field( (string) ( $filter['label'] ?? $filter['slug'] ?? '' ) ),
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Prepare the %s filter when the optional filtering runtime is available.', (string) ( $filter['label'] ?? 'planned filter' ) ),
				220
			),
		];
	}

	return factory_ai_preview_diff_preview_items( $items );
}

function factory_ai_preview_diff_build_update_preview( array $candidate_body, array $source_site_plan ): array {
	$items = [];
	$site_name = sanitize_text_field( (string) ( $candidate_body['site']['name'] ?? '' ) );
	$business_summary = factory_ai_preview_diff_clamp_text( $candidate_body['site']['business_summary'] ?? '', 220 );

	if ( '' !== $site_name ) {
		$items[] = [
			'type'    => 'site',
			'label'   => 'Site identity',
			'source'  => 'candidate',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Use "%s" as the planned site identity for the generated Real Estate experience.', $site_name ),
				220
			),
		];
	}

	if ( '' !== $business_summary ) {
		$items[] = [
			'type'    => 'content',
			'label'   => 'Business summary',
			'source'  => 'site_plan',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Use the planned business summary: %s', $business_summary ),
				220
			),
		];
	}

	$components = factory_ai_preview_diff_clamp_text(
		implode( ', ', factory_ai_preview_diff_text_list( $source_site_plan['crocoblock_components'] ?? [], 120 ) ),
		220
	);

	if ( '' !== $components ) {
		$items[] = [
			'type'    => 'runtime',
			'label'   => 'Crocoblock runtime',
			'source'  => 'site_plan',
			'message' => factory_ai_preview_diff_clamp_text(
				sprintf( 'Plan around these Crocoblock components: %s.', $components ),
				220
			),
		];
	}

	$design_summary = factory_ai_preview_diff_design_profile_summary(
		is_array( $candidate_body['design_profile'] ?? null ) ? $candidate_body['design_profile'] : [],
		is_array( $source_site_plan['locale'] ?? null ) ? $source_site_plan['locale'] : []
	);
	$design_capabilities = function_exists( 'factory_ai_design_profile_capability_matrix' )
		? factory_ai_design_profile_capability_matrix(
			[
				'locale'         => is_array( $source_site_plan['locale'] ?? null ) ? $source_site_plan['locale'] : [],
				'design_profile' => is_array( $candidate_body['design_profile'] ?? null ) ? $candidate_body['design_profile'] : [],
			]
		)
		: [ 'summary' => [], 'items' => [] ];
	$design_capability_summary = function_exists( 'factory_ai_design_profile_capability_summary' )
		? factory_ai_design_profile_capability_summary( $design_capabilities )
		: [ 'planning_only' => 0, 'planning_only_fields' => [] ];

	if ( ! empty( $design_summary ) ) {
		$parts = [];

		foreach ( $design_summary as $item ) {
			$label = factory_ai_preview_diff_clamp_text( $item['label'] ?? '', 80 );
			$value = factory_ai_preview_diff_clamp_text( $item['value'] ?? '', 120 );

			if ( '' !== $label && '' !== $value ) {
				$parts[] = sprintf( '%s: %s', $label, $value );
			}
		}

		if ( ! empty( $parts ) ) {
			$message = 'Plan these controlled design choices: ' . implode( '; ', $parts ) . '.';

			if ( ! empty( $design_capability_summary['planning_only_fields'] ) ) {
				$message .= ' Planning-only today: ' . implode( ', ', $design_capability_summary['planning_only_fields'] ) . '.';
			}

			$items[] = [
				'type'    => 'design',
				'label'   => 'Design profile',
				'source'  => 'candidate',
				'message' => factory_ai_preview_diff_clamp_text( $message, 220 ),
			];
		}
	}

	return factory_ai_preview_diff_preview_items( $items );
}

function factory_ai_preview_diff_build_skip_preview( array $source_blueprint_candidate, array $source_site_plan ): array {
	$items = [];

	foreach ( factory_ai_preview_diff_text_list( $source_blueprint_candidate['supported_sections'] ?? [], 80 ) as $section ) {
		if ( in_array( $section, [ 'plugins', 'validation_expectations' ], true ) ) {
			$items[] = [
				'type'    => 'skip',
				'label'   => ucwords( str_replace( '_', ' ', $section ) ),
				'source'  => 'candidate',
				'message' => factory_ai_preview_diff_clamp_text(
					sprintf( 'This preview describes %s conceptually but does not compute a runtime diff for it yet.', str_replace( '_', ' ', $section ) ),
					220
				),
			];
		}
	}

	foreach ( factory_ai_preview_diff_text_list( $source_site_plan['supported_features'] ?? [], 120 ) as $feature ) {
		if ( false !== stripos( $feature, 'Deterministic style token selection' ) ) {
			$items[] = [
				'type'    => 'skip',
				'label'   => 'Style tokens',
				'source'  => 'site_plan',
				'message' => 'Style token choices remain part of the supported flow, but this endpoint does not emit a detailed design diff.',
			];
		}
	}

	return factory_ai_preview_diff_preview_items( $items );
}

function factory_ai_preview_diff_optional_features( array $source_site_plan, array $candidate_body ): array {
	$items = [];
	$components = factory_ai_preview_diff_text_list( $source_site_plan['crocoblock_components'] ?? [], 120 );
	$filters = is_array( $candidate_body['filters'] ?? null ) ? $candidate_body['filters'] : [];
	$forms = is_array( $candidate_body['forms'] ?? null ) ? $candidate_body['forms'] : [];

	if ( in_array( 'JetSmartFilters optional', $components, true ) || ! empty( $filters ) ) {
		$items[] = [
			'feature' => 'JetSmartFilters',
			'status'  => 'optional',
			'note'    => 'Optional filtering enhancements remain available when the runtime dependency is installed.',
		];
	}

	if ( in_array( 'JetFormBuilder optional', $components, true ) || ! empty( $forms ) ) {
		$items[] = [
			'feature' => 'JetFormBuilder',
			'status'  => 'optional',
			'note'    => 'Optional form enhancements remain available when the runtime dependency is installed.',
		];
	}

	return factory_ai_preview_diff_optional_feature_items( $items );
}

function factory_ai_preview_diff_risks( array $source_site_plan, array $source_blueprint_candidate, array $unsupported_requests ): array {
	$risks = [
		'Runtime dependency status is not verified by this preview endpoint.',
		'This preview does not compute a live WordPress diff or ownership check by itself.',
	];

	$risks = array_merge(
		$risks,
		factory_ai_preview_diff_text_list( $source_site_plan['risks'] ?? [], 220 ),
		factory_ai_preview_diff_text_list( $source_blueprint_candidate['risks'] ?? [], 220 )
	);

	if ( ! empty( $unsupported_requests ) ) {
		$risks[] = 'Unsupported requests still require a future patch or extended candidate flow.';
	}

	return array_values( array_unique( $risks ) );
}

function factory_ai_preview_diff_normalize_site_plan_source( $site_plan ): array {
	if ( function_exists( 'factory_ai_blueprint_candidate_normalize_site_plan' ) ) {
		return factory_ai_blueprint_candidate_normalize_site_plan( $site_plan );
	}

	return is_array( $site_plan ) ? $site_plan : [];
}

function factory_ai_preview_diff_normalize_candidate_source( $candidate_source ): array {
	if ( ! is_array( $candidate_source ) ) {
		return [];
	}

	$normalized = [
		'status'               => sanitize_key( (string) ( $candidate_source['status'] ?? 'error' ) ),
		'code'                 => sanitize_key( (string) ( $candidate_source['code'] ?? '' ) ),
		'message'              => factory_ai_preview_diff_clamp_text( $candidate_source['message'] ?? '', 220 ),
		'provider'             => sanitize_key( (string) ( $candidate_source['provider'] ?? 'local' ) ),
		'mode'                 => sanitize_key( (string) ( $candidate_source['mode'] ?? 'blueprint_candidate_v1' ) ),
		'applies_changes'      => false,
		'provider_called'      => false,
		'vertical'             => factory_ai_preview_diff_normalize_site_type( (string) ( $candidate_source['vertical'] ?? 'unknown' ) ),
		'recommended_preset'   => sanitize_text_field( (string) ( $candidate_source['recommended_preset'] ?? '' ) ),
		'source_site_plan'     => factory_ai_preview_diff_normalize_site_plan_source( $candidate_source['source_site_plan'] ?? [] ),
		'candidate'            => function_exists( 'factory_ai_blueprint_candidate_normalize_candidate' )
			? factory_ai_blueprint_candidate_normalize_candidate( $candidate_source['candidate'] ?? null )
			: ( is_array( $candidate_source['candidate'] ?? null ) ? $candidate_source['candidate'] : null ),
		'supported_sections'   => factory_ai_preview_diff_text_list( $candidate_source['supported_sections'] ?? [], 80 ),
		'design_profile_capabilities' => factory_ai_preview_diff_normalize_design_capabilities(
			$candidate_source['design_profile_capabilities'] ?? (
				function_exists( 'factory_ai_design_profile_capability_matrix' )
					? factory_ai_design_profile_capability_matrix(
						[
							'locale'         => is_array( $candidate_source['source_site_plan']['locale'] ?? null ) ? $candidate_source['source_site_plan']['locale'] : [],
							'design_profile' => is_array( $candidate_source['candidate']['design_profile'] ?? null ) ? $candidate_source['candidate']['design_profile'] : [],
						]
					)
					: []
			)
		),
		'unsupported_requests' => factory_ai_normalize_unsupported_items( $candidate_source['unsupported_requests'] ?? [] ),
		'risks'                => factory_ai_preview_diff_text_list( $candidate_source['risks'] ?? [], 220 ),
		'warnings'             => factory_ai_normalize_string_list( $candidate_source['warnings'] ?? [], 220 ),
		'next_step'            => sanitize_key( (string) ( $candidate_source['next_step'] ?? 'review_blueprint_candidate' ) ),
		'usage'                => null,
		'site_type'            => factory_ai_preview_diff_normalize_site_type( (string) ( $candidate_source['site_type'] ?? $candidate_source['vertical'] ?? 'unknown' ) ),
	];

	return $normalized;
}

function factory_ai_preview_diff_normalize_preview( $preview ): array {
	if ( ! is_array( $preview ) ) {
		$preview = [];
	}

	return [
		'summary'            => factory_ai_preview_diff_clamp_text( $preview['summary'] ?? '', 280 ),
		'readiness'          => sanitize_key( (string) ( $preview['readiness'] ?? 'review_required' ) ),
		'can_generate_later' => ! empty( $preview['can_generate_later'] ),
	];
}

function factory_ai_preview_diff_normalize_diff_summary( $summary ): array {
	if ( ! is_array( $summary ) ) {
		$summary = [];
	}

	return [
		'creates'     => max( 0, (int) ( $summary['creates'] ?? 0 ) ),
		'updates'     => max( 0, (int) ( $summary['updates'] ?? 0 ) ),
		'skips'       => max( 0, (int) ( $summary['skips'] ?? 0 ) ),
		'warnings'    => max( 0, (int) ( $summary['warnings'] ?? 0 ) ),
		'unsupported' => max( 0, (int) ( $summary['unsupported'] ?? 0 ) ),
		'note'        => factory_ai_preview_diff_clamp_text( $summary['note'] ?? '', 280 ),
	];
}

function factory_ai_preview_diff_preview_items( $items ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$type = sanitize_key( (string) ( $item['type'] ?? '' ) );
		$label = factory_ai_preview_diff_clamp_text( $item['label'] ?? '', 120 );
		$source = sanitize_key( (string) ( $item['source'] ?? 'candidate' ) );
		$message = factory_ai_preview_diff_clamp_text( $item['message'] ?? '', 220 );

		if ( '' === $type || '' === $label ) {
			continue;
		}

		$normalized[] = [
			'type'    => $type,
			'label'   => $label,
			'source'  => $source,
			'message' => $message,
		];
	}

	return $normalized;
}

function factory_ai_preview_diff_design_choice_items( $items ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$label = factory_ai_preview_diff_clamp_text( $item['label'] ?? '', 120 );
		$value = factory_ai_preview_diff_clamp_text( $item['value'] ?? '', 160 );
		$note = factory_ai_preview_diff_clamp_text( $item['note'] ?? '', 220 );

		if ( '' === $label || '' === $value ) {
			continue;
		}

		$normalized[] = [
			'label' => $label,
			'value' => $value,
			'note'  => $note,
		];
	}

	return $normalized;
}

function factory_ai_preview_diff_design_profile_summary( array $design_profile, array $locale = [], array $capability_matrix = [] ): array {
	$contract = function_exists( 'factory_ai_normalize_design_profile_contract' )
		? factory_ai_normalize_design_profile_contract(
			[
				'locale'         => $locale,
				'design_profile' => $design_profile,
			]
		)
		: [
			'locale'         => [ 'language' => 'en' ],
			'design_profile' => [],
		];
	$profile = is_array( $contract['design_profile'] ?? null ) ? $contract['design_profile'] : [];
	$image = is_array( $profile['image_strategy'] ?? null ) ? $profile['image_strategy'] : [];
	$capability_items = is_array( $capability_matrix['items'] ?? null )
		? $capability_matrix['items']
		: (
			function_exists( 'factory_ai_design_profile_capability_matrix' )
				? ( factory_ai_design_profile_capability_matrix( $contract )['items'] ?? [] )
				: []
		);
	$capability_notes = [];

	foreach ( $capability_items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$path = sanitize_text_field( (string) ( $item['path'] ?? '' ) );
		$note = factory_ai_preview_diff_clamp_text( $item['note'] ?? '', 220 );

		if ( '' !== $path && '' !== $note ) {
			$capability_notes[ $path ] = $note;
		}
	}

	return factory_ai_preview_diff_design_choice_items(
		[
			[
				'label' => 'Language',
				'value' => strtoupper( (string) ( $contract['locale']['language'] ?? 'en' ) ),
				'note'  => $capability_notes['locale.language'] ?? '',
			],
			[
				'label' => 'Tone',
				'value' => ucwords( str_replace( '_', ' ', (string) ( $profile['tone'] ?? 'premium' ) ) ),
				'note'  => $capability_notes['design_profile.tone'] ?? '',
			],
			[
				'label' => 'Palette',
				'value' => ucwords( str_replace( '_', ' ', (string) ( $profile['palette']['preset'] ?? 'turquoise' ) ) ),
				'note'  => $capability_notes['design_profile.palette.preset'] ?? '',
			],
			[
				'label' => 'Hero variant',
				'value' => ucwords( str_replace( '_', ' ', (string) ( $profile['hero_variant'] ?? 'image_left_scrim' ) ) ),
				'note'  => $capability_notes['design_profile.hero_variant'] ?? '',
			],
			[
				'label' => 'Catalog variant',
				'value' => ucwords( str_replace( '_', ' ', (string) ( $profile['catalog_variant'] ?? 'stable_catalog_get_filters' ) ) ),
				'note'  => $capability_notes['design_profile.catalog_variant'] ?? '',
			],
			[
				'label' => 'Single property variant',
				'value' => ucwords( str_replace( '_', ' ', (string) ( $profile['single_property_variant'] ?? 'factory_default' ) ) ),
				'note'  => $capability_notes['design_profile.single_property_variant'] ?? '',
			],
			[
				'label' => 'Image strategy',
				'value' => ucwords( str_replace( '_', ' ', (string) ( $image['source'] ?? 'demo_pool' ) ) ) . ' / ' . ucwords( str_replace( '_', ' ', (string) ( $image['mode'] ?? 'round_robin' ) ) ),
				'note'  => $capability_notes['design_profile.image_strategy.source'] ?? '',
			],
		]
	);
}

function factory_ai_preview_diff_normalize_design_capabilities( $matrix ): array {
	$matrix = is_array( $matrix ) ? $matrix : [];
	$summary = is_array( $matrix['summary'] ?? null ) ? $matrix['summary'] : [];
	$items = is_array( $matrix['items'] ?? null ) ? $matrix['items'] : [];
	$normalized_items = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$status = sanitize_key( (string) ( $item['status'] ?? 'unsupported' ) );

		if ( ! in_array( $status, [ 'supported', 'planning_only', 'unsupported' ], true ) ) {
			$status = 'unsupported';
		}

		$normalized_items[] = [
			'field'              => sanitize_key( (string) ( $item['field'] ?? '' ) ),
			'path'               => factory_ai_preview_diff_clamp_text( $item['path'] ?? '', 120 ),
			'value'              => sanitize_key( (string) ( $item['value'] ?? '' ) ),
			'planning_supported' => ! empty( $item['planning_supported'] ),
			'preview_supported'  => ! empty( $item['preview_supported'] ),
			'runtime_supported'  => ! empty( $item['runtime_supported'] ),
			'apply_supported'    => ! empty( $item['apply_supported'] ),
			'status'             => $status,
			'note'               => factory_ai_preview_diff_clamp_text( $item['note'] ?? '', 220 ),
		];
	}

	return [
		'summary' => [
			'supported'      => max( 0, (int) ( $summary['supported'] ?? 0 ) ),
			'planning_only'  => max( 0, (int) ( $summary['planning_only'] ?? 0 ) ),
			'unsupported'    => max( 0, (int) ( $summary['unsupported'] ?? 0 ) ),
			'runtime_backed' => max( 0, (int) ( $summary['runtime_backed'] ?? 0 ) ),
			'apply_backed'   => max( 0, (int) ( $summary['apply_backed'] ?? 0 ) ),
		],
		'items'   => $normalized_items,
	];
}

function factory_ai_preview_diff_optional_feature_items( $items ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$feature = factory_ai_preview_diff_clamp_text( $item['feature'] ?? '', 120 );
		$status = sanitize_key( (string) ( $item['status'] ?? 'optional' ) );
		$note = factory_ai_preview_diff_clamp_text( $item['note'] ?? '', 220 );

		if ( '' === $feature ) {
			continue;
		}

		$normalized[] = [
			'feature' => $feature,
			'status'  => in_array( $status, [ 'optional', 'supported', 'future' ], true ) ? $status : 'optional',
			'note'    => $note,
		];
	}

	return $normalized;
}

function factory_ai_preview_diff_merge_unsupported( $left, $right ): array {
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

function factory_ai_preview_diff_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_preview_diff_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_preview_diff_clamp_text( $value, int $max ): string {
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

function factory_ai_preview_diff_normalize_context( array $context ): array {
	if ( function_exists( 'factory_ai_blueprint_candidate_normalize_context' ) ) {
		return factory_ai_blueprint_candidate_normalize_context( $context );
	}

	return $context;
}

function factory_ai_preview_diff_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}
