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

	$server_confirmation = factory_ai_build_generate_confirmation(
		[
			'prompt'    => $prompt,
			'site_type' => $requested_site_type,
			'context'   => $context,
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
					'Authoritative execution readiness is rebuilt from prompt, safe context, and site type only.',
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

	$dependency_status_now = function_exists( 'factory_ai_generate_preflight_dependency_status' )
		? factory_ai_generate_preflight_dependency_status()
		: [];
	$dependency_recheck = factory_ai_controlled_generate_normalize_dependency_evidence(
		function_exists( 'factory_ai_generate_confirmation_dependency_evidence' )
			? factory_ai_generate_confirmation_dependency_evidence( $dependency_status_now )
			: $dependency_status_now
	);
	$ownership_status_now = function_exists( 'factory_ai_generate_preflight_ownership_status' )
		? factory_ai_generate_preflight_ownership_status( $vertical, $recommended_preset )
		: [];
	$ownership_recheck = factory_ai_controlled_generate_normalize_ownership_evidence(
		function_exists( 'factory_ai_generate_confirmation_ownership_evidence' )
			? factory_ai_generate_confirmation_ownership_evidence( $ownership_status_now )
			: $ownership_status_now
	);
	$runtime_snapshot_before = factory_ai_controlled_generate_capture_runtime_snapshot( $dependency_status_now );
	$final_blocking_reasons = [];

	if ( empty( $dependency_recheck['ready'] ) ) {
		$final_blocking_reasons[] = 'Required runtime dependencies are not ready for controlled generate.';
	}

	foreach ( factory_ai_controlled_generate_text_list( $dependency_recheck['blocking'] ?? [], 220 ) as $reason ) {
		$final_blocking_reasons[] = $reason;
	}

	foreach ( factory_ai_controlled_generate_text_list( $ownership_recheck['blocking_conflicts'] ?? [], 220 ) as $reason ) {
		$final_blocking_reasons[] = $reason;
	}

	$final_blocking_reasons = array_values( array_unique( $final_blocking_reasons ) );

	if ( ! function_exists( 'factory_apply_real_estate_preset_internal' ) ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                               => 'error',
				'code'                                 => 'internal_apply_service_unavailable',
				'message'                              => 'The internal Real Estate apply service is unavailable in the current runtime.',
				'vertical'                             => $vertical,
				'recommended_preset'                   => $recommended_preset,
				'execute_requested'                    => true,
				'exact_confirmation_matched'           => true,
				'confirmation_required_phrase'         => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => true,
				'server_recomputed_preflight_ready'    => true,
				'runtime_snapshot_before'              => $runtime_snapshot_before,
				'dependency_recheck'                   => $dependency_recheck,
				'ownership_recheck'                    => $ownership_recheck,
				'runtime_diff_recheck'                 => $runtime_diff_recheck,
				'generated'                            => false,
				'blocking_reasons'                     => [
					'The internal deterministic Real Estate apply service is not available.',
				],
				'warnings'                             => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not run. No site changes were made.',
							],
							$common_warnings
						)
					)
				),
				'risks'                                => $common_risks,
				'post_generate_checks'                 => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                            => 'restore_internal_apply_service',
			]
		);
	}

	if ( ! empty( $final_blocking_reasons ) ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                               => 'warning',
				'code'                                 => 'controlled_generate_recheck_blocked',
				'message'                              => 'Controlled generate is blocked by the final server-side dependency or ownership recheck.',
				'vertical'                             => $vertical,
				'recommended_preset'                   => $recommended_preset,
				'execute_requested'                    => true,
				'exact_confirmation_matched'           => true,
				'confirmation_required_phrase'         => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => true,
				'server_recomputed_preflight_ready'    => true,
				'runtime_snapshot_before'              => $runtime_snapshot_before,
				'dependency_recheck'                   => $dependency_recheck,
				'ownership_recheck'                    => $ownership_recheck,
				'runtime_diff_recheck'                 => $runtime_diff_recheck,
				'generated'                            => false,
				'blocking_reasons'                     => $final_blocking_reasons,
				'warnings'                             => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not run. No site changes were made.',
								'Final dependency and ownership checks are recomputed immediately before execution.',
							],
							$common_warnings
						)
					)
				),
				'risks'                                => $common_risks,
				'post_generate_checks'                 => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                            => 'resolve_controlled_generate_blockers',
			]
		);
	}

	$apply_context = factory_ai_controlled_generate_sanitize_apply_context( $context );

	try {
		$apply_result = factory_apply_real_estate_preset_internal(
			[
				'source'          => 'controlled_generate',
				'fallback_prompt' => '' !== trim( $prompt ) ? $prompt : 'Controlled generate: real-estate',
				'prompt_context'  => [
					'prompt'            => '' !== trim( $prompt ) ? $prompt : 'Controlled generate: real-estate',
					'preset_variables'  => $apply_context['preset_variables'],
					'applied_variables' => $apply_context['preset_variables'],
					'notes'             => [
						'Controlled generate execution reused the safe variable overlay context.',
						'Client-provided readiness flags were ignored in favor of server recomputation.',
					],
				],
				'style_context'   => [
					'context' => $apply_context['style_context'],
					'notes'   => [
						'Controlled generate reused the safe style context after server-side gating.',
					],
				],
				'image_context'   => [
					'context' => $apply_context['image_context'],
					'notes'   => [
						'Controlled generate reused the safe image context after server-side gating.',
					],
				],
				'manifest_metadata' => [
					'apply_source'                         => 'controlled_generate',
					'ai_flow'                              => 'controlled_generate_v1',
					'confirmation_phrase_matched'          => true,
					'server_recomputed_preflight_ready'    => true,
					'server_recomputed_confirmation_ready' => true,
				],
			]
		);
	} catch ( Throwable $e ) {
		return factory_ai_controlled_generate_response(
			[
				'status'                               => 'error',
				'code'                                 => 'controlled_generate_apply_failed',
				'message'                              => 'Controlled generate failed while calling the internal Real Estate apply service.',
				'vertical'                             => $vertical,
				'recommended_preset'                   => $recommended_preset,
				'execute_requested'                    => true,
				'exact_confirmation_matched'           => true,
				'confirmation_required_phrase'         => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => true,
				'server_recomputed_preflight_ready'    => true,
				'runtime_snapshot_before'              => $runtime_snapshot_before,
				'dependency_recheck'                   => $dependency_recheck,
				'ownership_recheck'                    => $ownership_recheck,
				'runtime_diff_recheck'                 => $runtime_diff_recheck,
				'mutation_status'                      => 'unknown_after_apply_started',
				'applies_changes'                      => true,
				'generated'                            => false,
				'blocking_reasons'                     => [
					'The internal apply service raised an exception before controlled generate could complete.',
				],
				'warnings'                             => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate entered the internal apply boundary but did not report a successful completion.',
								'Partial mutation may have occurred. Run doctor and review latest proof before retrying.',
							],
							$common_warnings
						)
					)
				),
				'risks'                                => array_values(
					array_unique(
						array_merge(
							$common_risks,
							[
								factory_ai_controlled_generate_clamp_text( $e->getMessage(), 220 ),
								'Partial mutation may have occurred because the failure happened after the internal apply boundary was entered.',
							]
						)
					)
				),
				'post_generate_checks'                 => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                            => 'run_doctor_and_review_proof',
			]
		);
	}

	if ( empty( $apply_result['ok'] ) ) {
		$apply_error_code = sanitize_key( (string) ( $apply_result['error_code'] ?? 'controlled_generate_apply_failed' ) );
		$apply_error_message = sanitize_text_field( (string) ( $apply_result['error_message'] ?? 'Controlled generate could not complete.' ) );

		return factory_ai_controlled_generate_response(
			[
				'status'                               => 'warning',
				'code'                                 => '' !== $apply_error_code ? $apply_error_code : 'controlled_generate_apply_failed',
				'message'                              => $apply_error_message,
				'vertical'                             => $vertical,
				'recommended_preset'                   => $recommended_preset,
				'execute_requested'                    => true,
				'exact_confirmation_matched'           => true,
				'confirmation_required_phrase'         => $confirmation_required_phrase,
				'server_recomputed_confirmation_ready' => true,
				'server_recomputed_preflight_ready'    => true,
				'runtime_snapshot_before'              => $runtime_snapshot_before,
				'dependency_recheck'                   => $dependency_recheck,
				'ownership_recheck'                    => $ownership_recheck,
				'runtime_diff_recheck'                 => $runtime_diff_recheck,
				'mutation_status'                      => 'unknown_after_apply_started',
				'applies_changes'                      => true,
				'generated'                            => false,
				'blocking_reasons'                     => [
					$apply_error_message,
				],
				'warnings'                             => array_values(
					array_unique(
						array_merge(
							[
								'Controlled generate did not finish successfully. Review the returned error before retrying.',
								'Partial mutation may have occurred because the internal apply boundary was already entered.',
							],
							$common_warnings
						)
					)
				),
				'risks'                                => array_values(
					array_unique(
						array_merge(
							$common_risks,
							[
								'Run doctor and review latest proof before retrying because the failure happened after entering the internal apply boundary.',
							]
						)
					)
				),
				'post_generate_checks'                 => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
				'next_step'                            => 'run_doctor_and_review_proof',
			]
		);
	}

	$dependency_status_after = function_exists( 'factory_ai_generate_preflight_dependency_status' )
		? factory_ai_generate_preflight_dependency_status()
		: $dependency_status_now;
	$runtime_snapshot_after = factory_ai_controlled_generate_capture_runtime_snapshot( $dependency_status_after );
	$generation_status = sanitize_key( (string) ( $apply_result['response']['status'] ?? $apply_result['report']['status'] ?? 'ok' ) );

	if ( ! in_array( $generation_status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$generation_status = 'ok';
	}

	return factory_ai_controlled_generate_response(
		[
			'status'                               => $generation_status,
			'code'                                 => 'controlled_generate_completed',
			'message'                              => sanitize_text_field( (string) ( $apply_result['response']['message'] ?? 'Controlled generate completed through the internal deterministic Real Estate apply service.' ) ),
			'applies_changes'                      => true,
			'vertical'                             => $vertical,
			'recommended_preset'                   => $recommended_preset,
			'execute_requested'                    => true,
			'exact_confirmation_matched'           => true,
			'confirmation_required_phrase'         => $confirmation_required_phrase,
			'server_recomputed_confirmation_ready' => true,
			'server_recomputed_preflight_ready'    => true,
			'runtime_snapshot_before'              => $runtime_snapshot_before,
			'runtime_snapshot_after'               => $runtime_snapshot_after,
			'dependency_recheck'                   => $dependency_recheck,
			'ownership_recheck'                    => $ownership_recheck,
			'runtime_diff_recheck'                 => $runtime_diff_recheck,
			'mutation_status'                      => 'completed',
			'generated'                            => true,
			'blocking_reasons'                     => [],
			'warnings'                             => array_values(
				array_unique(
					array_merge(
						$common_warnings,
						factory_ai_controlled_generate_text_list( $apply_result['report']['warnings'] ?? [], 220 )
					)
				)
			),
			'risks'                                => array_values(
				array_unique(
					array_merge(
						$common_risks,
						[
							'Review validation, doctor, and latest run proof before treating the generated site as final.',
						]
					)
				)
			),
			'generation_result'                    => [
				'status'          => $generation_status,
				'code'            => 'controlled_generate_completed',
				'message'         => sanitize_text_field( (string) ( $apply_result['response']['message'] ?? 'Controlled generate completed.' ) ),
				'file'            => sanitize_text_field( (string) ( $apply_result['response']['file'] ?? basename( (string) ( $apply_result['manifest_path'] ?? '' ) ) ) ),
				'plan_summary'    => is_array( $apply_result['response']['plan_summary'] ?? null ) ? $apply_result['response']['plan_summary'] : [],
				'results_summary' => is_array( $apply_result['response']['results_summary'] ?? null ) ? $apply_result['response']['results_summary'] : [],
			],
			'manifest_path'                        => $apply_result['manifest_path'] ?? null,
			'validation_count'                     => count( $apply_result['report']['checks'] ?? [] ),
			'execution_count'                      => count( $apply_result['execution'] ?? [] ),
			'post_generate_checks'                 => factory_ai_controlled_generate_text_list( $server_confirmation['post_generate_checks'] ?? [], 220 ),
			'next_step'                            => 'doctor_proof_review',
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
		'mutation_status'                    => factory_ai_controlled_generate_normalize_mutation_status( $overrides['mutation_status'] ?? ( ! empty( $overrides['applies_changes'] ) ? 'completed' : 'not_started' ) ),
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
		'manifest_path'                      => is_scalar( $overrides['manifest_path'] ?? null ) ? sanitize_text_field( (string) $overrides['manifest_path'] ) : null,
		'validation_count'                   => isset( $overrides['validation_count'] ) ? max( 0, (int) $overrides['validation_count'] ) : null,
		'execution_count'                    => isset( $overrides['execution_count'] ) ? max( 0, (int) $overrides['execution_count'] ) : null,
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

function factory_ai_controlled_generate_sanitize_apply_context( array $context ): array {
	if ( function_exists( 'factory_rest_ai_sanitize_interpret_context' ) ) {
		return factory_rest_ai_sanitize_interpret_context( $context );
	}

	$preset_variables = is_array( $context['preset_variables'] ?? null ) ? $context['preset_variables'] : [];
	$style_context = is_array( $context['style_context'] ?? null ) ? $context['style_context'] : [];
	$image_context = is_array( $context['image_context'] ?? null ) ? $context['image_context'] : [];

	return [
		'preset'           => 'real-estate',
		'preset_variables' => [
			'agency_name'   => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['agency_name'] ?? '', 'text', 80 ) : sanitize_text_field( (string) ( $preset_variables['agency_name'] ?? '' ) ),
			'hero_title'    => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['hero_title'] ?? '', 'text', 120 ) : sanitize_text_field( (string) ( $preset_variables['hero_title'] ?? '' ) ),
			'hero_subtitle' => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['hero_subtitle'] ?? '', 'textarea', 240 ) : sanitize_textarea_field( (string) ( $preset_variables['hero_subtitle'] ?? '' ) ),
			'hero_cta_text' => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['hero_cta_text'] ?? '', 'text', 60 ) : sanitize_text_field( (string) ( $preset_variables['hero_cta_text'] ?? '' ) ),
			'contact_title' => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['contact_title'] ?? '', 'text', 120 ) : sanitize_text_field( (string) ( $preset_variables['contact_title'] ?? '' ) ),
			'contact_intro' => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['contact_intro'] ?? '', 'textarea', 400 ) : sanitize_textarea_field( (string) ( $preset_variables['contact_intro'] ?? '' ) ),
			'phone'         => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['phone'] ?? '', 'phone', 60 ) : sanitize_text_field( (string) ( $preset_variables['phone'] ?? '' ) ),
			'email'         => function_exists( 'factory_ai_sanitize_safe_variable' ) ? factory_ai_sanitize_safe_variable( $preset_variables['email'] ?? '', 'email', 120 ) : sanitize_email( (string) ( $preset_variables['email'] ?? '' ) ),
		],
		'style_context'    => [
			'tone'           => function_exists( 'factory_ai_normalize_enum' ) ? factory_ai_normalize_enum( $style_context['tone'] ?? 'premium', [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ], 'premium' ) : 'premium',
			'primary_preset' => function_exists( 'factory_ai_normalize_enum' ) ? factory_ai_normalize_enum( $style_context['primary_preset'] ?? 'turquoise', [ 'turquoise', 'blue', 'green', 'beige' ], 'turquoise' ) : 'turquoise',
		],
		'image_context'    => [
			'source' => 'demo_pool',
			'mode'   => 'round_robin',
		],
	];
}

function factory_ai_controlled_generate_capture_runtime_snapshot( array $dependency_status = [] ): array {
	if ( function_exists( 'factory_ai_generate_preflight_runtime_snapshot' ) ) {
		return factory_ai_controlled_generate_normalize_runtime_snapshot(
			factory_ai_generate_preflight_runtime_snapshot( $dependency_status )
		);
	}

	return factory_ai_controlled_generate_normalize_runtime_snapshot( [] );
}

function factory_ai_controlled_generate_normalize_mutation_status( $status ): string {
	$status = sanitize_key( (string) $status );
	$allowed = [ 'not_started', 'unknown_after_apply_started', 'completed' ];

	return in_array( $status, $allowed, true ) ? $status : 'not_started';
}

function factory_ai_controlled_generate_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}
