<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_frontend_safe_edit_rest_routes' );

function factory_register_frontend_safe_edit_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/frontend-safe-edit/context',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_frontend_safe_edit_context',
			'permission_callback' => 'factory_frontend_safe_edit_require_manage_options_and_nonce',
		]
	);

	register_rest_route(
		'factory/v1',
		'/frontend-safe-edit/preview',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_frontend_safe_edit_preview',
			'permission_callback' => 'factory_frontend_safe_edit_require_manage_options_and_nonce',
		]
	);

	register_rest_route(
		'factory/v1',
		'/frontend-safe-edit/save',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_frontend_safe_edit_save',
			'permission_callback' => 'factory_frontend_safe_edit_require_manage_options_and_nonce',
		]
	);
}

function factory_frontend_safe_edit_require_manage_options_and_nonce( WP_REST_Request $request ) {
	$nonce = (string) $request->get_header( 'X-WP-Nonce' );
	$nonce = function_exists( 'wp_unslash' ) ? wp_unslash( $nonce ) : $nonce;
	$nonce = sanitize_text_field( $nonce );

	if ( '' === $nonce || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
		return new WP_Error(
			'factory_frontend_safe_edit_invalid_nonce',
			'Valid X-WP-Nonce header is required for frontend safe edit preview.',
			[ 'status' => 403 ]
		);
	}

	if ( ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'factory_frontend_safe_edit_forbidden',
			'Administrator access is required for frontend safe edit preview.',
			[ 'status' => 403 ]
		);
	}

	return true;
}

function factory_rest_frontend_safe_edit_context(): WP_REST_Response {
	$context = factory_frontend_safe_edit_collect_context();

	if ( is_wp_error( $context ) ) {
		return new WP_REST_Response(
			[
				'status'         => 'error',
				'code'           => $context->get_error_code(),
				'message'        => $context->get_error_message(),
				'applies_changes'=> false,
			],
			(int) ( $context->get_error_data()['status'] ?? 500 )
		);
	}

	return new WP_REST_Response(
		[
			'status'         => $context['can_edit'] ? 'ok' : 'warning',
			'code'           => $context['can_edit'] ? 'frontend_safe_edit_context_ready' : 'frontend_safe_edit_context_blocked',
			'message'        => $context['can_edit']
				? 'Frontend safe edit context is ready for preview.'
				: 'Frontend safe edit context is available, but ownership review is required before future save.',
			'applies_changes'=> false,
			'can_edit'       => $context['can_edit'],
			'blueprint_source' => $context['blueprint_source'],
			'safe_fields'    => $context['safe_fields'],
			'current_values' => $context['current_values'],
			'resolved_values'=> $context['resolved_values'],
			'ownership'      => $context['ownership'],
			'warnings'       => $context['warnings'],
		]
	);
}

function factory_rest_frontend_safe_edit_preview( WP_REST_Request $request ): WP_REST_Response {
	$context = factory_frontend_safe_edit_collect_context();

	if ( is_wp_error( $context ) ) {
		return new WP_REST_Response(
			[
				'status'         => 'error',
				'code'           => $context->get_error_code(),
				'message'        => $context->get_error_message(),
				'applies_changes'=> false,
			],
			(int) ( $context->get_error_data()['status'] ?? 500 )
		);
	}

	if ( ! $context['can_edit'] ) {
		$warnings = $context['warnings'];
		$warnings[] = 'Frontend safe edit preview is blocked until Home, Properties, and Contact ownership state is safe.';

		return new WP_REST_Response(
			[
				'status'           => 'blocked',
				'code'             => 'frontend_safe_edit_preview_blocked',
				'message'          => 'Frontend safe edit preview is blocked by ownership state. No site changes were made.',
				'applies_changes'  => false,
				'can_edit'         => false,
				'blueprint_source' => $context['blueprint_source'],
				'safe_fields'      => $context['safe_fields'],
				'current_values'   => $context['current_values'],
				'resolved_values'  => $context['resolved_values'],
				'ownership'        => $context['ownership'],
				'warnings'         => array_values( array_unique( $warnings ) ),
			],
			409
		);
	}

	$received = $request->get_param( 'safe_values' );
	$normalized = factory_frontend_safe_edit_normalize_preview_values(
		is_array( $received ) ? $received : [],
		$context['current_values'],
		$context['safe_fields']
	);
	$warnings = $context['warnings'];

	if ( ! empty( $normalized['invalid_fields'] ) ) {
		return new WP_REST_Response(
			[
				'status'           => 'blocked',
				'code'             => 'frontend_safe_edit_invalid_preview_values',
				'message'          => 'Frontend safe edit preview rejected invalid field values. No site changes were made.',
				'applies_changes'  => false,
				'can_edit'         => $context['can_edit'],
				'blueprint_source' => $context['blueprint_source'],
				'safe_fields'      => $context['safe_fields'],
				'current_values'   => $context['current_values'],
				'resolved_values'  => $context['resolved_values'],
				'invalid_fields'   => $normalized['invalid_fields'],
				'ownership'        => $context['ownership'],
				'warnings'         => array_values( array_unique( $warnings ) ),
			],
			400
		);
	}

	$diff_summary = factory_frontend_safe_edit_build_diff_summary(
		$context['current_values'],
		$normalized['values']
	);
	$resolved_values = factory_frontend_safe_edit_build_resolved_values(
		$context['current_values'],
		$normalized['values'],
		$context['blueprint']
	);

	if ( ! empty( $normalized['ignored_fields'] ) ) {
		$warnings[] = 'Unsupported fields were ignored: ' . implode( ', ', $normalized['ignored_fields'] ) . '.';
	}

	if ( ! $context['can_edit'] ) {
		$warnings[] = 'Ownership review is still required before a future save can be allowed.';
	}

	return new WP_REST_Response(
		[
			'status'           => ! $context['can_edit'] || ! empty( $normalized['ignored_fields'] ) ? 'warning' : 'ok',
			'code'             => 'frontend_safe_edit_preview_ready',
			'message'          => 'Frontend safe edit preview is ready. No site changes were made.',
			'applies_changes'  => false,
			'can_edit'         => $context['can_edit'],
			'blueprint_source' => $context['blueprint_source'],
			'safe_fields'      => $context['safe_fields'],
			'current_values'   => $context['current_values'],
			'preview_values'   => $normalized['values'],
			'resolved_values'  => $resolved_values,
			'normalized_values'=> $normalized['values'],
			'ignored_fields'   => $normalized['ignored_fields'],
			'diff_summary'     => $diff_summary,
			'ownership'        => $context['ownership'],
			'warnings'         => array_values( array_unique( $warnings ) ),
		]
	);
}

function factory_rest_frontend_safe_edit_save( WP_REST_Request $request ): WP_REST_Response {
	$context = factory_frontend_safe_edit_collect_save_context();

	if ( is_wp_error( $context ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'blocked',
				'code'            => $context->get_error_code(),
				'message'         => $context->get_error_message(),
				'applies_changes' => false,
				'source'          => 'frontend_safe_edit',
			],
			(int) ( $context->get_error_data()['status'] ?? 409 )
		);
	}

	$ownership = $context['ownership'];

	if ( ! empty( $ownership['blocked'] ) ) {
		return new WP_REST_Response(
			[
				'status'           => 'blocked',
				'code'             => 'frontend_safe_edit_ownership_blocked',
				'message'          => 'Frontend safe edit save is blocked by current ownership state. No site changes were made.',
				'applies_changes'  => false,
				'source'           => 'frontend_safe_edit',
				'blocking_reasons' => array_values( array_unique( $ownership['blocking_reasons'] ?? [] ) ),
				'ownership'        => $ownership,
				'current_values'   => $context['current_values'],
				'next_step'        => 'review_ownership_state',
			],
			409
		);
	}

	$safe_values     = $request->get_param( 'safe_values' );
	$expected_values = $request->get_param( 'expected_values' );
	$client_context  = $request->get_param( 'client_context' );
	$strict_errors   = factory_frontend_safe_edit_validate_save_fields(
		is_array( $safe_values ) ? $safe_values : [],
		is_array( $expected_values ) ? $expected_values : []
	);

	if ( ! empty( $strict_errors ) ) {
		return new WP_REST_Response(
			[
				'status'             => 'blocked',
				'code'               => 'frontend_safe_edit_unsupported_fields',
				'message'            => 'Frontend safe edit save rejected unsupported fields. No site changes were made.',
				'applies_changes'    => false,
				'source'             => 'frontend_safe_edit',
				'unsupported_fields' => $strict_errors,
				'current_values'     => $context['current_values'],
				'ownership'          => $ownership,
			],
			400
		);
	}

	$normalized_safe_values = factory_frontend_safe_edit_normalize_save_values(
		is_array( $safe_values ) ? $safe_values : [],
		$context['current_values']
	);
	$before_resolved_values = factory_frontend_safe_edit_build_save_resolved_values(
		$context['current_values'],
		$context['blueprint']
	);

	if ( ! empty( $normalized_safe_values['invalid_fields'] ) ) {
		return new WP_REST_Response(
			[
				'status'                 => 'blocked',
				'code'                   => 'frontend_safe_edit_invalid_save_values',
				'message'                => 'Frontend safe edit save rejected invalid field values. No site changes were made.',
				'applies_changes'        => false,
				'source'                 => 'frontend_safe_edit',
				'invalid_fields'         => $normalized_safe_values['invalid_fields'],
				'before_values'          => $context['current_values'],
				'after_values'           => $context['current_values'],
				'before_resolved_values' => $before_resolved_values,
				'after_resolved_values'  => $before_resolved_values,
				'ownership'              => $ownership,
				'client_context'         => is_array( $client_context ) ? $client_context : [],
				'next_step'              => 'correct_invalid_safe_values',
			],
			400
		);
	}

	$requested_resolved_values = factory_frontend_safe_edit_build_save_resolved_values(
		$normalized_safe_values['values'],
		$context['blueprint']
	);
	$normalized_expected_values = factory_frontend_safe_edit_normalize_expected_values(
		is_array( $expected_values ) ? $expected_values : []
	);
	$conflicts = factory_frontend_safe_edit_find_save_conflicts(
		$normalized_safe_values['submitted_fields'],
		$normalized_expected_values,
		$context['current_values']
	);

	if ( ! empty( $conflicts ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'blocked',
				'code'            => 'frontend_safe_edit_conflict',
				'message'         => 'Frontend safe edit save is blocked because current server values no longer match the expected values.',
				'applies_changes' => false,
				'source'          => 'frontend_safe_edit',
				'conflict_fields' => $conflicts,
				'current_values'  => $context['current_values'],
				'expected_values' => $normalized_expected_values,
				'before_resolved_values' => $before_resolved_values,
				'after_resolved_values'  => $requested_resolved_values,
				'ownership'       => $ownership,
				'client_context'  => is_array( $client_context ) ? $client_context : [],
				'next_step'       => 'refresh_frontend_safe_edit_context',
			],
			409
		);
	}

	$diff_summary = factory_frontend_safe_edit_build_diff_summary(
		$context['current_values'],
		$normalized_safe_values['values']
	);
	$changed_fields = array_map(
		static function ( array $item ): string {
			return (string) ( $item['field'] ?? '' );
		},
		$diff_summary['changed_fields'] ?? []
	);
	$changed_fields = array_values( array_filter( array_unique( $changed_fields ) ) );

	if ( empty( $changed_fields ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'ok',
				'code'            => 'frontend_safe_edit_no_changes',
				'message'         => 'Frontend safe edit save found no changed safe values. No site changes were made.',
				'applies_changes' => false,
				'source'          => 'frontend_safe_edit',
				'changed_fields'  => [],
				'before_values'   => $context['current_values'],
				'after_values'    => $context['current_values'],
				'before_resolved_values' => $before_resolved_values,
				'after_resolved_values'  => $before_resolved_values,
				'ignored_fields'  => [],
				'ownership'       => $ownership,
			]
		);
	}

	$mutable_fields = factory_frontend_safe_edit_mutable_save_fields();
	$unsupported_for_save = array_values(
		array_diff(
			$changed_fields,
			$mutable_fields
		)
	);

	if ( ! empty( $unsupported_for_save ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'blocked',
				'code'            => 'frontend_safe_edit_save_not_enabled',
				'message'         => 'Frontend safe edit save is only enabled for Hero title, Hero subtitle, Hero CTA text, and Hero CTA destination in this beta. No site changes were made.',
				'applies_changes' => false,
				'source'          => 'frontend_safe_edit',
				'changed_fields'  => $changed_fields,
				'before_values'   => $context['current_values'],
				'after_values'    => $normalized_safe_values['values'],
				'before_resolved_values' => $before_resolved_values,
				'after_resolved_values'  => $requested_resolved_values,
				'ignored_fields'  => [],
				'ownership'       => $ownership,
				'client_context'  => is_array( $client_context ) ? $client_context : [],
				'next_step'       => 'hero_copy_and_cta_destination_beta',
			],
			501
		);
	}

	$prepared_blueprint = $context['blueprint'];
	$destination_preflight = null;

	if ( in_array( 'hero_cta_destination', $changed_fields, true ) ) {
		$destination_preflight = factory_frontend_safe_edit_get_destination_preflight(
			$context['blueprint'],
			(string) ( $normalized_safe_values['values']['hero_cta_destination'] ?? '' )
		);

		if ( ! empty( $destination_preflight['blocked'] ) ) {
			return new WP_REST_Response(
				[
					'status'                 => 'blocked',
					'code'                   => 'frontend_safe_edit_destination_ownership_blocked',
					'message'                => 'Frontend safe edit save is blocked because the requested CTA destination is not currently Factory-managed and safe to target.',
					'applies_changes'        => false,
					'source'                 => 'frontend_safe_edit',
					'changed_fields'         => $changed_fields,
					'before_values'          => $context['current_values'],
					'after_values'           => $normalized_safe_values['values'],
					'before_resolved_values' => $before_resolved_values,
					'after_resolved_values'  => $requested_resolved_values,
					'ownership'              => $ownership,
					'destination_preflight'  => $destination_preflight,
					'client_context'         => is_array( $client_context ) ? $client_context : [],
					'next_step'              => 'review_destination_ownership',
				],
				409
			);
		}

		$prepared_blueprint = factory_frontend_safe_edit_apply_hero_cta_destination_to_blueprint(
			$prepared_blueprint,
			(string) ( $normalized_safe_values['values']['hero_cta_destination'] ?? '' )
		);
	}

	$runtime_snapshot_before = factory_frontend_safe_edit_capture_runtime_snapshot();
	$style_context           = factory_frontend_safe_edit_extract_style_context( $prepared_blueprint );
	$image_context           = factory_frontend_safe_edit_extract_image_context( $prepared_blueprint );
	$overlay_variables       = $context['current_values'];

	foreach ( $mutable_fields as $field ) {
		if ( array_key_exists( $field, $normalized_safe_values['values'] ) ) {
			$overlay_variables[ $field ] = $normalized_safe_values['values'][ $field ];
		}
	}

	$changed_field_proof = [];

	foreach ( $changed_fields as $field ) {
		$changed_field_proof[ $field ] = [
			'before_value' => (string) ( $context['current_values'][ $field ] ?? '' ),
			'after_value'  => 'hero_cta_destination' === $field
				? (string) ( $normalized_safe_values['values'][ $field ] ?? '' )
				: (string) ( $overlay_variables[ $field ] ?? '' ),
		];
	}

	$apply_args = [
		'source'         => 'frontend_safe_edit',
		'base_blueprint' => $prepared_blueprint,
		'prompt_context' => [
			'prompt'            => 'Frontend safe edit save: ' . implode( ',', $changed_fields ),
			'preset_variables'  => $overlay_variables,
			'applied_variables' => $overlay_variables,
			'notes'             => [
				'Frontend safe edit save uses the stored Factory blueprint as the base.',
				'Only the hero_title, hero_subtitle, hero_cta_text, and hero_cta_destination safe fields are allowed to persist in this beta save flow.',
				'Hero CTA destination updates the stored Home hero cta_url in the base blueprint before the deterministic apply service runs.',
				'Generated pages are refreshed through the deterministic Real Estate apply service.',
			],
		],
		'style_context'  => $style_context,
		'image_context'  => $image_context,
		'manifest_metadata' => [
			'frontend_safe_edit' => [
				'fields' => $changed_field_proof,
			],
		],
	];

	$apply_boundary_started = false;

	try {
		$apply_boundary_started = true;
		$apply_result           = factory_apply_real_estate_preset_internal( $apply_args );
	} catch ( Throwable $e ) {
		return new WP_REST_Response(
			[
				'status'                  => 'error',
				'code'                    => 'frontend_safe_edit_save_failed_after_apply_started',
				'message'                 => 'Frontend safe edit save failed after entering the apply boundary. Partial mutation may have occurred.',
				'applies_changes'         => true,
				'source'                  => 'frontend_safe_edit',
				'changed_fields'          => $changed_fields,
				'before_values'           => $context['current_values'],
				'after_values'            => $normalized_safe_values['values'],
				'before_resolved_values'  => $before_resolved_values,
				'after_resolved_values'   => $requested_resolved_values,
				'ignored_fields'          => [],
				'ownership_before'        => $ownership,
				'destination_preflight'   => $destination_preflight,
				'runtime_snapshot_before' => $runtime_snapshot_before,
				'mutation_status'         => $apply_boundary_started ? 'unknown_after_apply_started' : 'not_started',
				'next_step'               => 'review_updated_frontend',
				'risks'                   => [
					'Partial mutation may have occurred after the deterministic apply path started.',
					'Run validation/doctor and review the latest proof before further changes.',
				],
			],
			500
		);
	}

	if ( empty( $apply_result['ok'] ) ) {
		return new WP_REST_Response(
			[
				'status'                  => 'blocked',
				'code'                    => sanitize_key( (string) ( $apply_result['error_code'] ?? 'frontend_safe_edit_apply_failed' ) ),
				'message'                 => (string) ( $apply_result['error_message'] ?? 'Frontend safe edit save could not apply the deterministic Real Estate refresh.' ),
				'applies_changes'         => false,
				'source'                  => 'frontend_safe_edit',
				'changed_fields'          => $changed_fields,
				'before_values'           => $context['current_values'],
				'after_values'            => $normalized_safe_values['values'],
				'before_resolved_values'  => $before_resolved_values,
				'after_resolved_values'   => $requested_resolved_values,
				'ignored_fields'          => [],
				'ownership_before'        => $ownership,
				'destination_preflight'   => $destination_preflight,
				'runtime_snapshot_before' => $runtime_snapshot_before,
				'dependencies'            => is_array( $apply_result['dependencies'] ?? null ) ? $apply_result['dependencies'] : [],
				'next_step'               => 'review_updated_frontend',
			],
			max( 400, (int) ( $apply_result['http_status'] ?? 409 ) )
		);
	}

	$updated_blueprint_context = factory_frontend_safe_edit_collect_save_context();
	$updated_current_values    = is_wp_error( $updated_blueprint_context )
		? factory_frontend_safe_edit_get_current_values( is_array( $apply_result['blueprint'] ?? null ) ? $apply_result['blueprint'] : $prepared_blueprint )
		: $updated_blueprint_context['current_values'];
	$ownership_after          = is_wp_error( $updated_blueprint_context )
		? $ownership
		: $updated_blueprint_context['ownership'];
	$updated_resolved_values  = is_wp_error( $updated_blueprint_context )
		? factory_frontend_safe_edit_build_save_resolved_values(
			$updated_current_values,
			is_array( $apply_result['blueprint'] ?? null ) ? $apply_result['blueprint'] : $prepared_blueprint
		)
		: factory_frontend_safe_edit_flatten_resolved_values(
			is_array( $updated_blueprint_context['resolved_values'] ?? null ) ? $updated_blueprint_context['resolved_values'] : []
		);
	$runtime_snapshot_after   = factory_frontend_safe_edit_capture_runtime_snapshot();
	$apply_response           = is_array( $apply_result['response'] ?? null ) ? $apply_result['response'] : [];
	$saved_field_labels       = factory_frontend_safe_edit_describe_fields( $changed_fields );

	return new WP_REST_Response(
		[
			'status'                  => 'ok',
			'code'                    => 'frontend_safe_edit_saved',
			'message'                 => sprintf( 'Frontend safe edit save for %s was applied through the controlled Factory path.', $saved_field_labels ),
			'applies_changes'         => true,
			'source'                  => 'frontend_safe_edit',
			'changed_fields'          => $changed_fields,
			'before_values'           => $context['current_values'],
			'after_values'            => $updated_current_values,
			'before_resolved_values'  => $before_resolved_values,
			'after_resolved_values'   => $updated_resolved_values,
			'ignored_fields'          => [],
			'ownership_before'        => $ownership,
			'ownership_after'         => $ownership_after,
			'destination_preflight'   => $destination_preflight,
			'runtime_snapshot_before' => $runtime_snapshot_before,
			'runtime_snapshot_after'  => $runtime_snapshot_after,
			'execution_count'         => isset( $apply_response['execution_count'] ) ? (int) $apply_response['execution_count'] : count( $apply_result['execution'] ?? [] ),
			'validation_count'        => isset( $apply_response['validation_count'] ) ? (int) $apply_response['validation_count'] : count( $apply_result['report']['checks'] ?? [] ),
			'results_summary'         => is_array( $apply_response['results_summary'] ?? null ) ? $apply_response['results_summary'] : ( is_array( $apply_result['results']['summary'] ?? null ) ? $apply_result['results']['summary'] : [] ),
			'manifest_file'           => ! empty( $apply_result['manifest_path'] ) ? basename( (string) $apply_result['manifest_path'] ) : '',
			'next_step'               => 'review_updated_frontend',
		]
	);
}

function factory_frontend_safe_edit_collect_context() {
	$record = factory_frontend_safe_edit_get_authoritative_blueprint_record();

	if ( is_wp_error( $record ) ) {
		return $record;
	}

	$blueprint = $record['blueprint'];
	$field_bundle = factory_frontend_safe_edit_build_field_bundle( $blueprint );
	$current_values = $field_bundle['current_values'];
	$ownership = factory_frontend_safe_edit_get_ownership_summary( $blueprint );
	$warnings = $field_bundle['warnings'];
	$can_edit = ! $ownership['blocked'] && 'stored_blueprint' === $record['source'];

	if ( 'stored_blueprint' !== $record['source'] ) {
		$warnings[] = 'Stored Factory blueprint is unavailable; preview uses the bundled preset fallback.';
	}

	return [
		'can_edit'        => $can_edit,
		'blueprint_source'=> $record['source'],
		'blueprint'       => $blueprint,
		'safe_fields'     => $field_bundle['safe_fields'],
		'current_values'  => $current_values,
		'resolved_values' => $field_bundle['resolved_values'],
		'ownership'       => $ownership,
		'warnings'        => array_values( array_unique( $warnings ) ),
	];
}

function factory_frontend_safe_edit_collect_save_context() {
	$record = factory_frontend_safe_edit_get_stored_blueprint_record();

	if ( is_wp_error( $record ) ) {
		return $record;
	}

	$blueprint = $record['blueprint'];
	$field_bundle = factory_frontend_safe_edit_build_field_bundle( $blueprint );

	return [
		'source'         => 'frontend_safe_edit',
		'blueprint'      => $blueprint,
		'blueprint_source' => $record['source'],
		'current_values' => $field_bundle['current_values'],
		'resolved_values' => $field_bundle['resolved_values'],
		'ownership'      => factory_frontend_safe_edit_get_ownership_summary( $blueprint ),
		'safe_fields'    => $field_bundle['safe_fields'],
		'warnings'       => $field_bundle['warnings'],
	];
}

function factory_frontend_safe_edit_is_request_allowed(): bool {
	$context = factory_frontend_safe_edit_collect_context();

	return ! is_wp_error( $context ) && ! empty( $context['can_edit'] );
}

function factory_frontend_safe_edit_get_authoritative_blueprint_record() {
	$stored = get_option( FACTORY_BLUEPRINT_OPTION );

	if ( is_array( $stored ) && ! empty( $stored ) ) {
		return [
			'source'    => 'stored_blueprint',
			'blueprint' => $stored,
		];
	}

	$fallback = factory_get_blueprint();

	if ( is_array( $fallback ) && ! empty( $fallback ) ) {
		return [
			'source'    => 'preset_fallback',
			'blueprint' => $fallback,
		];
	}

	return new WP_Error(
		'factory_frontend_safe_edit_missing_blueprint',
		'Factory blueprint is unavailable for frontend safe edit preview.',
		[ 'status' => 409 ]
	);
}

function factory_frontend_safe_edit_get_stored_blueprint_record() {
	$stored = get_option( FACTORY_BLUEPRINT_OPTION );

	if ( is_array( $stored ) && ! empty( $stored ) ) {
		return [
			'source'    => 'stored_blueprint',
			'blueprint' => $stored,
		];
	}

	return new WP_Error(
		'frontend_safe_edit_missing_stored_blueprint',
		'Frontend safe edit save requires a stored Factory blueprint. No preset fallback is allowed for save.',
		[ 'status' => 409 ]
	);
}

function factory_frontend_safe_edit_field_schema(): array {
	$schema = factory_rest_get_real_estate_variable_schema();
	$labels = [
		'agency_name'   => 'Agency name',
		'hero_title'    => 'Hero title',
		'hero_subtitle' => 'Hero subtitle',
		'hero_cta_text' => 'Hero CTA text',
		'contact_title' => 'Contact title',
		'contact_intro' => 'Contact intro',
		'phone'         => 'Phone',
		'email'         => 'Email',
	];

	foreach ( $schema as $key => $item ) {
		$schema[ $key ]['label'] = $labels[ $key ] ?? ucwords( str_replace( '_', ' ', $key ) );
	}

	$schema['hero_cta_destination'] = [
		'max'       => 24,
		'sanitizer' => 'text',
		'label'     => 'Hero CTA destination',
		'control'   => 'select',
		'options'   => factory_frontend_safe_edit_destination_options(),
	];

	return $schema;
}

function factory_frontend_safe_edit_get_current_values( array $blueprint ): array {
	$field_bundle = factory_frontend_safe_edit_build_field_bundle( $blueprint );

	return $field_bundle['current_values'];
}

function factory_frontend_safe_edit_get_ownership_summary( array $blueprint ): array {
	$pages = [
		'home'     => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'home' ),
		'archive'  => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'archive' ),
		'contact'  => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'contact' ),
	];
	$blocking_reasons = [];

	foreach ( $pages as $page ) {
		foreach ( $page['blocking_reasons'] as $reason ) {
			$blocking_reasons[] = $reason;
		}
	}

	return [
		'status'           => empty( $blocking_reasons ) ? 'ok' : 'blocked',
		'blocked'          => ! empty( $blocking_reasons ),
		'blocking_reasons' => array_values( array_unique( $blocking_reasons ) ),
		'pages'            => $pages,
	];
}

function factory_frontend_safe_edit_get_page_ownership( array $blueprint, string $page_key ): array {
	$page = is_array( $blueprint['pages'][ $page_key ] ?? null ) ? $blueprint['pages'][ $page_key ] : [];
	$slug = is_string( $page['slug'] ?? null ) ? $page['slug'] : '';
	$post = '' !== $slug ? get_page_by_path( $slug ) : null;
	$blocking_reasons = [];
	$page_label = factory_frontend_safe_edit_get_page_label( $page_key );

	if ( ! $post instanceof WP_Post ) {
		$blocking_reasons[] = $page_label . ' page is missing.';

		return [
			'page_key'         => $page_key,
			'slug'             => $slug,
			'page_id'          => 0,
			'exists'           => false,
			'managed'          => false,
			'lock'             => 'missing',
			'user_modified'    => false,
			'last_generated'   => false,
			'blocked'          => true,
			'blocking_reasons' => $blocking_reasons,
		];
	}

	$managed = '1' === (string) get_post_meta( $post->ID, '_factory_managed', true );
	$lock = sanitize_key( (string) get_post_meta( $post->ID, '_factory_lock', true ) );
	$user_modified = '1' === (string) get_post_meta( $post->ID, '_factory_user_modified', true );
	$last_generated = '' !== (string) get_post_meta( $post->ID, '_factory_last_generated_hash', true );

	if ( ! $managed ) {
		$blocking_reasons[] = $page_label . ' page is not marked as Factory-managed.';
	}

	if ( $user_modified ) {
		$blocking_reasons[] = $page_label . ' page is marked as user-modified.';
	}

	if ( in_array( $lock, [ 'user_modified', 'user_owned', 'frozen', 'locked' ], true ) ) {
		$blocking_reasons[] = $page_label . ' page lock is ' . $lock . '.';
	}

	return [
		'page_key'         => $page_key,
		'slug'             => $slug,
		'page_id'          => (int) $post->ID,
		'exists'           => true,
		'managed'          => $managed,
		'lock'             => '' !== $lock ? $lock : 'unknown',
		'user_modified'    => $user_modified,
		'last_generated'   => $last_generated,
		'blocked'          => ! empty( $blocking_reasons ),
		'blocking_reasons' => $blocking_reasons,
	];
}

function factory_frontend_safe_edit_get_page_label( string $page_key ): string {
	switch ( $page_key ) {
		case 'archive':
			return 'Properties';
		case 'contact':
			return 'Contact';
		case 'home':
			return 'Home';
		default:
			return ucwords( str_replace( '_', ' ', $page_key ) );
	}
}

function factory_frontend_safe_edit_normalize_preview_values( array $received, array $current_values, array $safe_fields ): array {
	$schema = $safe_fields;
	$values = [];
	$ignored_fields = [];
	$invalid_fields = [];

	foreach ( $received as $key => $value ) {
		if ( ! isset( $schema[ $key ] ) ) {
			$ignored_fields[] = sanitize_key( (string) $key );
		}
	}

	foreach ( $schema as $key => $item ) {
		if ( array_key_exists( $key, $received ) ) {
			$normalized = factory_frontend_safe_edit_normalize_field_value(
				$key,
				$received[ $key ],
				$item,
				$current_values
			);

			if ( isset( $normalized['error'] ) ) {
				$invalid_fields[ $key ] = (string) $normalized['error'];
				$values[ $key ] = (string) ( $current_values[ $key ] ?? '' );
				continue;
			}

			$values[ $key ] = (string) $normalized['value'];
			continue;
		}

		$values[ $key ] = (string) ( $current_values[ $key ] ?? '' );
	}

	return [
		'values'         => $values,
		'ignored_fields' => array_values( array_unique( array_filter( $ignored_fields ) ) ),
		'invalid_fields' => $invalid_fields,
	];
}

function factory_frontend_safe_edit_validate_save_fields( array $safe_values, array $expected_values ): array {
	$schema = factory_frontend_safe_edit_field_schema();
	$unsupported = [];

	foreach ( $safe_values as $key => $unused_value ) {
		if ( ! isset( $schema[ $key ] ) ) {
			$unsupported[] = sanitize_key( (string) $key );
		}
	}

	foreach ( $expected_values as $key => $unused_value ) {
		if ( ! isset( $schema[ $key ] ) ) {
			$unsupported[] = sanitize_key( (string) $key );
		}
	}

	return array_values( array_unique( array_filter( $unsupported ) ) );
}

function factory_frontend_safe_edit_normalize_save_values( array $received, array $current_values ): array {
	$schema = factory_frontend_safe_edit_field_schema();
	$values = $current_values;
	$submitted_fields = [];
	$invalid_fields = [];

	foreach ( $schema as $key => $item ) {
		if ( ! array_key_exists( $key, $received ) ) {
			continue;
		}

		$normalized = factory_frontend_safe_edit_normalize_field_value(
			$key,
			$received[ $key ],
			$item,
			$current_values
		);

		if ( isset( $normalized['error'] ) ) {
			$invalid_fields[ $key ] = (string) $normalized['error'];
		}

		$values[ $key ] = (string) ( $normalized['value'] ?? '' );
		$submitted_fields[] = $key;
	}

	return [
		'values'           => $values,
		'submitted_fields' => array_values( array_unique( $submitted_fields ) ),
		'invalid_fields'   => $invalid_fields,
	];
}

function factory_frontend_safe_edit_normalize_expected_values( array $expected_values ): array {
	$schema = factory_frontend_safe_edit_field_schema();
	$normalized = [];

	foreach ( $schema as $key => $item ) {
		if ( ! array_key_exists( $key, $expected_values ) ) {
			continue;
		}

		$value = factory_frontend_safe_edit_normalize_field_value(
			$key,
			$expected_values[ $key ],
			$item,
			[]
		);
		$normalized[ $key ] = (string) ( $value['value'] ?? '' );
	}

	return $normalized;
}

function factory_frontend_safe_edit_find_save_conflicts( array $submitted_fields, array $expected_values, array $current_values ): array {
	$conflicts = [];

	foreach ( $submitted_fields as $field ) {
		$expected = array_key_exists( $field, $expected_values )
			? (string) $expected_values[ $field ]
			: null;
		$current = (string) ( $current_values[ $field ] ?? '' );

		if ( null === $expected ) {
			$conflicts[] = $field;
			continue;
		}

		if ( $expected !== $current ) {
			$conflicts[] = $field;
		}
	}

	return array_values( array_unique( $conflicts ) );
}

function factory_frontend_safe_edit_build_diff_summary( array $current_values, array $preview_values ): array {
	$changed = [];

	foreach ( factory_frontend_safe_edit_field_schema() as $key => $schema ) {
		$current = (string) ( $current_values[ $key ] ?? '' );
		$preview = (string) ( $preview_values[ $key ] ?? '' );

		if ( $current === $preview ) {
			continue;
		}

		$changed[] = [
			'field'   => $key,
			'label'   => (string) ( $schema['label'] ?? $key ),
			'current' => $current,
			'preview' => $preview,
		];
	}

	return [
		'changed_count'   => count( $changed ),
		'unchanged_count' => count( factory_frontend_safe_edit_field_schema() ) - count( $changed ),
		'changed_fields'  => $changed,
	];
}

function factory_frontend_safe_edit_mutable_save_fields(): array {
	return [ 'hero_title', 'hero_subtitle', 'hero_cta_text', 'hero_cta_destination' ];
}

function factory_frontend_safe_edit_build_field_bundle( array $blueprint ): array {
	$safe_fields = factory_frontend_safe_edit_field_schema();
	$defaults = factory_rest_get_real_estate_variable_defaults( $blueprint );
	$current_values = [];

	foreach ( $safe_fields as $key => $schema ) {
		if ( 'hero_cta_destination' === $key ) {
			continue;
		}

		$current_values[ $key ] = factory_rest_sanitize_preset_variable( $defaults[ $key ] ?? '', $schema );
	}

	$destination_state = factory_frontend_safe_edit_get_hero_cta_destination_state( $blueprint );
	$current_values['hero_cta_destination'] = $destination_state['blocked'] ? '' : $destination_state['value'];
	$safe_fields['hero_cta_destination']['readonly'] = ! empty( $destination_state['blocked'] );
	$safe_fields['hero_cta_destination']['blocked'] = ! empty( $destination_state['blocked'] );

	if ( ! empty( $destination_state['blocking_reason'] ) ) {
		$safe_fields['hero_cta_destination']['blocking_reason'] = (string) $destination_state['blocking_reason'];
	}

	return [
		'safe_fields' => $safe_fields,
		'current_values' => $current_values,
		'resolved_values' => factory_frontend_safe_edit_build_resolved_values( $current_values, $current_values, $blueprint ),
		'warnings' => ! empty( $destination_state['blocking_reason'] )
			? [ (string) $destination_state['blocking_reason'] ]
			: [],
	];
}

function factory_frontend_safe_edit_destination_options(): array {
	return [
		[
			'value' => 'home',
			'label' => 'Home',
		],
		[
			'value' => 'properties',
			'label' => 'Properties',
		],
		[
			'value' => 'contact',
			'label' => 'Contact',
		],
	];
}

function factory_frontend_safe_edit_build_resolved_values( array $current_values, array $preview_values, array $blueprint ): array {
	$targets = factory_frontend_safe_edit_get_destination_targets( $blueprint );
	$current_destination = (string) ( $current_values['hero_cta_destination'] ?? '' );
	$preview_destination = (string) ( $preview_values['hero_cta_destination'] ?? '' );
	$current_href = isset( $targets[ $current_destination ]['href'] ) ? (string) $targets[ $current_destination ]['href'] : '';
	$preview_href = isset( $targets[ $preview_destination ]['href'] ) ? (string) $targets[ $preview_destination ]['href'] : '';

	return [
		'hero_cta_destination' => [
			'current' => $current_href,
			'preview' => $preview_href,
		],
	];
}

function factory_frontend_safe_edit_build_save_resolved_values( array $values, array $blueprint ): array {
	return factory_frontend_safe_edit_flatten_resolved_values(
		factory_frontend_safe_edit_build_resolved_values( $values, $values, $blueprint )
	);
}

function factory_frontend_safe_edit_flatten_resolved_values( array $resolved_values ): array {
	return [
		'hero_cta_destination' => (string) ( $resolved_values['hero_cta_destination']['current'] ?? '' ),
	];
}

function factory_frontend_safe_edit_get_destination_targets( array $blueprint ): array {
	$home = is_array( $blueprint['pages']['home'] ?? null ) ? $blueprint['pages']['home'] : [];
	$archive = is_array( $blueprint['pages']['archive'] ?? null ) ? $blueprint['pages']['archive'] : [];
	$contact = is_array( $blueprint['pages']['contact'] ?? null ) ? $blueprint['pages']['contact'] : [];
	$archive_slug = is_string( $archive['slug'] ?? null ) && '' !== trim( $archive['slug'] ) ? trim( $archive['slug'] ) : 'properties';
	$contact_slug = is_string( $contact['slug'] ?? null ) && '' !== trim( $contact['slug'] ) ? trim( $contact['slug'] ) : 'contact';
	$home_slug = is_string( $home['slug'] ?? null ) ? trim( (string) $home['slug'] ) : '';

	return [
		'home' => [
			'label' => 'Home',
			'href'  => factory_frontend_safe_edit_build_destination_href( $home_slug, true ),
		],
		'properties' => [
			'label' => 'Properties',
			'href'  => factory_frontend_safe_edit_build_destination_href( $archive_slug, false ),
		],
		'contact' => [
			'label' => 'Contact',
			'href'  => factory_frontend_safe_edit_build_destination_href( $contact_slug, false ),
		],
	];
}

function factory_frontend_safe_edit_get_destination_preflight( array $blueprint, string $destination ): array {
	$destination = sanitize_key( $destination );
	$targets = factory_frontend_safe_edit_get_destination_targets( $blueprint );
	$ownership_map = [
		'home'       => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'home' ),
		'properties' => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'archive' ),
		'contact'    => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'contact' ),
	];

	if ( ! isset( $targets[ $destination ] ) || ! isset( $ownership_map[ $destination ] ) ) {
		return [
			'destination'      => $destination,
			'label'            => 'Unknown',
			'href'             => '',
			'mode'             => 'invalid',
			'blocked'          => true,
			'blocking_reasons' => [ 'Hero CTA destination must be one of: home, properties, contact.' ],
		];
	}

	$page_ownership = $ownership_map[ $destination ];

	return [
		'destination'      => $destination,
		'label'            => (string) ( $targets[ $destination ]['label'] ?? factory_frontend_safe_edit_get_page_label( $page_ownership['page_key'] ?? $destination ) ),
		'href'             => (string) ( $targets[ $destination ]['href'] ?? '' ),
		'mode'             => 'generated_page',
		'blocked'          => ! empty( $page_ownership['blocked'] ),
		'blocking_reasons' => array_values( array_unique( $page_ownership['blocking_reasons'] ?? [] ) ),
		'page'             => $page_ownership,
	];
}

function factory_frontend_safe_edit_build_destination_href( string $slug, bool $is_home ): string {
	if ( $is_home ) {
		return home_url( '/' );
	}

	$slug = trim( $slug );

	if ( '' === $slug ) {
		return '';
	}

	return home_url( '/' . ltrim( $slug, '/' ) . '/' );
}

function factory_frontend_safe_edit_apply_hero_cta_destination_to_blueprint( array $blueprint, string $destination ): array {
	$destination = sanitize_key( $destination );
	$targets = factory_frontend_safe_edit_get_destination_targets( $blueprint );
	$target_href = isset( $targets[ $destination ]['href'] ) ? (string) $targets[ $destination ]['href'] : '';

	if ( '' === $target_href ) {
		return $blueprint;
	}

	foreach ( $blueprint['pages']['home']['sections'] ?? [] as $index => $section ) {
		if ( ! is_array( $section ) || 'hero' !== ( $section['type'] ?? '' ) ) {
			continue;
		}

		$blueprint['pages']['home']['sections'][ $index ]['cta_url'] = $target_href;
		break;
	}

	return $blueprint;
}

function factory_frontend_safe_edit_get_hero_cta_destination_state( array $blueprint ): array {
	$home = is_array( $blueprint['pages']['home'] ?? null ) ? $blueprint['pages']['home'] : [];
	$hero = factory_rest_find_real_estate_home_section( $home, 'hero' );
	$raw_url = is_string( $hero['cta_url'] ?? null ) ? trim( (string) $hero['cta_url'] ) : '';
	$targets = factory_frontend_safe_edit_get_destination_targets( $blueprint );
	$resolved_current = factory_frontend_safe_edit_resolve_internal_cta_url( $raw_url );

	foreach ( $targets as $key => $target ) {
		if ( factory_frontend_safe_edit_urls_match( $resolved_current, (string) ( $target['href'] ?? '' ) ) ) {
			return [
				'value' => $key,
				'resolved_href' => (string) ( $target['href'] ?? '' ),
				'raw_url' => $raw_url,
				'blocked' => false,
				'blocking_reason' => '',
			];
		}
	}

	return [
		'value' => '',
		'resolved_href' => '',
		'raw_url' => $raw_url,
		'blocked' => true,
		'blocking_reason' => 'Hero CTA destination is read-only because the stored CTA URL could not be mapped to Home, Properties, or Contact safely.',
	];
}

function factory_frontend_safe_edit_resolve_internal_cta_url( string $url ): string {
	$url = trim( $url );

	if ( '' === $url ) {
		return '';
	}

	if ( 0 === strpos( $url, '//' ) || 0 === strpos( $url, '#' ) ) {
		return '';
	}

	if ( preg_match( '#^(javascript:|data:|mailto:|tel:)#i', $url ) ) {
		return '';
	}

	if ( false !== strpos( $url, '?' ) || false !== strpos( $url, '#' ) ) {
		return '';
	}

	if ( preg_match( '#^https?://#i', $url ) ) {
		$url_parts = wp_parse_url( $url );
		$home_parts = wp_parse_url( home_url( '/' ) );

		if ( ! is_array( $url_parts ) || ! is_array( $home_parts ) ) {
			return '';
		}

		$url_host = strtolower( (string) ( $url_parts['host'] ?? '' ) );
		$home_host = strtolower( (string) ( $home_parts['host'] ?? '' ) );

		if ( '' === $url_host || $url_host !== $home_host ) {
			return '';
		}

		$url = (string) ( $url_parts['path'] ?? '/' );
	}

	return home_url( '/' . ltrim( $url, '/' ) );
}

function factory_frontend_safe_edit_urls_match( string $left, string $right ): bool {
	return factory_frontend_safe_edit_normalize_resolved_url( $left ) === factory_frontend_safe_edit_normalize_resolved_url( $right );
}

function factory_frontend_safe_edit_normalize_resolved_url( string $url ): string {
	$url = trim( $url );

	if ( '' === $url ) {
		return '';
	}

	$parts = wp_parse_url( $url );

	if ( ! is_array( $parts ) ) {
		return '';
	}

	$host = strtolower( (string) ( $parts['host'] ?? '' ) );
	$path = (string) ( $parts['path'] ?? '/' );
	$path = '/' === $path ? '/' : untrailingslashit( $path ) . '/';

	return $host . $path;
}

function factory_frontend_safe_edit_normalize_field_value( string $field, $value, array $schema, array $current_values ): array {
	if ( 'hero_cta_destination' !== $field ) {
		return [
			'value' => factory_rest_sanitize_preset_variable( $value, $schema ),
		];
	}

	if ( ! empty( $schema['blocked'] ) ) {
		$current = (string) ( $current_values[ $field ] ?? '' );
		$received = sanitize_key( (string) $value );

		if ( '' === $received || $received === $current ) {
			return [
				'value' => $current,
			];
		}

		return [
			'value' => $current,
			'error' => (string) ( $schema['blocking_reason'] ?? 'Hero CTA destination is currently read-only.' ),
		];
	}

	$normalized = sanitize_key( (string) $value );
	$allowed_values = array_map(
		static function ( array $option ): string {
			return sanitize_key( (string) ( $option['value'] ?? '' ) );
		},
		is_array( $schema['options'] ?? null ) ? $schema['options'] : []
	);

	if ( '' === $normalized || ! in_array( $normalized, $allowed_values, true ) ) {
		return [
			'value' => (string) ( $current_values[ $field ] ?? '' ),
			'error' => 'Hero CTA destination must be one of: home, properties, contact.',
		];
	}

	return [
		'value' => $normalized,
	];
}

function factory_frontend_safe_edit_describe_fields( array $fields ): string {
	$schema = factory_frontend_safe_edit_field_schema();
	$labels = [];

	foreach ( $fields as $field ) {
		if ( ! is_string( $field ) || '' === trim( $field ) ) {
			continue;
		}

		$labels[] = (string) ( $schema[ $field ]['label'] ?? ucwords( str_replace( '_', ' ', $field ) ) );
	}

	$labels = array_values( array_unique( array_filter( $labels ) ) );

	if ( empty( $labels ) ) {
		return 'the selected field';
	}

	if ( 1 === count( $labels ) ) {
		return $labels[0];
	}

	$last_label = array_pop( $labels );

	return implode( ', ', $labels ) . ' and ' . $last_label;
}

function factory_frontend_safe_edit_capture_runtime_snapshot(): array {
	$page_counts       = function_exists( 'wp_count_posts' ) ? wp_count_posts( 'page' ) : null;
	$property_counts   = function_exists( 'wp_count_posts' ) && post_type_exists( 'property' ) ? wp_count_posts( 'property' ) : null;
	$attachment_counts = function_exists( 'wp_count_posts' ) ? wp_count_posts( 'attachment' ) : null;

	return [
		'pages'            => factory_frontend_safe_edit_snapshot_total_count( $page_counts ),
		'published_pages'  => is_object( $page_counts ) ? max( 0, (int) ( $page_counts->publish ?? 0 ) ) : 0,
		'properties'       => factory_frontend_safe_edit_snapshot_total_count( $property_counts ),
		'attachments'      => factory_frontend_safe_edit_snapshot_total_count( $attachment_counts ),
	];
}

function factory_frontend_safe_edit_snapshot_total_count( $counts ): int {
	if ( ! is_object( $counts ) ) {
		return 0;
	}

	$total = 0;

	foreach ( get_object_vars( $counts ) as $status => $count ) {
		if ( 'trash' === $status || 'auto-draft' === $status ) {
			continue;
		}

		$total += max( 0, (int) $count );
	}

	return $total;
}

function factory_frontend_safe_edit_extract_style_context( array $blueprint ): array {
	$style = is_array( $blueprint['site']['style'] ?? null ) ? $blueprint['site']['style'] : [];

	return [
		'context' => [
			'tone'           => sanitize_key( (string) ( $style['tone'] ?? 'premium' ) ),
			'primary_preset' => sanitize_key( (string) ( $style['primary_preset'] ?? 'turquoise' ) ),
			'hero_variant'   => function_exists( 'factory_real_estate_apply_service_find_home_hero_variant' )
				? factory_real_estate_apply_service_find_home_hero_variant( $blueprint )
				: 'image_left_scrim',
		],
		'tokens'  => is_array( $style ) ? $style : [],
		'notes'   => [
			'Frontend safe edit reuses the existing stored blueprint style context.',
		],
	];
}

function factory_frontend_safe_edit_extract_image_context( array $blueprint ): array {
	$pools = [];
	$asset_pools = $blueprint['site']['assets']['property_images'] ?? [];

	if ( is_array( $asset_pools ) ) {
		foreach ( $asset_pools as $type => $sources ) {
			if ( ! is_string( $type ) || '' === trim( $type ) ) {
				continue;
			}

			$pools[ $type ] = is_array( $sources )
				? count(
					array_filter(
						$sources,
						static function ( $source_path ) {
							return is_string( $source_path ) && '' !== trim( $source_path );
						}
					)
				)
				: ( is_string( $sources ) && '' !== trim( $sources ) ? 1 : 0 );
		}
	}

	return [
		'context' => [
			'source' => 'demo_pool',
			'mode'   => 'round_robin',
			'pools'  => $pools,
		],
		'notes'   => [
			'Frontend safe edit reuses the existing bundled image context.',
		],
	];
}
