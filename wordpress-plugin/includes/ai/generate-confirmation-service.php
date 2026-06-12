<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_generate_confirmation( array $input = [] ): array {
	$prompt               = $input['prompt'] ?? '';
	$site_plan            = is_array( $input['site_plan'] ?? null ) ? $input['site_plan'] : [];
	$blueprint_candidate  = is_array( $input['blueprint_candidate'] ?? null ) ? $input['blueprint_candidate'] : [];
	$preview_diff         = is_array( $input['preview_diff'] ?? null ) ? $input['preview_diff'] : [];
	$generate_gate        = is_array( $input['generate_gate'] ?? null ) ? $input['generate_gate'] : [];
	$generate_preflight   = is_array( $input['generate_preflight'] ?? null ) ? $input['generate_preflight'] : [];
	$context              = is_array( $input['context'] ?? null ) ? $input['context'] : [];
	$requested_site_type  = factory_ai_generate_confirmation_normalize_site_type(
		(string) ( $input['site_type'] ?? $input['vertical'] ?? '' )
	);

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt  = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$context = factory_ai_generate_confirmation_normalize_context( $context );

	if ( empty( $generate_preflight ) && empty( $generate_gate ) && empty( $preview_diff ) && empty( $blueprint_candidate ) && empty( $site_plan ) && '' === trim( $prompt ) ) {
		return factory_ai_generate_confirmation_response(
			[
				'status'                          => 'error',
				'code'                            => 'missing_generate_confirmation_input',
				'message'                         => 'Provide a prompt, preflight, generate gate, preview, candidate, or site plan before building final confirmation evidence.',
				'vertical'                        => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'confirmation_ready'              => false,
				'can_proceed_to_controlled_generate_later' => false,
				'requires_user_confirmation'      => true,
				'final_recheck_required'          => true,
				'blocking_reasons'                => [
					'No prompt, preflight, generate gate, preview, candidate, or site plan context was provided.',
				],
				'warnings'                        => [
					'Confirmation evidence only. No site changes were made.',
					'Actual controlled generation must recompute dependency, ownership, and runtime diff checks.',
				],
				'next_step'                       => 'enter_prompt',
			]
		);
	}

	$source_generate_preflight = ! empty( $generate_preflight )
		? factory_ai_generate_confirmation_normalize_generate_preflight_source( $generate_preflight )
		: factory_ai_build_generate_preflight(
			[
				'prompt'              => $prompt,
				'site_plan'           => $site_plan,
				'blueprint_candidate' => $blueprint_candidate,
				'preview_diff'        => $preview_diff,
				'generate_gate'       => $generate_gate,
				'site_type'           => $requested_site_type,
				'context'             => $context,
			]
		);

	$vertical           = factory_ai_generate_confirmation_normalize_site_type(
		(string) (
			$source_generate_preflight['vertical']
			?? $requested_site_type
			?? 'unknown'
		)
	);
	$recommended_preset = sanitize_text_field( (string) ( $source_generate_preflight['recommended_preset'] ?? '' ) );
	$dependency_evidence = factory_ai_generate_confirmation_dependency_evidence( $source_generate_preflight['dependency_status'] ?? [] );
	$ownership_evidence  = factory_ai_generate_confirmation_ownership_evidence( $source_generate_preflight['ownership_status'] ?? [] );
	$runtime_evidence    = factory_ai_generate_confirmation_runtime_evidence( $source_generate_preflight['current_runtime_snapshot'] ?? [] );
	$runtime_diff_evidence = factory_ai_generate_confirmation_runtime_diff_evidence(
		$source_generate_preflight,
		$vertical,
		$recommended_preset
	);
	$blocking_reasons = factory_ai_generate_confirmation_blocking_reasons(
		$source_generate_preflight,
		$dependency_evidence,
		$ownership_evidence,
		$vertical,
		$recommended_preset
	);
	$confirmation_ready = empty( $blocking_reasons )
		&& ! empty( $source_generate_preflight['preflight_ready'] )
		&& 'real_estate' === $vertical
		&& 'real-estate' === $recommended_preset;
	$warnings = array_values(
		array_unique(
			array_merge(
				[
					'Confirmation evidence only. No site changes were made.',
					'Actual controlled generation must recompute dependency, ownership, and runtime diff checks.',
				],
				factory_ai_normalize_string_list( $source_generate_preflight['warnings'] ?? [], 220 ),
				factory_ai_generate_confirmation_text_list( $runtime_diff_evidence['warnings'] ?? [], 220 )
			)
		)
	);
	$risks = array_values(
		array_unique(
			array_merge(
				[
					'This endpoint does not apply or guarantee that a later apply remains safe without rechecking runtime state.',
					'Final dependency, ownership, and runtime diff evidence must be recomputed immediately inside the future controlled apply endpoint.',
				],
				factory_ai_generate_confirmation_text_list( $source_generate_preflight['risks'] ?? [], 220 )
			)
		)
	);

	return factory_ai_generate_confirmation_response(
		[
			'status'                             => $confirmation_ready ? 'ok' : 'warning',
			'code'                               => $confirmation_ready ? 'generate_confirmation_ready' : 'generate_confirmation_blocked',
			'message'                            => $confirmation_ready
				? 'Final confirmation evidence is ready for review.'
				: 'Final confirmation evidence is blocked until the listed issues are resolved.',
			'vertical'                           => $vertical,
			'recommended_preset'                => $recommended_preset,
			'source_generate_preflight'         => $source_generate_preflight,
			'confirmation_ready'                => $confirmation_ready,
			'can_proceed_to_controlled_generate_later' => $confirmation_ready,
			'requires_user_confirmation'        => true,
			'confirmation_required_phrase'      => factory_ai_generate_confirmation_clamp_text(
				$source_generate_preflight['confirmation_required_phrase'] ?? 'GENERATE REAL ESTATE DEMO',
				80
			),
			'confirmation_instructions'         => [
				'type'            => 'exact_phrase',
				'required_phrase' => factory_ai_generate_confirmation_clamp_text(
					$source_generate_preflight['confirmation_required_phrase'] ?? 'GENERATE REAL ESTATE DEMO',
					80
				),
				'note'            => 'A future controlled generate endpoint must require this exact phrase again.',
			],
			'runtime_evidence'                  => $runtime_evidence,
			'runtime_diff_evidence'             => $runtime_diff_evidence,
			'ownership_evidence'                => $ownership_evidence,
			'dependency_evidence'               => $dependency_evidence,
			'final_recheck_required'            => true,
			'blocking_reasons'                  => $blocking_reasons,
			'warnings'                          => $warnings,
			'risks'                             => $risks,
			'post_generate_checks'              => factory_ai_generate_confirmation_text_list( $source_generate_preflight['post_generate_checks'] ?? [], 220 ),
			'next_step'                         => $confirmation_ready
				? 'controlled_generate_requires_exact_confirmation'
				: 'resolve_confirmation_blockers',
		]
	);
}

function factory_ai_generate_confirmation_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$status = 'error';
	}

	$vertical = factory_ai_generate_confirmation_normalize_site_type(
		(string) ( $overrides['vertical'] ?? 'unknown' )
	);

	return [
		'status'                             => $status,
		'code'                               => sanitize_key( (string) ( $overrides['code'] ?? 'generate_confirmation_unavailable' ) ),
		'message'                            => sanitize_text_field( (string) ( $overrides['message'] ?? 'Generate confirmation evidence is unavailable.' ) ),
		'provider'                           => 'local',
		'mode'                               => 'generate_confirmation_v1',
		'applies_changes'                    => false,
		'provider_called'                    => false,
		'vertical'                           => $vertical,
		'recommended_preset'                 => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'source_generate_preflight'          => factory_ai_generate_confirmation_normalize_generate_preflight_source( $overrides['source_generate_preflight'] ?? [] ),
		'confirmation_ready'                 => ! empty( $overrides['confirmation_ready'] ),
		'can_proceed_to_controlled_generate_later' => ! empty( $overrides['can_proceed_to_controlled_generate_later'] ),
		'requires_user_confirmation'         => ! empty( $overrides['requires_user_confirmation'] ),
		'confirmation_required_phrase'       => factory_ai_generate_confirmation_clamp_text( $overrides['confirmation_required_phrase'] ?? '', 80 ),
		'confirmation_instructions'          => factory_ai_generate_confirmation_normalize_confirmation_instructions( $overrides['confirmation_instructions'] ?? [] ),
		'runtime_evidence'                   => factory_ai_generate_confirmation_normalize_runtime_evidence( $overrides['runtime_evidence'] ?? [] ),
		'runtime_diff_evidence'              => factory_ai_generate_confirmation_normalize_runtime_diff_evidence( $overrides['runtime_diff_evidence'] ?? [] ),
		'ownership_evidence'                 => factory_ai_generate_confirmation_normalize_ownership_evidence( $overrides['ownership_evidence'] ?? [] ),
		'dependency_evidence'                => factory_ai_generate_confirmation_normalize_dependency_evidence( $overrides['dependency_evidence'] ?? [] ),
		'final_recheck_required'             => ! empty( $overrides['final_recheck_required'] ),
		'blocking_reasons'                   => factory_ai_generate_confirmation_text_list( $overrides['blocking_reasons'] ?? [], 220 ),
		'warnings'                           => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 220 ),
		'risks'                              => factory_ai_generate_confirmation_text_list( $overrides['risks'] ?? [], 220 ),
		'next_step'                          => sanitize_key( (string) ( $overrides['next_step'] ?? 'controlled_generate_requires_exact_confirmation' ) ),
		'post_generate_checks'               => factory_ai_generate_confirmation_text_list( $overrides['post_generate_checks'] ?? [], 220 ),
		'usage'                              => null,
	];
}

function factory_ai_generate_confirmation_dependency_evidence( $dependency_status ): array {
	$normalized = factory_ai_generate_confirmation_normalize_dependency_status( $dependency_status );

	return [
		'ready'                   => ! empty( $normalized['ready'] ) && empty( $normalized['blocking'] ),
		'summary'                 => factory_ai_generate_confirmation_clamp_text( $normalized['summary'] ?? '', 220 ),
		'required'                => is_array( $normalized['required'] ?? null ) ? array_values( $normalized['required'] ) : [],
		'optional'                => is_array( $normalized['optional'] ?? null ) ? array_values( $normalized['optional'] ) : [],
		'blocking'                => factory_ai_generate_confirmation_text_list( $normalized['blocking'] ?? [], 220 ),
		'warnings'                => factory_ai_generate_confirmation_text_list( $normalized['warnings'] ?? [], 220 ),
		'site_factory_plugin'     => is_array( $normalized['site_factory_plugin'] ?? null ) ? $normalized['site_factory_plugin'] : [],
		'must_recheck_before_apply' => true,
	];
}

function factory_ai_generate_confirmation_ownership_evidence( $ownership_status ): array {
	$normalized = factory_ai_generate_confirmation_normalize_ownership_status( $ownership_status );

	return [
		'status'                  => sanitize_key( (string) ( $normalized['status'] ?? 'unknown' ) ),
		'blocking_conflicts'      => factory_ai_generate_confirmation_text_list( $normalized['blocking_conflicts'] ?? [], 220 ),
		'notes'                   => factory_ai_generate_confirmation_text_list( $normalized['notes'] ?? [], 220 ),
		'factory_managed_total'   => max( 0, (int) ( $normalized['factory_managed_total'] ?? 0 ) ),
		'user_modified_total'     => max( 0, (int) ( $normalized['user_modified_total'] ?? 0 ) ),
		'locked_total'            => max( 0, (int) ( $normalized['locked_total'] ?? 0 ) ),
		'counts'                  => is_array( $normalized['counts'] ?? null ) ? $normalized['counts'] : [],
		'must_recheck_before_apply' => true,
	];
}

function factory_ai_generate_confirmation_runtime_evidence( $runtime_snapshot ): array {
	$normalized = factory_ai_generate_confirmation_normalize_runtime_snapshot( $runtime_snapshot );

	return [
		'pages'        => max( 0, (int) ( $normalized['pages'] ?? 0 ) ),
		'properties'   => max( 0, (int) ( $normalized['properties'] ?? 0 ) ),
		'attachments'  => max( 0, (int) ( $normalized['attachments'] ?? 0 ) ),
		'active_theme' => factory_ai_generate_confirmation_clamp_text( $normalized['active_theme'] ?? '', 160 ),
		'plugins'      => is_array( $normalized['plugins'] ?? null ) ? array_values( $normalized['plugins'] ) : [],
		'observed_at'  => function_exists( 'current_time' ) ? current_time( 'mysql' ) : null,
	];
}

function factory_ai_generate_confirmation_runtime_diff_evidence(
	array $source_generate_preflight,
	string $vertical,
	string $recommended_preset
): array {
	$dry_run_preview = factory_ai_generate_confirmation_normalize_dry_run_preview(
		$source_generate_preflight['dry_run_proof_preview'] ?? []
	);
	$bridge = factory_ai_generate_confirmation_bridge_evidence( $recommended_preset, $dry_run_preview );
	$bridge_runtime = is_array( $bridge['runtime_evidence'] ?? null ) ? $bridge['runtime_evidence'] : [];
	$bridge_dry_run = is_array( $bridge_runtime['plugin_dry_run'] ?? null ) ? $bridge_runtime['plugin_dry_run'] : [];
	$bridge_apply_gate = is_array( $bridge['apply_gate'] ?? null ) ? $bridge['apply_gate'] : [];

	return [
		'target_preset'                              => sanitize_key( '' !== $recommended_preset ? $recommended_preset : 'real-estate' ),
		'expected_vertical'                          => factory_ai_generate_confirmation_normalize_site_type( $vertical ),
		'expected_pages'                             => factory_ai_generate_confirmation_text_list( $dry_run_preview['planned_pages'] ?? [], 120 ),
		'expected_entity_types'                      => factory_ai_generate_confirmation_text_list( $dry_run_preview['planned_entity_types'] ?? [], 80 ),
		'expected_managed_objects_summary'           => is_array( $dry_run_preview['planned_summary'] ?? null ) ? $dry_run_preview['planned_summary'] : [],
		'current_counts'                             => [
			'pages'       => max( 0, (int) ( $source_generate_preflight['current_runtime_snapshot']['pages'] ?? 0 ) ),
			'properties'  => max( 0, (int) ( $source_generate_preflight['current_runtime_snapshot']['properties'] ?? 0 ) ),
			'attachments' => max( 0, (int) ( $source_generate_preflight['current_runtime_snapshot']['attachments'] ?? 0 ) ),
		],
		'bridge_status'                              => sanitize_key( (string) ( $bridge['status'] ?? 'warning' ) ),
		'bridge_runtime_status'                      => sanitize_key( (string) ( $bridge_runtime['status'] ?? 'warning' ) ),
		'bridge_apply_gate_status'                   => sanitize_key( (string) ( $bridge_apply_gate['status'] ?? 'warning' ) ),
		'bridge_can_apply'                           => ! empty( $bridge_apply_gate['can_apply'] ),
		'bridge_runtime_mutation'                    => ! empty( $bridge['runtime_mutation'] ),
		'bridge_dry_run_summary'                     => is_array( $bridge_dry_run['summary'] ?? null ) ? $bridge_dry_run['summary'] : [],
		'final_runtime_diff_must_be_recomputed_before_apply' => true,
		'no_patch_operations_generated'              => true,
		'no_apply_performed'                         => true,
		'warnings'                                   => factory_ai_generate_confirmation_text_list(
			array_merge(
				$bridge['warnings'] ?? [],
				$bridge['errors'] ?? []
			),
			220
		),
	];
}

function factory_ai_generate_confirmation_bridge_evidence( string $recommended_preset, array $dry_run_preview ): array {
	if ( 'real-estate' !== $recommended_preset ) {
		return [
			'status'   => 'warning',
			'warnings' => [
				'Plugin preview bridge evidence is currently available for the Real Estate preset only.',
			],
			'errors'   => [],
			'apply_gate' => [
				'status'    => 'warning',
				'can_apply' => false,
			],
			'runtime_evidence' => [
				'status'         => 'warning',
				'plugin_dry_run' => [
					'summary' => [],
				],
			],
		];
	}

	if ( ! function_exists( 'factory_build_plugin_preview_bridge_response' ) ) {
		return [
			'status'   => 'warning',
			'warnings' => [
				'Plugin preview bridge service is unavailable in the current runtime.',
			],
			'errors'   => [],
			'apply_gate' => [
				'status'    => 'warning',
				'can_apply' => false,
			],
			'runtime_evidence' => [
				'status'         => 'warning',
				'plugin_dry_run' => [
					'summary' => [],
				],
			],
		];
	}

	try {
		$manager = new Factory_Blueprint_Preset_Manager();
		$blueprint = $manager->load_preset( 'real-estate' );

		return factory_build_plugin_preview_bridge_response(
			$blueprint,
			[
				'preview' => [
					'summary' => 'Final confirmation runtime-diff evidence for the Real Estate preset.',
				],
				'dry_run_proof_preview' => $dry_run_preview,
			],
			[]
		);
	} catch ( Throwable $e ) {
		return [
			'status'   => 'warning',
			'warnings' => [
				'Plugin preview bridge evidence could not be built: ' . factory_ai_generate_confirmation_clamp_text( $e->getMessage(), 220 ),
			],
			'errors'   => [],
			'apply_gate' => [
				'status'    => 'warning',
				'can_apply' => false,
			],
			'runtime_evidence' => [
				'status'         => 'warning',
				'plugin_dry_run' => [
					'summary' => [],
				],
			],
		];
	}
}

function factory_ai_generate_confirmation_blocking_reasons(
	array $source_generate_preflight,
	array $dependency_evidence,
	array $ownership_evidence,
	string $vertical,
	string $recommended_preset
): array {
	$reasons = factory_ai_generate_confirmation_text_list( $source_generate_preflight['blocking_reasons'] ?? [], 220 );

	if ( 'real_estate' !== $vertical ) {
		$reasons[] = 'Final confirmation currently supports the Real Estate vertical only.';
	}

	if ( 'real-estate' !== $recommended_preset ) {
		$reasons[] = 'The Real Estate preset is the only supported controlled generate target in v1.';
	}

	if ( empty( $source_generate_preflight['preflight_ready'] ) ) {
		$reasons[] = 'Generate preflight is not currently ready for final confirmation.';
	}

	foreach ( factory_ai_generate_confirmation_text_list( $dependency_evidence['blocking'] ?? [], 220 ) as $reason ) {
		$reasons[] = $reason;
	}

	foreach ( factory_ai_generate_confirmation_text_list( $ownership_evidence['blocking_conflicts'] ?? [], 220 ) as $reason ) {
		$reasons[] = $reason;
	}

	return array_values( array_unique( $reasons ) );
}

function factory_ai_generate_confirmation_normalize_generate_preflight_source( $preflight ): array {
	if ( ! is_array( $preflight ) ) {
		return [];
	}

	if ( function_exists( 'factory_ai_generate_preflight_response' ) ) {
		return factory_ai_generate_preflight_response( $preflight );
	}

	return $preflight;
}

function factory_ai_generate_confirmation_normalize_confirmation_instructions( $instructions ): array {
	if ( ! is_array( $instructions ) ) {
		$instructions = [];
	}

	return [
		'type'            => sanitize_key( (string) ( $instructions['type'] ?? 'exact_phrase' ) ),
		'required_phrase' => factory_ai_generate_confirmation_clamp_text( $instructions['required_phrase'] ?? '', 80 ),
		'note'            => factory_ai_generate_confirmation_clamp_text( $instructions['note'] ?? '', 220 ),
	];
}

function factory_ai_generate_confirmation_normalize_dependency_evidence( $evidence ): array {
	if ( ! is_array( $evidence ) ) {
		$evidence = [];
	}

	return [
		'ready'                   => ! empty( $evidence['ready'] ),
		'summary'                 => factory_ai_generate_confirmation_clamp_text( $evidence['summary'] ?? '', 220 ),
		'required'                => is_array( $evidence['required'] ?? null ) ? array_values( $evidence['required'] ) : [],
		'optional'                => is_array( $evidence['optional'] ?? null ) ? array_values( $evidence['optional'] ) : [],
		'blocking'                => factory_ai_generate_confirmation_text_list( $evidence['blocking'] ?? [], 220 ),
		'warnings'                => factory_ai_generate_confirmation_text_list( $evidence['warnings'] ?? [], 220 ),
		'site_factory_plugin'     => is_array( $evidence['site_factory_plugin'] ?? null ) ? $evidence['site_factory_plugin'] : [],
		'must_recheck_before_apply' => ! empty( $evidence['must_recheck_before_apply'] ),
	];
}

function factory_ai_generate_confirmation_normalize_ownership_evidence( $evidence ): array {
	if ( ! is_array( $evidence ) ) {
		$evidence = [];
	}

	return [
		'status'                  => sanitize_key( (string) ( $evidence['status'] ?? 'unknown' ) ),
		'blocking_conflicts'      => factory_ai_generate_confirmation_text_list( $evidence['blocking_conflicts'] ?? [], 220 ),
		'notes'                   => factory_ai_generate_confirmation_text_list( $evidence['notes'] ?? [], 220 ),
		'factory_managed_total'   => max( 0, (int) ( $evidence['factory_managed_total'] ?? 0 ) ),
		'user_modified_total'     => max( 0, (int) ( $evidence['user_modified_total'] ?? 0 ) ),
		'locked_total'            => max( 0, (int) ( $evidence['locked_total'] ?? 0 ) ),
		'counts'                  => is_array( $evidence['counts'] ?? null ) ? $evidence['counts'] : [],
		'must_recheck_before_apply' => ! empty( $evidence['must_recheck_before_apply'] ),
	];
}

function factory_ai_generate_confirmation_normalize_runtime_evidence( $evidence ): array {
	if ( ! is_array( $evidence ) ) {
		$evidence = [];
	}

	return [
		'pages'        => max( 0, (int) ( $evidence['pages'] ?? 0 ) ),
		'properties'   => max( 0, (int) ( $evidence['properties'] ?? 0 ) ),
		'attachments'  => max( 0, (int) ( $evidence['attachments'] ?? 0 ) ),
		'active_theme' => factory_ai_generate_confirmation_clamp_text( $evidence['active_theme'] ?? '', 160 ),
		'plugins'      => is_array( $evidence['plugins'] ?? null ) ? array_values( $evidence['plugins'] ) : [],
		'observed_at'  => is_scalar( $evidence['observed_at'] ?? null ) || null === ( $evidence['observed_at'] ?? null )
			? ( $evidence['observed_at'] ?? null )
			: null,
	];
}

function factory_ai_generate_confirmation_normalize_runtime_diff_evidence( $evidence ): array {
	if ( ! is_array( $evidence ) ) {
		$evidence = [];
	}

	return [
		'target_preset'                              => sanitize_key( (string) ( $evidence['target_preset'] ?? 'real-estate' ) ),
		'expected_vertical'                          => factory_ai_generate_confirmation_normalize_site_type( (string) ( $evidence['expected_vertical'] ?? 'unknown' ) ),
		'expected_pages'                             => factory_ai_generate_confirmation_text_list( $evidence['expected_pages'] ?? [], 120 ),
		'expected_entity_types'                      => factory_ai_generate_confirmation_text_list( $evidence['expected_entity_types'] ?? [], 80 ),
		'expected_managed_objects_summary'           => is_array( $evidence['expected_managed_objects_summary'] ?? null ) ? $evidence['expected_managed_objects_summary'] : [],
		'current_counts'                             => is_array( $evidence['current_counts'] ?? null ) ? $evidence['current_counts'] : [],
		'bridge_status'                              => sanitize_key( (string) ( $evidence['bridge_status'] ?? 'warning' ) ),
		'bridge_runtime_status'                      => sanitize_key( (string) ( $evidence['bridge_runtime_status'] ?? 'warning' ) ),
		'bridge_apply_gate_status'                   => sanitize_key( (string) ( $evidence['bridge_apply_gate_status'] ?? 'warning' ) ),
		'bridge_can_apply'                           => ! empty( $evidence['bridge_can_apply'] ),
		'bridge_runtime_mutation'                    => ! empty( $evidence['bridge_runtime_mutation'] ),
		'bridge_dry_run_summary'                     => is_array( $evidence['bridge_dry_run_summary'] ?? null ) ? $evidence['bridge_dry_run_summary'] : [],
		'final_runtime_diff_must_be_recomputed_before_apply' => ! empty( $evidence['final_runtime_diff_must_be_recomputed_before_apply'] ),
		'no_patch_operations_generated'              => ! empty( $evidence['no_patch_operations_generated'] ),
		'no_apply_performed'                         => ! empty( $evidence['no_apply_performed'] ),
		'warnings'                                   => factory_ai_generate_confirmation_text_list( $evidence['warnings'] ?? [], 220 ),
	];
}

function factory_ai_generate_confirmation_normalize_dependency_status( $status ): array {
	if ( function_exists( 'factory_ai_generate_preflight_normalize_dependency_status' ) ) {
		return factory_ai_generate_preflight_normalize_dependency_status( $status );
	}

	return is_array( $status ) ? $status : [];
}

function factory_ai_generate_confirmation_normalize_ownership_status( $status ): array {
	if ( function_exists( 'factory_ai_generate_preflight_normalize_ownership_status' ) ) {
		return factory_ai_generate_preflight_normalize_ownership_status( $status );
	}

	return is_array( $status ) ? $status : [];
}

function factory_ai_generate_confirmation_normalize_runtime_snapshot( $snapshot ): array {
	if ( function_exists( 'factory_ai_generate_preflight_normalize_runtime_snapshot' ) ) {
		return factory_ai_generate_preflight_normalize_runtime_snapshot( $snapshot );
	}

	return is_array( $snapshot ) ? $snapshot : [];
}

function factory_ai_generate_confirmation_normalize_dry_run_preview( $preview ): array {
	if ( function_exists( 'factory_ai_generate_preflight_normalize_dry_run_preview' ) ) {
		return factory_ai_generate_preflight_normalize_dry_run_preview( $preview );
	}

	return is_array( $preview ) ? $preview : [];
}

function factory_ai_generate_confirmation_text_list( $items, int $max ): array {
	$items      = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_generate_confirmation_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_generate_confirmation_clamp_text( $value, int $max ): string {
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

function factory_ai_generate_confirmation_normalize_context( array $context ): array {
	if ( function_exists( 'factory_ai_generate_preflight_normalize_context' ) ) {
		return factory_ai_generate_preflight_normalize_context( $context );
	}

	return $context;
}

function factory_ai_generate_confirmation_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed   = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}
