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

	return new WP_REST_Response(
		[
			'status'          => 'blocked',
			'code'            => 'frontend_safe_edit_save_not_enabled',
			'message'         => 'Frontend safe edit save contract is ready, but controlled apply is not enabled yet. No site changes were made.',
			'applies_changes' => false,
			'source'          => 'frontend_safe_edit',
			'changed_fields'  => $changed_fields,
			'before_values'   => $context['current_values'],
			'after_values'    => $normalized_safe_values['values'],
			'ignored_fields'  => [],
			'ownership'       => $ownership,
			'client_context'  => is_array( $client_context ) ? $client_context : [],
			'next_step'       => 'implement_controlled_apply_bridge',
		],
		501
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
