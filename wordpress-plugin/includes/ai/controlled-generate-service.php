<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_controlled_generate( array $input = [] ): array {
	$prompt               = $input['prompt'] ?? '';
	$site_plan            = is_array( $input['site_plan'] ?? null ) ? $input['site_plan'] : [];
	$blueprint_candidate  = is_array( $input['blueprint_candidate'] ?? null ) ? $input['blueprint_candidate'] : [];
	$preview_diff         = is_array( $input['preview_diff'] ?? null ) ? $input['preview_diff'] : [];
	$generate_gate        = is_array( $input['generate_gate'] ?? null ) ? $input['generate_gate'] : [];
	$generate_preflight   = is_array( $input['generate_preflight'] ?? null ) ? $input['generate_preflight'] : [];
	$generate_confirmation = is_array( $input['generate_confirmation'] ?? null ) ? $input['generate_confirmation'] : [];
	$context              = is_array( $input['context'] ?? null ) ? $input['context'] : [];
	$requested_site_type  = factory_ai_controlled_generate_normalize_site_type(
		(string) ( $input['site_type'] ?? $input['vertical'] ?? '' )
	);
	$execute_requested = ! empty( $input['execute'] );
	$confirmation_phrase = factory_ai_controlled_generate_clamp_text( $input['confirmation_phrase'] ?? '', 120 );

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt  = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$context = factory_ai_controlled_generate_normalize_context( $context );

	if ( empty( $generate_confirmation ) && empty( $generate_preflight ) && empty( $generate_gate ) && empty( $preview_diff ) && empty( $blueprint_candidate ) && empty( $site_plan ) && '' === trim( $prompt ) ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                             => 'error',
				'code'                               => 'missing_controlled_generate_input',
				'message'                            => 'Provide a prompt or planning context before controlled generate can be evaluated.',
				'vertical'                           => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'execute_requested'                  => $execute_requested,
				'exact_confirmation_matched'         => false,
				'server_recomputed_confirmation_ready' => false,
				'server_recomputed_preflight_ready'  => false,
				'generated'                          => false,
				'blocking_reasons'                   => [
					'No prompt, candidate, preview, gate, preflight, or confirmation context was provided.',
				],
				'warnings'                           => [
					'Controlled generate did not run. No site changes were made.',
				],
				'next_step'                          => 'enter_prompt',
			]
		);
	}

	$server_confirmation = factory_ai_build_generate_confirmation(
		[
			'prompt'              => $prompt,
			'site_plan'           => $site_plan,
			'blueprint_candidate' => $blueprint_candidate,
			'preview_diff'        => $preview_diff,
			'generate_gate'       => $generate_gate,
			'generate_preflight'  => $generate_preflight,
			'site_type'           => $requested_site_type,
			'context'             => $context,
		]
	);

	$vertical = factory_ai_controlled_generate_normalize_site_type(
		(string) (
			$server_confirmation['vertical']
			?? $requested_site_type
			?? 'unknown'
		)
	);
	$recommended_preset = sanitize_text_field( (string) ( $server_confirmation['recommended_preset'] ?? '' ) );
	$server_confirmation_ready = ! empty( $server_confirmation['confirmation_ready'] );
	$source_generate_preflight = is_array( $server_confirmation['source_generate_preflight'] ?? null ) ? $server_confirmation['source_generate_preflight'] : [];
	$server_preflight_ready = ! empty( $source_generate_preflight['preflight_ready'] );
	$runtime_snapshot_before = factory_ai_controlled_generate_normalize_runtime_snapshot(
		$server_confirmation['runtime_evidence'] ?? []
	);
	$dependency_recheck = factory_ai_controlled_generate_normalize_dependency_evidence(
		$server_confirmation['dependency_evidence'] ?? []
	);
	$ownership_recheck = factory_ai_controlled_generate_normalize_ownership_evidence(
		$server_confirmation['ownership_evidence'] ?? []
	);
	$runtime_diff_recheck = factory_ai_controlled_generate_normalize_runtime_diff_evidence(
		$server_confirmation['runtime_diff_evidence'] ?? []
	);
	$confirmation_required_phrase = factory_ai_controlled_generate_clamp_text(
		$server_confirmation['confirmation_required_phrase'] ?? 'GENERATE REAL ESTATE DEMO',
		80
	);
	$exact_confirmation_matched = $confirmation_phrase === $confirmation_required_phrase;

	$common_warnings = array_values(
		array_unique(
			array_merge(
				[
					'Client-supplied readiness flags are ignored; controlled generate readiness is recomputed on the server.',
				],
				factory_ai_normalize_string_list( $server_confirmation['warnings'] ?? [], 220 )
			)
		)
	);
	$common_risks = array_values(
		array_unique(
			array_merge(
				[
					'This endpoint is the first mutation boundary and therefore fails closed by default.',
				],
				factory_ai_controlled_generate_text_list( $server_confirmation['risks'] ?? [], 220 )
			)
		)
	);

	if ( ! $execute_requested ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                             => 'warning',
				'code'                               => 'controlled_generate_preview_only',
				'message'                            => 'Controlled generate remains in preview mode until execute=true is provided.',
				'vertical'                           => $vertical,
				'recommended_preset'                 => $recommended_preset,
				'execute_requested'                  => false,
				'exact_confirmation_matched'         => false,
				'confirmation_required_phrase'       => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => $server_confirmation_ready,
				'server_recomputed_preflight_ready'  => $server_preflight_ready,
				'runtime_snapshot_before'            => $runtime_snapshot_before,
				'dependency_recheck'                 => $dependency_recheck,
				'ownership_recheck'                  => $ownership_recheck,
				'runtime_diff_recheck'               => $runtime_diff_recheck,
				'generated'                          => false,
				'blocking_reasons'                   => [],
				'warnings'                           => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate preview only. No site changes were made.',
								'Set execute=true and provide the exact confirmation phrase in a future step to continue.',
							],
							$common_warnings
						)
					)
				),
				'risks'                              => $common_risks,
				'post_generate_checks'               => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                          => 'submit_exact_confirmation_with_execute',
			]
		);
	}

	if ( 'real_estate' !== $vertical || 'real-estate' !== $recommended_preset ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                             => 'warning',
				'code'                               => 'unsupported_controlled_generate_target',
				'message'                            => 'Controlled generate v1 supports the Real Estate preset only.',
				'vertical'                           => $vertical,
				'recommended_preset'                 => $recommended_preset,
				'execute_requested'                  => true,
				'exact_confirmation_matched'         => $exact_confirmation_matched,
				'confirmation_required_phrase'       => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => $server_confirmation_ready,
				'server_recomputed_preflight_ready'  => $server_preflight_ready,
				'runtime_snapshot_before'            => $runtime_snapshot_before,
				'dependency_recheck'                 => $dependency_recheck,
				'ownership_recheck'                  => $ownership_recheck,
				'runtime_diff_recheck'               => $runtime_diff_recheck,
				'generated'                          => false,
				'blocking_reasons'                   => [
					'Controlled generate currently supports the Real Estate vertical only.',
				],
				'warnings'                           => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not run. No site changes were made.',
							],
							$common_warnings
						)
					)
				),
				'risks'                              => $common_risks,
				'post_generate_checks'               => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                          => 'choose_supported_vertical',
			]
		);
	}

	if ( '' === $confirmation_phrase ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                             => 'warning',
				'code'                               => 'confirmation_phrase_required',
				'message'                            => 'Controlled generate requires the exact confirmation phrase.',
				'vertical'                           => $vertical,
				'recommended_preset'                 => $recommended_preset,
				'execute_requested'                  => true,
				'exact_confirmation_matched'         => false,
				'confirmation_required_phrase'       => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => $server_confirmation_ready,
				'server_recomputed_preflight_ready'  => $server_preflight_ready,
				'runtime_snapshot_before'            => $runtime_snapshot_before,
				'dependency_recheck'                 => $dependency_recheck,
				'ownership_recheck'                  => $ownership_recheck,
				'runtime_diff_recheck'               => $runtime_diff_recheck,
				'generated'                          => false,
				'blocking_reasons'                   => [
					'The exact confirmation phrase is required before controlled generate can proceed.',
				],
				'warnings'                           => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not run. No site changes were made.',
							],
							$common_warnings
						)
					)
				),
				'risks'                              => $common_risks,
				'post_generate_checks'               => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                          => 'enter_exact_confirmation_phrase',
			]
		);
	}

	if ( ! $exact_confirmation_matched ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                             => 'warning',
				'code'                               => 'confirmation_phrase_mismatch',
				'message'                            => 'The confirmation phrase did not match the required exact phrase.',
				'vertical'                           => $vertical,
				'recommended_preset'                 => $recommended_preset,
				'execute_requested'                  => true,
				'exact_confirmation_matched'         => false,
				'confirmation_required_phrase'       => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => $server_confirmation_ready,
				'server_recomputed_preflight_ready'  => $server_preflight_ready,
				'runtime_snapshot_before'            => $runtime_snapshot_before,
				'dependency_recheck'                 => $dependency_recheck,
				'ownership_recheck'                  => $ownership_recheck,
				'runtime_diff_recheck'               => $runtime_diff_recheck,
				'generated'                          => false,
				'blocking_reasons'                   => [
					'The supplied confirmation phrase did not exactly match the required phrase.',
				],
				'warnings'                           => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not run. No site changes were made.',
							],
							$common_warnings
						)
					)
				),
				'risks'                              => $common_risks,
				'post_generate_checks'               => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                          => 'enter_exact_confirmation_phrase',
			]
		);
	}

	$blocking_reasons = factory_ai_controlled_generate_text_list( $server_confirmation['blocking_reasons'] ?? [], 220 );

	if ( ! $server_preflight_ready || ! $server_confirmation_ready || ! empty( $blocking_reasons ) ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                             => 'warning',
				'code'                               => 'controlled_generate_blocked',
				'message'                            => 'Controlled generate is blocked until the recomputed checks are ready.',
				'vertical'                           => $vertical,
				'recommended_preset'                 => $recommended_preset,
				'execute_requested'                  => true,
				'exact_confirmation_matched'         => true,
				'confirmation_required_phrase'       => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => $server_confirmation_ready,
				'server_recomputed_preflight_ready'  => $server_preflight_ready,
				'runtime_snapshot_before'            => $runtime_snapshot_before,
				'dependency_recheck'                 => $dependency_recheck,
				'ownership_recheck'                  => $ownership_recheck,
				'runtime_diff_recheck'               => $runtime_diff_recheck,
				'generated'                          => false,
				'blocking_reasons'                   => $blocking_reasons,
				'warnings'                           => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not run. No site changes were made.',
							],
							$common_warnings
						)
					)
				),
				'risks'                              => $common_risks,
				'post_generate_checks'               => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                          => 'resolve_controlled_generate_blockers',
			]
		);
	}

	return factory_ai_controlled_generate_response(
		[
			'status'                             => 'warning',
			'code'                               => 'implementation_blocked',
			'message'                            => 'Exact confirmation was accepted, but controlled generate does not yet have a dedicated internal apply adapter.',
			'vertical'                           => $vertical,
			'recommended_preset'                 => $recommended_preset,
			'execute_requested'                  => true,
			'exact_confirmation_matched'         => true,
			'confirmation_required_phrase'       => $confirmation_required_phrase,
			'server_recomputed_confirmation_ready' => true,
			'server_recomputed_preflight_ready'  => true,
			'runtime_snapshot_before'            => $runtime_snapshot_before,
			'dependency_recheck'                 => $dependency_recheck,
			'ownership_recheck'                  => $ownership_recheck,
			'runtime_diff_recheck'               => $runtime_diff_recheck,
			'generated'                          => false,
			'blocking_reasons'                   => [
				'No dedicated internal controlled-generate callable exists yet.',
				'The current deterministic mutation path is exposed through the existing beta Real Estate REST apply callback and is intentionally not invoked from this service.',
			],
			'warnings'                           => array_values(
				array_unique(
					array_merge(
						[
							'Controlled generate did not run. No site changes were made.',
							'This endpoint intentionally stops at the final boundary until a safe internal apply adapter exists.',
						],
						$common_warnings
					)
				)
			),
			'risks'                              => array_values(
				array_unique(
					array_merge(
						$common_risks,
						[
							'Invoking the existing beta apply REST callback from this service would couple mutation to a request wrapper instead of a dedicated controlled apply adapter.',
						]
					)
				)
			),
			'generation_result'                  => [
				'status'            => 'blocked',
				'code'              => 'needs_apply_adapter',
				'callable_available' => false,
				'message'           => 'A safe internal controlled apply adapter must be introduced before exact-confirmation execution can mutate runtime.',
			],
			'post_generate_checks'               => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
			'next_step'                          => 'implement_safe_apply_adapter',
		]
	);
}

function factory_ai_controlled_generate_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$status = 'error';
	}

	$vertical = factory_ai_controlled_generate_normalize_site_type(
		(string) ( $overrides['vertical'] ?? 'unknown' )
	);

	return [
		'status'                             => $status,
		'code'                               => sanitize_key( (string) ( $overrides['code'] ?? 'controlled_generate_unavailable' ) ),
		'message'                            => sanitize_text_field( (string) ( $overrides['message'] ?? 'Controlled generate is unavailable.' ) ),
		'provider'                           => 'local',
		'mode'                               => 'controlled_generate_v1',
		'applies_changes'                    => ! empty( $overrides['applies_changes'] ),
		'provider_called'                    => false,
		'generated'                          => ! empty( $overrides['generated'] ),
		'vertical'                           => $vertical,
		'recommended_preset'                 => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'execute_requested'                  => ! empty( $overrides['execute_requested'] ),
		'exact_confirmation_matched'         => ! empty( $overrides['exact_confirmation_matched'] ),
		'confirmation_required_phrase'       => factory_ai_controlled_generate_clamp_text( $overrides['confirmation_required_phrase'] ?? 'GENERATE REAL ESTATE DEMO', 80 ),
		'server_recomputed_confirmation_ready' => ! empty( $overrides['server_recomputed_confirmation_ready'] ),
		'server_recomputed_preflight_ready'  => ! empty( $overrides['server_recomputed_preflight_ready'] ),
		'runtime_snapshot_before'            => factory_ai_controlled_generate_normalize_runtime_snapshot( $overrides['runtime_snapshot_before'] ?? [] ),
		'runtime_snapshot_after'             => factory_ai_controlled_generate_normalize_optional_runtime_snapshot( $overrides['runtime_snapshot_after'] ?? null ),
		'dependency_recheck'                 => factory_ai_controlled_generate_normalize_dependency_evidence( $overrides['dependency_recheck'] ?? [] ),
		'ownership_recheck'                  => factory_ai_controlled_generate_normalize_ownership_evidence( $overrides['ownership_recheck'] ?? [] ),
		'runtime_diff_recheck'               => factory_ai_controlled_generate_normalize_runtime_diff_evidence( $overrides['runtime_diff_recheck'] ?? [] ),
		'blocking_reasons'                   => factory_ai_controlled_generate_text_list( $overrides['blocking_reasons'] ?? [], 220 ),
		'warnings'                           => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 220 ),
		'risks'                              => factory_ai_controlled_generate_text_list( $overrides['risks'] ?? [], 220 ),
		'generation_result'                  => is_array( $overrides['generation_result'] ?? null ) ? $overrides['generation_result'] : null,
		'post_generate_checks'               => factory_ai_controlled_generate_text_list( $overrides['post_generate_checks'] ?? [], 220 ),
		'next_step'                          => sanitize_key( (string) ( $overrides['next_step'] ?? 'submit_exact_confirmation_with_execute' ) ),
		'usage'                              => null,
	];
}

function factory_ai_controlled_generate_normalize_runtime_snapshot( $snapshot ): array {
	if ( function_exists( 'factory_ai_generate_confirmation_normalize_runtime_evidence' ) ) {
		return factory_ai_generate_confirmation_normalize_runtime_evidence( $snapshot );
	}

	return is_array( $snapshot ) ? $snapshot : [];
}

function factory_ai_controlled_generate_normalize_optional_runtime_snapshot( $snapshot ) {
	if ( null === $snapshot ) {
		return null;
	}

	return factory_ai_controlled_generate_normalize_runtime_snapshot( $snapshot );
}

function factory_ai_controlled_generate_normalize_dependency_evidence( $evidence ): array {
	if ( function_exists( 'factory_ai_generate_confirmation_normalize_dependency_evidence' ) ) {
		return factory_ai_generate_confirmation_normalize_dependency_evidence( $evidence );
	}

	return is_array( $evidence ) ? $evidence : [];
}

function factory_ai_controlled_generate_normalize_ownership_evidence( $evidence ): array {
	if ( function_exists( 'factory_ai_generate_confirmation_normalize_ownership_evidence' ) ) {
		return factory_ai_generate_confirmation_normalize_ownership_evidence( $evidence );
	}

	return is_array( $evidence ) ? $evidence : [];
}

function factory_ai_controlled_generate_normalize_runtime_diff_evidence( $evidence ): array {
	if ( function_exists( 'factory_ai_generate_confirmation_normalize_runtime_diff_evidence' ) ) {
		return factory_ai_generate_confirmation_normalize_runtime_diff_evidence( $evidence );
	}

	return is_array( $evidence ) ? $evidence : [];
}

function factory_ai_controlled_generate_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_controlled_generate_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_controlled_generate_clamp_text( $value, int $max ): string {
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

function factory_ai_controlled_generate_normalize_context( array $context ): array {
	if ( function_exists( 'factory_ai_generate_confirmation_normalize_context' ) ) {
		return factory_ai_generate_confirmation_normalize_context( $context );
	}

	return $context;
}

function factory_ai_controlled_generate_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}
