<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_build_generate_preflight( array $input = [] ): array {
	$prompt = $input['prompt'] ?? '';
	$site_plan = is_array( $input['site_plan'] ?? null ) ? $input['site_plan'] : [];
	$blueprint_candidate = is_array( $input['blueprint_candidate'] ?? null ) ? $input['blueprint_candidate'] : [];
	$preview_diff = is_array( $input['preview_diff'] ?? null ) ? $input['preview_diff'] : [];
	$generate_gate = is_array( $input['generate_gate'] ?? null ) ? $input['generate_gate'] : [];
	$context = is_array( $input['context'] ?? null ) ? $input['context'] : [];
	$requested_site_type = factory_ai_generate_preflight_normalize_site_type(
		(string) ( $input['site_type'] ?? $input['vertical'] ?? '' )
	);

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$context = factory_ai_generate_preflight_normalize_context( $context );

	if ( empty( $generate_gate ) && empty( $preview_diff ) && empty( $blueprint_candidate ) && empty( $site_plan ) && '' === trim( $prompt ) ) {
		return factory_ai_generate_preflight_response(
			[
				'status'             => 'error',
				'code'               => 'missing_generate_preflight_input',
				'message'            => 'Provide a prompt, generate gate, preview, candidate, or site plan before running preflight.',
				'vertical'           => '' !== $requested_site_type ? $requested_site_type : 'unknown',
				'preflight_ready'    => false,
				'can_proceed_to_confirmation' => false,
				'blocking_reasons'   => [
					'No prompt, site plan, candidate, preview, or generate gate context was provided.',
				],
				'warnings'           => [
					'Preflight only. No site changes were made.',
					'Actual controlled generation requires final confirmation and runtime apply.',
				],
				'next_step'          => 'enter_prompt',
			]
		);
	}

	$source_generate_gate = ! empty( $generate_gate )
		? factory_ai_generate_preflight_normalize_generate_gate_source( $generate_gate )
		: factory_ai_build_generate_gate(
			[
				'prompt'              => $prompt,
				'site_plan'           => $site_plan,
				'blueprint_candidate' => $blueprint_candidate,
				'preview_diff'        => $preview_diff,
				'site_type'           => $requested_site_type,
				'context'             => $context,
			]
		);

	$vertical = factory_ai_generate_preflight_normalize_site_type(
		(string) (
			$source_generate_gate['vertical']
			?? $requested_site_type
			?? 'unknown'
		)
	);
	$recommended_preset = sanitize_text_field( (string) ( $source_generate_gate['recommended_preset'] ?? '' ) );
	$dependency_status = factory_ai_generate_preflight_dependency_status();
	$ownership_status = factory_ai_generate_preflight_ownership_status( $vertical, $recommended_preset );
	$current_runtime_snapshot = factory_ai_generate_preflight_runtime_snapshot( $dependency_status );
	$dry_run_proof_preview = factory_ai_generate_preflight_dry_run_proof_preview( $source_generate_gate, $dependency_status, $ownership_status );
	$blocking_reasons = factory_ai_generate_preflight_blocking_reasons(
		$source_generate_gate,
		$dependency_status,
		$ownership_status,
		$vertical,
		$recommended_preset
	);
	$preflight_ready = empty( $blocking_reasons )
		&& ! empty( $source_generate_gate['can_generate'] )
		&& 'real_estate' === $vertical
		&& 'real-estate' === $recommended_preset;
	$warnings = array_values(
		array_unique(
			array_merge(
				[
					'Preflight only. No site changes were made.',
					'Actual controlled generation requires final confirmation and runtime apply.',
				],
				factory_ai_normalize_string_list( $source_generate_gate['warnings'] ?? [], 220 ),
				factory_ai_normalize_string_list( $dependency_status['warnings'] ?? [], 220 ),
				factory_ai_normalize_string_list( $ownership_status['notes'] ?? [], 220 )
			)
		)
	);
	$risks = array_values(
		array_unique(
			array_merge(
				[
					'Dependency and ownership status must be checked again immediately before real apply.',
					'This preflight report is read-only and does not compute a final runtime diff or execute doctor/validation.',
				],
				factory_ai_generate_preflight_text_list( $source_generate_gate['risks'] ?? [], 220 )
			)
		)
	);

	return factory_ai_generate_preflight_response(
		[
			'status'                     => $preflight_ready ? 'ok' : 'warning',
			'code'                       => $preflight_ready ? 'generate_preflight_ready' : 'generate_preflight_blocked',
			'message'                    => $preflight_ready
				? 'Controlled generation preflight is ready for review.'
				: 'Controlled generation preflight is blocked until the listed issues are resolved.',
			'vertical'                   => $vertical,
			'recommended_preset'         => $recommended_preset,
			'source_generate_gate'       => $source_generate_gate,
			'preflight_ready'            => $preflight_ready,
			'can_proceed_to_confirmation' => $preflight_ready,
			'requires_user_confirmation' => true,
			'confirmation_required_phrase' => factory_ai_generate_preflight_clamp_text( $source_generate_gate['confirmation_required_phrase'] ?? 'GENERATE REAL ESTATE DEMO', 80 ),
			'dependency_status'          => $dependency_status,
			'ownership_status'           => $ownership_status,
			'current_runtime_snapshot'   => $current_runtime_snapshot,
			'dry_run_proof_preview'      => $dry_run_proof_preview,
			'blocking_reasons'           => $blocking_reasons,
			'warnings'                   => $warnings,
			'risks'                      => $risks,
			'post_generate_checks'       => factory_ai_generate_preflight_text_list( $source_generate_gate['post_generate_checks'] ?? [], 220 ),
			'next_step'                  => $preflight_ready ? 'confirm_controlled_generate_after_preflight' : 'resolve_preflight_blockers',
		]
	);
}

function factory_ai_generate_preflight_response( array $overrides = [] ): array {
	$status = sanitize_key( (string) ( $overrides['status'] ?? 'error' ) );

	if ( ! in_array( $status, [ 'ok', 'warning', 'error', 'disabled' ], true ) ) {
		$status = 'error';
	}

	$vertical = factory_ai_generate_preflight_normalize_site_type(
		(string) ( $overrides['vertical'] ?? 'unknown' )
	);

	return [
		'status'                     => $status,
		'code'                       => sanitize_key( (string) ( $overrides['code'] ?? 'generate_preflight_unavailable' ) ),
		'message'                    => sanitize_text_field( (string) ( $overrides['message'] ?? 'Generate preflight is unavailable.' ) ),
		'provider'                   => 'local',
		'mode'                       => 'generate_preflight_v1',
		'applies_changes'            => false,
		'provider_called'            => false,
		'vertical'                   => $vertical,
		'recommended_preset'         => sanitize_text_field( (string) ( $overrides['recommended_preset'] ?? '' ) ),
		'source_generate_gate'       => factory_ai_generate_preflight_normalize_generate_gate_source( $overrides['source_generate_gate'] ?? [] ),
		'preflight_ready'            => ! empty( $overrides['preflight_ready'] ),
		'can_proceed_to_confirmation' => ! empty( $overrides['can_proceed_to_confirmation'] ),
		'requires_user_confirmation' => ! empty( $overrides['requires_user_confirmation'] ),
		'confirmation_required_phrase' => factory_ai_generate_preflight_clamp_text( $overrides['confirmation_required_phrase'] ?? '', 80 ),
		'dependency_status'          => factory_ai_generate_preflight_normalize_dependency_status( $overrides['dependency_status'] ?? [] ),
		'ownership_status'           => factory_ai_generate_preflight_normalize_ownership_status( $overrides['ownership_status'] ?? [] ),
		'current_runtime_snapshot'   => factory_ai_generate_preflight_normalize_runtime_snapshot( $overrides['current_runtime_snapshot'] ?? [] ),
		'dry_run_proof_preview'      => factory_ai_generate_preflight_normalize_dry_run_preview( $overrides['dry_run_proof_preview'] ?? [] ),
		'blocking_reasons'           => factory_ai_generate_preflight_text_list( $overrides['blocking_reasons'] ?? [], 220 ),
		'warnings'                   => factory_ai_normalize_string_list( $overrides['warnings'] ?? [], 220 ),
		'risks'                      => factory_ai_generate_preflight_text_list( $overrides['risks'] ?? [], 220 ),
		'post_generate_checks'       => factory_ai_generate_preflight_text_list( $overrides['post_generate_checks'] ?? [], 220 ),
		'next_step'                  => sanitize_key( (string) ( $overrides['next_step'] ?? 'confirm_controlled_generate_after_preflight' ) ),
		'usage'                      => null,
	];
}

function factory_ai_generate_preflight_dependency_status(): array {
	$dependencies = function_exists( 'factory_rest_get_real_estate_dependency_status' )
		? factory_rest_get_real_estate_dependency_status()
		: [];
	$requirements = function_exists( 'factory_rest_build_real_estate_requirements_response' )
		? factory_rest_build_real_estate_requirements_response( $dependencies )
		: [ 'items' => [], 'ready' => false, 'summary' => 'Unable to verify requirements.' ];
	$required = [];
	$optional = [];
	$blocking = [];
	$warnings = [];

	foreach ( is_array( $requirements['items'] ?? null ) ? $requirements['items'] : [] as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$normalized = [
			'key'       => sanitize_key( (string) ( $item['key'] ?? '' ) ),
			'label'     => factory_ai_generate_preflight_clamp_text( $item['label'] ?? '', 120 ),
			'required'  => ! empty( $item['required'] ),
			'status'    => sanitize_key( (string) ( $item['status'] ?? 'unknown' ) ),
			'message'   => factory_ai_generate_preflight_clamp_text( $item['message'] ?? '', 220 ),
			'installed' => ! empty( $item['installed'] ),
			'active'    => ! empty( $item['active'] ),
		];

		if ( $normalized['required'] ) {
			$required[] = $normalized;

			if ( 'active' !== $normalized['status'] ) {
				$blocking[] = $normalized['label'] . ' is required before controlled generate.';
			}
		} else {
			$optional[] = $normalized;

			if ( 'optional_missing' === $normalized['status'] || 'warning' === $normalized['status'] ) {
				$warnings[] = $normalized['message'];
			}
		}
	}

	$site_factory_status = factory_ai_generate_preflight_site_factory_plugin_status();

	return [
		'ready'     => ! empty( $requirements['ready'] ) && empty( $blocking ),
		'summary'   => factory_ai_generate_preflight_clamp_text( $requirements['summary'] ?? 'Unable to verify requirements.', 220 ),
		'required'  => $required,
		'optional'  => $optional,
		'blocking'  => array_values( array_unique( factory_ai_generate_preflight_text_list( $blocking, 220 ) ) ),
		'warnings'  => array_values( array_unique( factory_ai_generate_preflight_text_list( $warnings, 220 ) ) ),
		'site_factory_plugin' => $site_factory_status,
	];
}

function factory_ai_generate_preflight_site_factory_plugin_status(): array {
	$plugin_file = defined( 'FACTORY_PLUGIN_FILE' ) ? plugin_basename( FACTORY_PLUGIN_FILE ) : 'crocoblock-site-factory/crocoblock-site-factory.php';
	$active = false;

	if ( function_exists( 'is_plugin_active' ) ) {
		$active = is_plugin_active( $plugin_file );
	} else {
		$active_plugins = (array) get_option( 'active_plugins', [] );
		$active = in_array( $plugin_file, $active_plugins, true );
	}

	return [
		'name'     => 'Site Factory plugin',
		'required' => true,
		'active'   => $active,
		'status'   => $active ? 'active' : 'warning',
		'note'     => $active
			? 'Site Factory plugin is active in the current runtime.'
			: 'Site Factory plugin should be active in the current runtime.',
	];
}

function factory_ai_generate_preflight_ownership_status( string $vertical, string $recommended_preset ): array {
	if ( 'real_estate' !== $vertical || 'real-estate' !== $recommended_preset ) {
		return [
			'status'              => 'warning',
			'blocking_conflicts'  => [
				'Ownership preflight currently supports the Real Estate preset path only.',
			],
			'notes'               => [
				'No read-only ownership check was performed for the requested vertical.',
			],
			'factory_managed_total' => 0,
			'user_modified_total' => 0,
			'locked_total'        => 0,
			'counts'              => [],
		];
	}

	$counts = [
		'pages_managed'          => factory_ai_generate_preflight_count_posts_by_meta( 'page', '_factory_managed', '1' ),
		'pages_user_modified'    => factory_ai_generate_preflight_count_posts_by_meta( 'page', '_factory_user_modified', '1' ),
		'pages_locked'           => factory_ai_generate_preflight_count_posts_by_meta_values( 'page', '_factory_lock', [ 'user_modified', 'user_owned', 'frozen', 'locked' ] ),
		'properties_managed'     => post_type_exists( 'property' ) ? factory_ai_generate_preflight_count_posts_by_meta( 'property', '_factory_managed', '1' ) : 0,
		'properties_user_modified' => post_type_exists( 'property' ) ? factory_ai_generate_preflight_count_posts_by_meta( 'property', '_factory_user_modified', '1' ) : 0,
		'properties_locked'      => post_type_exists( 'property' ) ? factory_ai_generate_preflight_count_posts_by_meta_values( 'property', '_factory_lock', [ 'user_modified', 'user_owned', 'frozen', 'locked' ] ) : 0,
	];

	$factory_managed_total = (int) $counts['pages_managed'] + (int) $counts['properties_managed'];
	$user_modified_total = (int) $counts['pages_user_modified'] + (int) $counts['properties_user_modified'];
	$locked_total = (int) $counts['pages_locked'] + (int) $counts['properties_locked'];
	$blocking_conflicts = [];
	$notes = [];
	$status = 'ok';

	if ( $user_modified_total > 0 ) {
		$blocking_conflicts[] = 'User-modified Factory-managed content was detected and should be reviewed before controlled generate.';
		$status = 'blocked';
	}

	if ( $locked_total > 0 ) {
		$blocking_conflicts[] = 'Locked or frozen Factory-managed content was detected and should be reviewed before controlled generate.';
		$status = 'blocked';
	}

	if ( 0 === $factory_managed_total ) {
		$notes[] = 'No Factory-managed pages or property posts were detected. This may be a first-run runtime.';

		if ( 'ok' === $status ) {
			$status = 'warning';
		}
	}

	$notes[] = 'Menu and taxonomy ownership should be checked again during final runtime preflight before apply.';

	return [
		'status'               => $status,
		'blocking_conflicts'   => array_values( array_unique( factory_ai_generate_preflight_text_list( $blocking_conflicts, 220 ) ) ),
		'notes'                => array_values( array_unique( factory_ai_generate_preflight_text_list( $notes, 220 ) ) ),
		'factory_managed_total'=> $factory_managed_total,
		'user_modified_total'  => $user_modified_total,
		'locked_total'         => $locked_total,
		'counts'               => $counts,
	];
}

function factory_ai_generate_preflight_runtime_snapshot( array $dependency_status ): array {
	$active_theme = wp_get_theme();
	$theme_label = null;

	if ( $active_theme && $active_theme->exists() ) {
		$theme_label = trim( $active_theme->get( 'Name' ) . ' (' . $active_theme->get_stylesheet() . ')' );
	}

	return [
		'pages'        => factory_ai_generate_preflight_post_type_count( 'page' ),
		'properties'   => post_type_exists( 'property' ) ? factory_ai_generate_preflight_post_type_count( 'property' ) : 0,
		'attachments'  => factory_ai_generate_preflight_post_type_count( 'attachment' ),
		'active_theme' => $theme_label,
		'plugins'      => [
			[
				'name'   => 'Site Factory plugin',
				'active' => ! empty( $dependency_status['site_factory_plugin']['active'] ),
			],
			[
				'name'   => 'JetEngine',
				'active' => ! empty( $dependency_status['required'][1]['active'] ),
			],
			[
				'name'   => 'JetSmartFilters',
				'active' => factory_ai_generate_preflight_find_optional_plugin_active( $dependency_status['optional'], 'jetsmartfilters' ),
			],
			[
				'name'   => 'JetFormBuilder',
				'active' => factory_ai_generate_preflight_find_optional_plugin_active( $dependency_status['optional'], 'jetformbuilder' ),
			],
		],
	];
}

function factory_ai_generate_preflight_dry_run_proof_preview( array $source_generate_gate, array $dependency_status, array $ownership_status ): array {
	$preview = is_array( $source_generate_gate['source_preview_diff'] ?? null ) ? $source_generate_gate['source_preview_diff'] : [];
	$diff_summary = is_array( $preview['diff_summary'] ?? null ) ? $preview['diff_summary'] : [];
	$page_targets = [];
	$entity_types = [];

	foreach ( is_array( $preview['create_preview'] ?? null ) ? $preview['create_preview'] : [] as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$type = sanitize_key( (string) ( $item['type'] ?? '' ) );
		$label = factory_ai_generate_preflight_clamp_text( $item['label'] ?? '', 120 );

		if ( 'page' === $type && '' !== $label ) {
			$page_targets[] = $label;
		}

		if ( '' !== $type ) {
			$entity_types[] = $type;
		}
	}

	return [
		'target_preset'                    => sanitize_key( (string) ( $source_generate_gate['recommended_preset'] ?? 'real-estate' ) ),
		'target_vertical'                  => factory_ai_generate_preflight_normalize_site_type( (string) ( $source_generate_gate['vertical'] ?? 'unknown' ) ),
		'planned_pages'                    => array_values( array_unique( $page_targets ) ),
		'planned_entity_types'             => array_values( array_unique( $entity_types ) ),
		'planned_summary'                  => [
			'creates'  => max( 0, (int) ( $diff_summary['creates'] ?? 0 ) ),
			'updates'  => max( 0, (int) ( $diff_summary['updates'] ?? 0 ) ),
			'skips'    => max( 0, (int) ( $diff_summary['skips'] ?? 0 ) ),
		],
		'dependency_checks'                => [
			'required_ready' => ! empty( $dependency_status['ready'] ),
			'blocking_count' => count( $dependency_status['blocking'] ?? [] ),
		],
		'ownership_checks'                 => [
			'status'            => sanitize_key( (string) ( $ownership_status['status'] ?? 'unknown' ) ),
			'blocking_conflicts'=> count( $ownership_status['blocking_conflicts'] ?? [] ),
		],
		'runtime_diff_required_before_apply' => true,
		'final_confirmation_required'      => true,
		'note'                             => 'This preflight summarizes what must be shown before controlled generate. A final runtime diff is still required immediately before apply.',
	];
}

function factory_ai_generate_preflight_blocking_reasons(
	array $source_generate_gate,
	array $dependency_status,
	array $ownership_status,
	string $vertical,
	string $recommended_preset
): array {
	$reasons = factory_ai_generate_preflight_text_list( $source_generate_gate['blocking_reasons'] ?? [], 220 );

	if ( 'real_estate' !== $vertical ) {
		$reasons[] = 'Controlled generate preflight currently supports the Real Estate vertical only.';
	}

	if ( 'real-estate' !== $recommended_preset ) {
		$reasons[] = 'The Real Estate preset is the only supported controlled generate target in v1.';
	}

	if ( empty( $source_generate_gate['can_generate'] ) ) {
		$reasons[] = 'Generate Gate does not currently allow controlled generate later.';
	}

	foreach ( factory_ai_generate_preflight_text_list( $dependency_status['blocking'] ?? [], 220 ) as $reason ) {
		$reasons[] = $reason;
	}

	foreach ( factory_ai_generate_preflight_text_list( $ownership_status['blocking_conflicts'] ?? [], 220 ) as $reason ) {
		$reasons[] = $reason;
	}

	return array_values( array_unique( $reasons ) );
}

function factory_ai_generate_preflight_normalize_generate_gate_source( $generate_gate ): array {
	if ( ! is_array( $generate_gate ) ) {
		return [];
	}

	return [
		'status'                     => sanitize_key( (string) ( $generate_gate['status'] ?? 'error' ) ),
		'code'                       => sanitize_key( (string) ( $generate_gate['code'] ?? '' ) ),
		'message'                    => factory_ai_generate_preflight_clamp_text( $generate_gate['message'] ?? '', 220 ),
		'vertical'                   => factory_ai_generate_preflight_normalize_site_type( (string) ( $generate_gate['vertical'] ?? 'unknown' ) ),
		'recommended_preset'         => sanitize_text_field( (string) ( $generate_gate['recommended_preset'] ?? '' ) ),
		'can_generate'               => ! empty( $generate_gate['can_generate'] ),
		'requires_user_confirmation' => ! empty( $generate_gate['requires_user_confirmation'] ),
		'confirmation_required_phrase' => factory_ai_generate_preflight_clamp_text( $generate_gate['confirmation_required_phrase'] ?? '', 80 ),
		'generation_target'          => is_array( $generate_gate['generation_target'] ?? null ) ? $generate_gate['generation_target'] : [],
		'source_preview_diff'        => factory_ai_generate_preflight_normalize_preview_diff_source( $generate_gate['source_preview_diff'] ?? [] ),
		'required_dependencies'      => is_array( $generate_gate['required_dependencies'] ?? null ) ? array_values( $generate_gate['required_dependencies'] ) : [],
		'optional_dependencies'      => is_array( $generate_gate['optional_dependencies'] ?? null ) ? array_values( $generate_gate['optional_dependencies'] ) : [],
		'ownership_checks'           => factory_ai_generate_preflight_text_list( $generate_gate['ownership_checks'] ?? [], 220 ),
		'preflight_checks'           => factory_ai_generate_preflight_text_list( $generate_gate['preflight_checks'] ?? [], 220 ),
		'blocking_reasons'           => factory_ai_generate_preflight_text_list( $generate_gate['blocking_reasons'] ?? [], 220 ),
		'warnings'                   => factory_ai_normalize_string_list( $generate_gate['warnings'] ?? [], 220 ),
		'risks'                      => factory_ai_generate_preflight_text_list( $generate_gate['risks'] ?? [], 220 ),
		'post_generate_checks'       => factory_ai_generate_preflight_text_list( $generate_gate['post_generate_checks'] ?? [], 220 ),
		'next_step'                  => sanitize_key( (string) ( $generate_gate['next_step'] ?? 'confirm_controlled_generate' ) ),
	];
}

function factory_ai_generate_preflight_normalize_dependency_status( $status ): array {
	if ( ! is_array( $status ) ) {
		$status = [];
	}

	return [
		'ready'     => ! empty( $status['ready'] ),
		'summary'   => factory_ai_generate_preflight_clamp_text( $status['summary'] ?? '', 220 ),
		'required'  => is_array( $status['required'] ?? null ) ? array_values( $status['required'] ) : [],
		'optional'  => is_array( $status['optional'] ?? null ) ? array_values( $status['optional'] ) : [],
		'blocking'  => factory_ai_generate_preflight_text_list( $status['blocking'] ?? [], 220 ),
		'warnings'  => factory_ai_generate_preflight_text_list( $status['warnings'] ?? [], 220 ),
		'site_factory_plugin' => is_array( $status['site_factory_plugin'] ?? null ) ? $status['site_factory_plugin'] : [],
	];
}

function factory_ai_generate_preflight_normalize_ownership_status( $status ): array {
	if ( ! is_array( $status ) ) {
		$status = [];
	}

	return [
		'status'               => sanitize_key( (string) ( $status['status'] ?? 'unknown' ) ),
		'blocking_conflicts'   => factory_ai_generate_preflight_text_list( $status['blocking_conflicts'] ?? [], 220 ),
		'notes'                => factory_ai_generate_preflight_text_list( $status['notes'] ?? [], 220 ),
		'factory_managed_total'=> max( 0, (int) ( $status['factory_managed_total'] ?? 0 ) ),
		'user_modified_total'  => max( 0, (int) ( $status['user_modified_total'] ?? 0 ) ),
		'locked_total'         => max( 0, (int) ( $status['locked_total'] ?? 0 ) ),
		'counts'               => is_array( $status['counts'] ?? null ) ? $status['counts'] : [],
	];
}

function factory_ai_generate_preflight_normalize_runtime_snapshot( $snapshot ): array {
	if ( ! is_array( $snapshot ) ) {
		$snapshot = [];
	}

	return [
		'pages'        => max( 0, (int) ( $snapshot['pages'] ?? 0 ) ),
		'properties'   => max( 0, (int) ( $snapshot['properties'] ?? 0 ) ),
		'attachments'  => max( 0, (int) ( $snapshot['attachments'] ?? 0 ) ),
		'active_theme' => factory_ai_generate_preflight_clamp_text( $snapshot['active_theme'] ?? '', 160 ),
		'plugins'      => is_array( $snapshot['plugins'] ?? null ) ? array_values( $snapshot['plugins'] ) : [],
	];
}

function factory_ai_generate_preflight_normalize_dry_run_preview( $preview ): array {
	if ( ! is_array( $preview ) ) {
		$preview = [];
	}

	return [
		'target_preset'                     => sanitize_key( (string) ( $preview['target_preset'] ?? 'real-estate' ) ),
		'target_vertical'                   => factory_ai_generate_preflight_normalize_site_type( (string) ( $preview['target_vertical'] ?? 'unknown' ) ),
		'planned_pages'                     => factory_ai_generate_preflight_text_list( $preview['planned_pages'] ?? [], 120 ),
		'planned_entity_types'              => factory_ai_generate_preflight_text_list( $preview['planned_entity_types'] ?? [], 80 ),
		'planned_summary'                   => is_array( $preview['planned_summary'] ?? null ) ? $preview['planned_summary'] : [],
		'dependency_checks'                 => is_array( $preview['dependency_checks'] ?? null ) ? $preview['dependency_checks'] : [],
		'ownership_checks'                  => is_array( $preview['ownership_checks'] ?? null ) ? $preview['ownership_checks'] : [],
		'runtime_diff_required_before_apply' => ! empty( $preview['runtime_diff_required_before_apply'] ),
		'final_confirmation_required'       => ! empty( $preview['final_confirmation_required'] ),
		'note'                              => factory_ai_generate_preflight_clamp_text( $preview['note'] ?? '', 220 ),
	];
}

function factory_ai_generate_preflight_normalize_preview_diff_source( $preview_diff ): array {
	if ( function_exists( 'factory_ai_generate_gate_normalize_preview_diff_source' ) ) {
		return factory_ai_generate_gate_normalize_preview_diff_source( $preview_diff );
	}

	return is_array( $preview_diff ) ? $preview_diff : [];
}

function factory_ai_generate_preflight_post_type_count( string $post_type ): int {
	if ( ! function_exists( 'wp_count_posts' ) ) {
		return 0;
	}

	$counts = wp_count_posts( $post_type );

	if ( ! is_object( $counts ) ) {
		return 0;
	}

	$total = 0;

	foreach ( get_object_vars( $counts ) as $count ) {
		$total += (int) $count;
	}

	return $total;
}

function factory_ai_generate_preflight_count_posts_by_meta( string $post_type, string $meta_key, string $meta_value ): int {
	if ( ! post_type_exists( $post_type ) ) {
		return 0;
	}

	$query = new WP_Query(
		[
			'post_type'              => $post_type,
			'post_status'            => 'any',
			'posts_per_page'         => 1,
			'fields'                 => 'ids',
			'no_found_rows'          => false,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
			'meta_key'               => $meta_key,
			'meta_value'             => $meta_value,
		]
	);

	return max( 0, (int) $query->found_posts );
}

function factory_ai_generate_preflight_count_posts_by_meta_values( string $post_type, string $meta_key, array $values ): int {
	if ( ! post_type_exists( $post_type ) ) {
		return 0;
	}

	$values = array_values(
		array_filter(
			array_map(
				static function ( $value ) {
					return sanitize_key( (string) $value );
				},
				$values
			)
		)
	);

	if ( empty( $values ) ) {
		return 0;
	}

	$query = new WP_Query(
		[
			'post_type'              => $post_type,
			'post_status'            => 'any',
			'posts_per_page'         => 1,
			'fields'                 => 'ids',
			'no_found_rows'          => false,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
			'meta_query'             => [
				[
					'key'     => $meta_key,
					'value'   => $values,
					'compare' => 'IN',
				],
			],
		]
	);

	return max( 0, (int) $query->found_posts );
}

function factory_ai_generate_preflight_find_optional_plugin_active( array $optional_dependencies, string $key ): bool {
	foreach ( $optional_dependencies as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$name = sanitize_key( str_replace( [ ' ', '-', '/' ], '_', strtolower( (string) ( $item['label'] ?? $item['name'] ?? '' ) ) ) );

		if ( false !== strpos( $name, $key ) ) {
			return ! empty( $item['active'] );
		}
	}

	return false;
}

function factory_ai_generate_preflight_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		$text = factory_ai_generate_preflight_clamp_text( $item, $max );

		if ( '' !== $text ) {
			$normalized[] = $text;
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_ai_generate_preflight_clamp_text( $value, int $max ): string {
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

function factory_ai_generate_preflight_normalize_context( array $context ): array {
	if ( function_exists( 'factory_ai_generate_gate_normalize_context' ) ) {
		return factory_ai_generate_gate_normalize_context( $context );
	}

	return $context;
}

function factory_ai_generate_preflight_normalize_site_type( string $site_type ): string {
	$site_type = sanitize_key( str_replace( '-', '_', $site_type ) );
	$allowed = [ 'real_estate', 'job_board', 'restaurant', 'clinic', 'auto', 'travel', 'marketplace', 'unknown' ];

	return in_array( $site_type, $allowed, true ) ? $site_type : 'unknown';
}
