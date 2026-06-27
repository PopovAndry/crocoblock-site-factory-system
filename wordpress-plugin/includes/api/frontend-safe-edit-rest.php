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
		$warnings[] = 'Frontend safe edit preview is blocked until Home and Contact ownership state is safe.';

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
				'ownership'        => $context['ownership'],
				'warnings'         => array_values( array_unique( $warnings ) ),
			],
			409
		);
	}

	$received = $request->get_param( 'safe_values' );
	$normalized = factory_frontend_safe_edit_normalize_preview_values(
		is_array( $received ) ? $received : [],
		$context['current_values']
	);
	$diff_summary = factory_frontend_safe_edit_build_diff_summary(
		$context['current_values'],
		$normalized['values']
	);
	$warnings = $context['warnings'];

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
				'message'         => 'Frontend safe edit save is only enabled for Hero title in this beta. No site changes were made.',
				'applies_changes' => false,
				'source'          => 'frontend_safe_edit',
				'changed_fields'  => $changed_fields,
				'before_values'   => $context['current_values'],
				'after_values'    => $normalized_safe_values['values'],
				'ignored_fields'  => [],
				'ownership'       => $ownership,
				'client_context'  => is_array( $client_context ) ? $client_context : [],
				'next_step'       => 'hero_title_only_beta',
			],
			501
		);
	}

	$runtime_snapshot_before = factory_frontend_safe_edit_capture_runtime_snapshot();
	$style_context           = factory_frontend_safe_edit_extract_style_context( $context['blueprint'] );
	$image_context           = factory_frontend_safe_edit_extract_image_context( $context['blueprint'] );
	$overlay_variables       = $context['current_values'];

	foreach ( $mutable_fields as $field ) {
		if ( array_key_exists( $field, $normalized_safe_values['values'] ) ) {
			$overlay_variables[ $field ] = $normalized_safe_values['values'][ $field ];
		}
	}

	$apply_args = [
		'source'         => 'frontend_safe_edit',
		'base_blueprint' => $context['blueprint'],
		'prompt_context' => [
			'prompt'            => 'Frontend safe edit save: hero_title',
			'preset_variables'  => $overlay_variables,
			'applied_variables' => $overlay_variables,
			'notes'             => [
				'Frontend safe edit save uses the stored Factory blueprint as the base.',
				'Only the hero_title safe variable is allowed to persist in this beta save flow.',
				'Generated pages are refreshed through the deterministic Real Estate apply service.',
			],
		],
		'style_context'  => $style_context,
		'image_context'  => $image_context,
		'manifest_metadata' => [
			'frontend_safe_edit' => [
				'field'        => 'hero_title',
				'before_value' => (string) ( $context['current_values']['hero_title'] ?? '' ),
				'after_value'  => (string) ( $overlay_variables['hero_title'] ?? '' ),
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
				'ignored_fields'          => [],
				'ownership_before'        => $ownership,
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
				'ignored_fields'          => [],
				'ownership_before'        => $ownership,
				'runtime_snapshot_before' => $runtime_snapshot_before,
				'dependencies'            => is_array( $apply_result['dependencies'] ?? null ) ? $apply_result['dependencies'] : [],
				'next_step'               => 'review_updated_frontend',
			],
			max( 400, (int) ( $apply_result['http_status'] ?? 409 ) )
		);
	}

	$updated_blueprint_context = factory_frontend_safe_edit_collect_save_context();
	$updated_current_values    = is_wp_error( $updated_blueprint_context )
		? factory_frontend_safe_edit_get_current_values( is_array( $apply_result['blueprint'] ?? null ) ? $apply_result['blueprint'] : $context['blueprint'] )
		: $updated_blueprint_context['current_values'];
	$ownership_after          = is_wp_error( $updated_blueprint_context )
		? $ownership
		: $updated_blueprint_context['ownership'];
	$runtime_snapshot_after   = factory_frontend_safe_edit_capture_runtime_snapshot();
	$apply_response           = is_array( $apply_result['response'] ?? null ) ? $apply_result['response'] : [];

	return new WP_REST_Response(
		[
			'status'                  => 'ok',
			'code'                    => 'frontend_safe_edit_saved',
			'message'                 => 'Hero title was saved through the controlled Factory apply path.',
			'applies_changes'         => true,
			'source'                  => 'frontend_safe_edit',
			'changed_fields'          => $changed_fields,
			'before_values'           => $context['current_values'],
			'after_values'            => $updated_current_values,
			'ignored_fields'          => [],
			'ownership_before'        => $ownership,
			'ownership_after'         => $ownership_after,
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
	$current_values = factory_frontend_safe_edit_get_current_values( $blueprint );
	$ownership = factory_frontend_safe_edit_get_ownership_summary( $blueprint );
	$warnings = [];
	$can_edit = ! $ownership['blocked'] && 'stored_blueprint' === $record['source'];

	if ( 'stored_blueprint' !== $record['source'] ) {
		$warnings[] = 'Stored Factory blueprint is unavailable; preview uses the bundled preset fallback.';
	}

	return [
		'can_edit'        => $can_edit,
		'blueprint_source'=> $record['source'],
		'safe_fields'     => factory_frontend_safe_edit_field_schema(),
		'current_values'  => $current_values,
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

	return [
		'source'         => 'frontend_safe_edit',
		'blueprint'      => $blueprint,
		'blueprint_source' => $record['source'],
		'current_values' => factory_frontend_safe_edit_get_current_values( $blueprint ),
		'ownership'      => factory_frontend_safe_edit_get_ownership_summary( $blueprint ),
		'safe_fields'    => factory_frontend_safe_edit_field_schema(),
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

	return $schema;
}

function factory_frontend_safe_edit_get_current_values( array $blueprint ): array {
	$defaults = factory_rest_get_real_estate_variable_defaults( $blueprint );
	$values   = [];

	foreach ( factory_frontend_safe_edit_field_schema() as $key => $schema ) {
		$values[ $key ] = factory_rest_sanitize_preset_variable( $defaults[ $key ] ?? '', $schema );
	}

	return $values;
}

function factory_frontend_safe_edit_get_ownership_summary( array $blueprint ): array {
	$pages = [
		'home'    => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'home' ),
		'contact' => factory_frontend_safe_edit_get_page_ownership( $blueprint, 'contact' ),
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

	if ( ! $post instanceof WP_Post ) {
		$blocking_reasons[] = ucfirst( $page_key ) . ' page is missing.';

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
		$blocking_reasons[] = ucfirst( $page_key ) . ' page is not marked as Factory-managed.';
	}

	if ( $user_modified ) {
		$blocking_reasons[] = ucfirst( $page_key ) . ' page is marked as user-modified.';
	}

	if ( in_array( $lock, [ 'user_modified', 'user_owned', 'frozen', 'locked' ], true ) ) {
		$blocking_reasons[] = ucfirst( $page_key ) . ' page lock is ' . $lock . '.';
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

function factory_frontend_safe_edit_normalize_preview_values( array $received, array $current_values ): array {
	$schema = factory_frontend_safe_edit_field_schema();
	$values = [];
	$ignored_fields = [];

	foreach ( $received as $key => $value ) {
		if ( ! isset( $schema[ $key ] ) ) {
			$ignored_fields[] = sanitize_key( (string) $key );
		}
	}

	foreach ( $schema as $key => $item ) {
		if ( array_key_exists( $key, $received ) ) {
			$values[ $key ] = factory_rest_sanitize_preset_variable( $received[ $key ], $item );
			continue;
		}

		$values[ $key ] = (string) ( $current_values[ $key ] ?? '' );
	}

	return [
		'values'         => $values,
		'ignored_fields' => array_values( array_unique( array_filter( $ignored_fields ) ) ),
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

	foreach ( $schema as $key => $item ) {
		if ( ! array_key_exists( $key, $received ) ) {
			continue;
		}

		$values[ $key ] = factory_rest_sanitize_preset_variable( $received[ $key ], $item );
		$submitted_fields[] = $key;
	}

	return [
		'values'           => $values,
		'submitted_fields' => array_values( array_unique( $submitted_fields ) ),
	];
}

function factory_frontend_safe_edit_normalize_expected_values( array $expected_values ): array {
	$schema = factory_frontend_safe_edit_field_schema();
	$normalized = [];

	foreach ( $schema as $key => $item ) {
		if ( ! array_key_exists( $key, $expected_values ) ) {
			continue;
		}

		$normalized[ $key ] = factory_rest_sanitize_preset_variable( $expected_values[ $key ], $item );
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
	return [ 'hero_title' ];
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
