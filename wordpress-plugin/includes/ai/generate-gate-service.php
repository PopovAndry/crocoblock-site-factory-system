<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_generate_gate( array $input = [] ): array {
	$prompt = $input['prompt'] ?? '';
	$site_plan = is_array( $input['site_plan'] ?? null ) ? $input['site_plan'] : [];
	$blueprint_candidate = is_array( $input['blueprint_candidate'] ?? null ) ? $input['blueprint_candidate'] : [];
	$preview_diff = is_array( $input['preview_diff'] ?? null ) ? $input['preview_diff'] : [];
	$context = is_array( $input['context'] ?? null ) ? $input['context'] : [];
	$requested_site_type = factory_ai_generate_gate_normalize_site_type(
		(string) ( $input['site_type'] ?? $input['vertical'] ?? '' )
	);

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$context = factory_ai_generate_gate_normalize_context( $context );

	if ( empty( $preview_diff ) && empty( $blueprint_candidate ) && empty( $site_plan ) && '' === trim( $prompt ) ) {
		return factory_ai_generate_gate_response(
			[
				'status'         => 'error',
				'code'           => 'missing_generate_gate_input',
				'message'        => 'Provide a prompt, preview, candidate, or site plan before checking the generate gate.',
				'vertical'       => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'can_generate'   => false,
				'blocking_reasons' => [
					'No prompt, site plan, candidate, or preview context was provided.',
				],
				'warnings'       => [
					'Gate only. No site changes were made.',
					'Actual generation requires explicit confirmation.',
				],
				'next_step'      => 'enter_prompt',
			]
		);
	}

	$source_preview_diff = ! empty( $preview_diff )
		? factory_ai_generate_gate_normalize_preview_diff_source( $preview_diff )
		: factory_ai_build_preview_diff(
			[
				'prompt'              => $prompt,
				'site_plan'           => $site_plan,
				'blueprint_candidate' => $blueprint_candidate,
				'site_type'           => $requested_site_type,
				'context'             => $context,
			]
		);

	$vertical = factory_ai_generate_gate_normalize_site_type(
		(string) (
			$source_preview_diff['vertical']
			?? $requested_site_type
			?? 'unknown'
		)
	);
	$recommended_preset = sanitize_text_field( (string) ( $source_preview_diff['recommended_preset'] ?? '' ) );
	$unsupported_requests = factory_ai_normalize_unsupported_items( $source_preview_diff['unsupported_requests'] ?? [] );
	$required_dependencies = factory_ai_generate_gate_required_dependencies();
	$optional_dependencies = factory_ai_generate_gate_optional_dependencies( $source_preview_diff );
	$ownership_checks = factory_ai_generate_gate_ownership_checks();
	$preflight_checks = factory_ai_generate_gate_preflight_checks();
	$post_generate_checks = factory_ai_generate_gate_post_generate_checks();
	$blocking_reasons = factory_ai_generate_gate_blocking_reasons( $source_preview_diff, $vertical, $recommended_preset, $unsupported_requests );
	$can_generate = empty( $blocking_reasons );
	$warnings = array_values(
		array_unique(
			array_merge(
				[
					'Gate only. No site changes were made.',
					'Actual generation requires explicit confirmation.',
				],
				factory_ai_normalize_string_list( $source_preview_diff['warnings'] ?? [], 220 )
			)
		)
	);
	$risks = array_values(
		array_unique(
			array_merge(
				[
					'This gate does not execute runtime dependency, ownership, or doctor checks by itself.',
					'Controlled generate must still run runtime preflight checks before any WordPress mutation later.',
				],
				factory_ai_generate_gate_text_list( $source_preview_diff['risks'] ?? [], 220 )
			)
		)
	);

	return factory_ai_generate_gate_response(
		[
			'status'                     => $can_generate ? 'ok' : 'warning',
			'code'                       => $can_generate ? 'generate_gate_ready' : 'generate_gate_blocked',
			'message'                    => $can_generate
				? 'Controlled generation gate is ready for review.'
				: 'Controlled generation gate is blocked until the listed issues are resolved.',
			'vertical'                   => $vertical,
			'recommended_preset'         => $recommended_preset,
			'can_generate'               => $can_generate,
			'requires_user_confirmation' => true,
			'confirmation_required_phrase' => 'GENERATE REAL ESTATE DEMO',
			'generation_target'          => [
				'type'      => 'preset',
				'preset'    => 'real-estate',
				'operation' => 'controlled_generate_later',
			],
			'source_preview_diff'        => $source_preview_diff,
			'required_dependencies'      => $required_dependencies,
			'optional_dependencies'      => $optional_dependencies,
			'ownership_checks'           => $ownership_checks,
			'preflight_checks'           => $preflight_checks,
			'blocking_reasons'           => $blocking_reasons,
			'warnings'                   => $warnings,
			'risks'                      => $risks,
			'post_generate_checks'       => $post_generate_checks,
			'next_step'                  => $can_generate ? 'confirm_controlled_generate' : 'resolve_generate_blockers',
		]
	);
}

function factory_ai_generate_gate_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$status = 'error';
	}

	$vertical = factory_ai_generate_gate_normalize_site_type(
		(string) ( $overrides['vertical'] ?? 'unknown' )
	);

	return [
		'status'                     => $status,
		'code'                       => sanitize_key( (string) ( $overrides['code'] ?? 'generate_gate_unavailable' ) ),
		'message'                    => sanitize_text_field( (string) ( $overrides['message'] ?? 'Generate gate is unavailable.' ) ),
		'provider'                   => 'local',
		'mode'                       => 'generate_gate_v1',
		'applies_changes'            => false,
		'provider_called'            => false,
		'vertical'                   => $vertical,
		'recommended_preset'         => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'can_generate'               => ! empty( $overrides['can_generate'] ),
		'requires_user_confirmation' => ! empty( $overrides['requires_user_confirmation'] ),
		'confirmation_required_phrase' => factory_ai_generate_gate_clamp_text( $overrides['confirmation_required_phrase'] ?? '', 80 ),
		'generation_target'          => factory_ai_generate_gate_normalize_generation_target( $overrides['generation_target'] ?? [] ),
		'source_preview_diff'        => factory_ai_generate_gate_normalize_preview_diff_source( $overrides['source_preview_diff'] ?? [] ),
		'required_dependencies'      => factory_ai_generate_gate_normalize_dependency_items( $overrides['required_dependencies'] ?? [], true ),
		'optional_dependencies'      => factory_ai_generate_gate_normalize_dependency_items( $overrides['optional_dependencies'] ?? [], false ),
		'ownership_checks'           => factory_ai_generate_gate_text_list( $overrides['ownership_checks'] ?? [], 220 ),
		'preflight_checks'           => factory_ai_generate_gate_text_list( $overrides['preflight_checks'] ?? [], 220 ),
		'blocking_reasons'           => factory_ai_generate_gate_text_list( $overrides['blocking_reasons'] ?? [], 220 ),
		'warnings'                   => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 220 ),
		'risks'                      => factory_ai_generate_gate_text_list( $overrides['risks'] ?? [], 220 ),
		'post_generate_checks'       => factory_ai_generate_gate_text_list( $overrides['post_generate_checks'] ?? [], 220 ),
		'next_step'                  => sanitize_key( (string) ( $overrides['next_step'] ?? 'confirm_controlled_generate' ) ),
		'usage'                      => null,
	];
}

function factory_ai_generate_gate_required_dependencies(): array {
	return factory_ai_generate_gate_normalize_dependency_items(
		[
			[
				'name'     => 'WordPress',
				'required' => true,
				'note'     => 'A working WordPress runtime is required for controlled generate later.',
			],
			[
				'name'     => 'Kava theme',
				'required' => true,
				'note'     => 'The deterministic Real Estate preset expects the supported theme runtime.',
			],
			[
				'name'     => 'JetEngine',
				'required' => true,
				'note'     => 'JetEngine provides the required Real Estate structures.',
			],
		],
		true
	);
}

function factory_ai_generate_gate_optional_dependencies( array $preview_diff ): array {
	$items = [];
	$optional_features = is_array( $preview_diff['optional_features'] ?? null ) ? $preview_diff['optional_features'] : [];

	$has_filters = false;
	$has_forms = false;

	foreach ( $optional_features as $feature ) {
		$name = strtolower( (string) ( $feature['feature'] ?? '' ) );

		if ( 'jetsmartfilters' === $name ) {
			$has_filters = true;
		}

		if ( 'jetformbuilder' === $name ) {
			$has_forms = true;
		}
	}

	if ( $has_filters ) {
		$items[] = [
			'name'     => 'JetSmartFilters',
			'required' => false,
			'note'     => 'Optional filtering enhancements can be applied when this plugin is available.',
		];
	}

	if ( $has_forms ) {
		$items[] = [
			'name'     => 'JetFormBuilder',
			'required' => false,
			'note'     => 'Optional form enhancements can be applied when this plugin is available.',
		];
	}

	return factory_ai_generate_gate_normalize_dependency_items( $items, false );
}

function factory_ai_generate_gate_ownership_checks(): array {
	return [
		'Factory-managed content must be safe to update before controlled generate later.',
		'User-modified generated content must be preserved or blocked before controlled generate later.',
		'User-created unrelated content must remain untouched by the controlled generate flow.',
	];
}

function factory_ai_generate_gate_preflight_checks(): array {
	return [
		'preview/diff review',
		'dependency check',
		'ownership check',
		'dry-run proof',
		'confirmation phrase',
	];
}

function factory_ai_generate_gate_post_generate_checks(): array {
	return [
		'run validation',
		'run doctor',
		'refresh latest run proof',
		'open generated Home, Properties, and Contact pages',
	];
}

function factory_ai_generate_gate_blocking_reasons( array $preview_diff, string $vertical, string $recommended_preset, array $unsupported_requests ): array {
	$reasons = [];

	if ( 'real_estate' !== $vertical ) {
		$reasons[] = 'Controlled generate currently supports the Real Estate vertical only.';
	}

	if ( 'real-estate' !== $recommended_preset ) {
		$reasons[] = 'The Real Estate preset is the only supported controlled generate target in v1.';
	}

	$preview = is_array( $preview_diff['preview'] ?? null ) ? $preview_diff['preview'] : [];
	$readiness = sanitize_key( (string) ( $preview['readiness'] ?? '' ) );
	$can_generate_later = ! empty( $preview['can_generate_later'] );

	if ( ! $can_generate_later ) {
		$reasons[] = 'The preview context is not ready for controlled generate later.';
	}

	if ( in_array( $readiness, [ 'unsupported', 'candidate_required' ], true ) ) {
		$reasons[] = 'The preview/diff flow is not yet in a review-ready state.';
	}

	if ( ! empty( $unsupported_requests ) ) {
		$reasons[] = 'Unsupported requests must be removed or resolved before controlled generate later.';
	}

	return array_values( array_unique( factory_ai_generate_gate_text_list( $reasons, 220 ) ) );
}

function factory_ai_generate_gate_normalize_generation_target( $target ): array {
	if ( ! is_array( $target ) ) {
		$target = [];
	}

	return [
		'type'      => sanitize_key( (string) ( $target['type'] ?? 'preset' ) ),
		'preset'    => sanitize_key( (string) ( $target['preset'] ?? 'real-estate' ) ),
		'operation' => sanitize_key( (string) ( $target['operation'] ?? 'controlled_generate_later' ) ),
	];
}

function factory_ai_generate_gate_normalize_dependency_items( $items, bool $required ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$name = factory_ai_generate_gate_clamp_text( $item['name'] ?? '', 120 );
		$note = factory_ai_generate_gate_clamp_text( $item['note'] ?? '', 220 );

		if ( '' === $name ) {
			continue;
		}

		$normalized[] = [
			'name'     => $name,
			'required' => isset( $item['required'] ) ? (bool) $item['required'] : $required,
			'note'     => $note,
		];
	}

	return $normalized;
}

function factory_ai_generate_gate_normalize_preview_diff_source( $preview_diff ): array {
	if ( ! is_array( $preview_diff ) ) {
		return [];
	}

	if ( function_exists( 'factory_ai_preview_diff_response' ) ) {
		$normalized = factory_ai_preview_diff_response( $preview_diff );
		unset( $normalized['provider'], $normalized['mode'], $normalized['applies_changes'], $normalized['provider_called'], $normalized['usage'] );

		return $normalized;
	}

	return $preview_diff;
}

function factory_ai_generate_gate_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_generate_gate_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_generate_gate_clamp_text( $value, int $max ): string {
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

function factory_ai_generate_gate_normalize_context( array $context ): array {
	if ( function_exists( 'factory_ai_preview_diff_normalize_context' ) ) {
		return factory_ai_preview_diff_normalize_context( $context );
	}

	return $context;
}

function factory_ai_generate_gate_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}
