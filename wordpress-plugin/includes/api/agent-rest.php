<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_agent_rest_routes' );
add_filter( 'wp_is_application_passwords_available', 'factory_rest_agent_enable_local_application_passwords' );

function factory_rest_agent_enable_local_application_passwords( $available ) {
	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	$host = is_string( $host ) ? strtolower( $host ) : '';

	if ( in_array( $host, [ '127.0.0.1', 'localhost' ], true ) ) {
		return true;
	}

	return $available;
}

function factory_register_agent_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/agent/health',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_agent_health',
			'permission_callback' => 'factory_rest_require_signed_launcher',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/capabilities',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_agent_capabilities',
			'permission_callback' => 'factory_rest_require_signed_launcher',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/dependencies',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_agent_dependencies',
			'permission_callback' => 'factory_rest_require_signed_launcher',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/safe-fields/apply',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_agent_safe_fields_apply',
			'permission_callback' => 'factory_rest_require_signed_launcher',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/auth/rotate',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_agent_auth_rotate',
			'permission_callback' => 'factory_rest_require_signed_launcher',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/auth/revoke',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_agent_auth_revoke',
			'permission_callback' => 'factory_rest_require_signed_launcher',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/auth/bootstrap',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_agent_auth_bootstrap',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_agent_signed_auth_context( WP_REST_Request $request ): array {
	$context = $request->get_param( '_factory_signed_auth_context' );
	return is_array( $context ) ? $context : [];
}

function factory_rest_agent_auth_rotate( WP_REST_Request $request ): WP_REST_Response {
	$credential = $request->get_param( 'credential' );
	if ( ! is_array( $credential ) ) {
		return new WP_REST_Response(
			[
				'status' => 'error',
				'code'   => 'agent_auth_rotation_invalid',
			],
			400
		);
	}

	$payload = [
		'schema'           => 'factory_agent_signing_credential',
		'version'          => 1,
		'contract_version' => sanitize_text_field( (string) ( $credential['contract_version'] ?? '' ) ),
		'key_id'           => sanitize_text_field( (string) ( $credential['key_id'] ?? '' ) ),
		'signing_secret'   => is_string( $credential['signing_secret'] ?? null ) ? (string) $credential['signing_secret'] : '',
		'status'           => 'active',
		'created_at'       => sanitize_text_field( (string) ( $credential['created_at'] ?? '' ) ),
		'revoked_at'       => null,
		'capabilities'     => is_array( $credential['capabilities'] ?? null ) ? array_values( $credential['capabilities'] ) : [],
		'project_slug'     => sanitize_key( (string) ( $credential['project_slug'] ?? '' ) ),
	];

	$result = factory_agent_signed_auth_register_rotation_credential(
		$payload,
		factory_rest_agent_signed_auth_context( $request )
	);
	if ( is_wp_error( $result ) ) {
		return new WP_REST_Response(
			[
				'status' => 'error',
				'code'   => $result->get_error_code(),
			],
			(int) ( $result->get_error_data()['status'] ?? 400 )
		);
	}

	return new WP_REST_Response( $result );
}

function factory_rest_agent_auth_revoke( WP_REST_Request $request ): WP_REST_Response {
	if ( true !== $request->get_param( 'confirm_revoke' ) ) {
		return new WP_REST_Response(
			[
				'status' => 'error',
				'code'   => 'agent_auth_revoke_confirmation_required',
			],
			400
		);
	}

	$key_id = sanitize_text_field( (string) $request->get_param( 'key_id' ) );
	$result = factory_agent_signed_auth_revoke_key(
		$key_id,
		factory_rest_agent_signed_auth_context( $request )
	);
	if ( is_wp_error( $result ) ) {
		return new WP_REST_Response(
			[
				'status' => 'error',
				'code'   => $result->get_error_code(),
			],
			(int) ( $result->get_error_data()['status'] ?? 400 )
		);
	}

	return new WP_REST_Response( $result );
}

function factory_rest_agent_auth_bootstrap( WP_REST_Request $request ): WP_REST_Response {
	$payload = [
		'schema'           => 'factory_agent_signing_credential',
		'version'          => 1,
		'contract_version' => sanitize_text_field( (string) $request->get_param( 'contract_version' ) ),
		'key_id'           => sanitize_text_field( (string) $request->get_param( 'key_id' ) ),
		'signing_secret'   => is_string( $request->get_param( 'signing_secret' ) ) ? (string) $request->get_param( 'signing_secret' ) : '',
		'status'           => 'active',
		'created_at'       => sanitize_text_field( (string) $request->get_param( 'created_at' ) ),
		'revoked_at'       => null,
		'capabilities'     => is_array( $request->get_param( 'capabilities' ) ) ? array_values( $request->get_param( 'capabilities' ) ) : [],
		'project_slug'     => sanitize_key( (string) $request->get_param( 'project_slug' ) ),
	];

	$result = factory_agent_signed_auth_store_credential( $payload );
	if ( is_wp_error( $result ) ) {
		$status = (int) ( $result->get_error_data()['status'] ?? 400 );
		return new WP_REST_Response(
			[
				'status' => 'error',
				'code'   => $result->get_error_code(),
			],
			$status
		);
	}

	return new WP_REST_Response( $result );
}

function factory_rest_agent_health(): WP_REST_Response {
	$theme = wp_get_theme();
	$latest_run = function_exists( 'factory_get_latest_run_name' ) ? factory_get_latest_run_name() : null;
	$stored_blueprint = defined( 'FACTORY_BLUEPRINT_OPTION' ) ? get_option( FACTORY_BLUEPRINT_OPTION ) : null;
	$generated_site_present = null;

	if ( is_array( $stored_blueprint ) ) {
		$generated_site_present = ! empty( $stored_blueprint );
	} elseif ( null !== $latest_run ) {
		$generated_site_present = true;
	}

	return new WP_REST_Response(
		[
			'status'                 => 'ok',
			'code'                   => 'agent_ready',
			'plugin_slug'            => 'crocoblock-site-factory',
			'plugin_version'         => defined( 'FACTORY_PLUGIN_VERSION' ) ? FACTORY_PLUGIN_VERSION : null,
			'wp_version'             => get_bloginfo( 'version' ),
			'php_version'            => PHP_VERSION,
			'site_url'               => site_url(),
			'home_url'               => home_url(),
			'active_theme'           => $theme instanceof WP_Theme ? $theme->get_stylesheet() : null,
			'rest_namespace'         => 'factory/v1',
			'generated_site_present' => $generated_site_present,
			'last_run_id'            => $latest_run,
			'auth_mode'              => 'factory_agent_hmac_signed_request',
		]
	);
}

function factory_rest_agent_capabilities(): WP_REST_Response {
	$fields = function_exists( 'factory_frontend_safe_edit_mutable_save_fields' )
		? factory_frontend_safe_edit_mutable_save_fields()
		: [ 'hero_title', 'hero_subtitle', 'hero_cta_text', 'hero_cta_destination' ];

	return new WP_REST_Response(
		[
			'status'                    => 'ok',
			'code'                      => 'agent_capabilities_ready',
			'capabilities'              => [
				'dependency_status'  => true,
				'ai_read_only_chain' => true,
				'controlled_generate' => true,
				'safe_fields_apply'  => true,
				'frontend_safe_edit' => true,
				'agent_auth_rotate'  => true,
				'agent_auth_revoke'  => true,
				'proof_manifest'     => true,
				'rollback_alpha'     => false,
			],
			'frontend_safe_edit_fields' => array_values( $fields ),
			'supported_verticals'       => [ 'real_estate' ],
		]
	);
}

function factory_rest_agent_safe_field_allowlist(): array {
	return [ 'agency_name', 'hero_title', 'hero_subtitle', 'hero_cta_text' ];
}

function factory_rest_agent_safe_field_length_limits(): array {
	return [
		'agency_name'   => 120,
		'hero_title'    => 160,
		'hero_subtitle' => 300,
		'hero_cta_text' => 80,
	];
}

function factory_rest_agent_validate_safe_field_payload( $fields ): array {
	$allowlist = factory_rest_agent_safe_field_allowlist();
	$limits    = factory_rest_agent_safe_field_length_limits();
	$unknown   = [];
	$invalid   = [];
	$reasons   = [];
	$valid     = [];

	if ( ! is_array( $fields ) ) {
		return [
			'ok'               => false,
			'unknown_fields'   => [],
			'invalid_fields'   => [ 'fields' ],
			'rejected_fields'  => [ 'fields' ],
			'rejected_reasons' => [
				'fields' => 'fields must be an object of allowlisted string values.',
			],
			'valid_fields'     => [],
		];
	}

	if ( wp_is_numeric_array( $fields ) ) {
		return [
			'ok'               => false,
			'unknown_fields'   => [],
			'invalid_fields'   => [ 'fields' ],
			'rejected_fields'  => [ 'fields' ],
			'rejected_reasons' => [
				'fields' => 'fields must be an associative object, not an array.',
			],
			'valid_fields'     => [],
		];
	}

	if ( empty( $fields ) ) {
		return [
			'ok'               => false,
			'unknown_fields'   => [],
			'invalid_fields'   => [ 'fields' ],
			'rejected_fields'  => [ 'fields' ],
			'rejected_reasons' => [
				'fields' => 'fields must not be empty.',
			],
			'valid_fields'     => [],
		];
	}

	foreach ( $fields as $field_key => $raw_value ) {
		$field_key = sanitize_key( (string) $field_key );

		if ( ! in_array( $field_key, $allowlist, true ) ) {
			$unknown[] = $field_key;
			$reasons[ $field_key ] = 'field is not allowlisted for safe field apply.';
			continue;
		}

		if ( ! is_string( $raw_value ) ) {
			$invalid[] = $field_key;
			$reasons[ $field_key ] = 'value must be a plain string.';
			continue;
		}

		$value = trim( wp_unslash( $raw_value ) );

		if ( '' === $value ) {
			$invalid[] = $field_key;
			$reasons[ $field_key ] = 'value must not be empty.';
			continue;
		}

		if ( preg_match( '/<[^>]*>/', $value ) ) {
			$invalid[] = $field_key;
			$reasons[ $field_key ] = 'HTML or markup is not allowed.';
			continue;
		}

		if ( false !== strpos( $value, '<' ) || false !== strpos( $value, '>' ) ) {
			$invalid[] = $field_key;
			$reasons[ $field_key ] = 'angle-bracket markup is not allowed.';
			continue;
		}

		$max_length = (int) ( $limits[ $field_key ] ?? 0 );
		if ( $max_length > 0 && function_exists( 'mb_strlen' ) ? mb_strlen( $value ) > $max_length : strlen( $value ) > $max_length ) {
			$invalid[] = $field_key;
			$reasons[ $field_key ] = 'value exceeds max length of ' . $max_length . ' characters.';
			continue;
		}

		$valid[ $field_key ] = $value;
	}

	$unknown = array_values( array_unique( array_filter( $unknown ) ) );
	$invalid = array_values( array_unique( array_filter( $invalid ) ) );
	$rejected = array_values( array_unique( array_merge( $unknown, $invalid ) ) );

	return [
		'ok'               => empty( $unknown ) && empty( $invalid ) && ! empty( $valid ),
		'unknown_fields'   => $unknown,
		'invalid_fields'   => $invalid,
		'rejected_fields'  => $rejected,
		'rejected_reasons' => $reasons,
		'valid_fields'     => $valid,
	];
}

function factory_rest_agent_validate_safe_field_context_payload( $value, string $context_key ): array {
	if ( null === $value ) {
		return [
			'ok'               => true,
			'unknown_fields'   => [],
			'invalid_fields'   => [],
			'rejected_fields'  => [],
			'rejected_reasons' => [],
			'valid_fields'     => [],
		];
	}

	if ( is_array( $value ) && empty( $value ) ) {
		return [
			'ok'               => true,
			'unknown_fields'   => [],
			'invalid_fields'   => [],
			'rejected_fields'  => [],
			'rejected_reasons' => [],
			'valid_fields'     => [],
		];
	}

	$validated = factory_rest_agent_validate_safe_field_payload( $value );

	if ( $validated['ok'] ) {
		return $validated;
	}

	$reasons = [];
	foreach ( $validated['rejected_reasons'] as $field_key => $reason ) {
		$reasons[ $context_key . '.' . $field_key ] = $reason;
	}

	return [
		'ok'               => false,
		'unknown_fields'   => $validated['unknown_fields'],
		'invalid_fields'   => $validated['invalid_fields'],
		'rejected_fields'  => $validated['rejected_fields'],
		'rejected_reasons' => $reasons,
		'valid_fields'     => [],
	];
}

function factory_rest_agent_safe_fields_apply( WP_REST_Request $request ): WP_REST_Response {
	if ( ! function_exists( 'factory_frontend_safe_edit_collect_save_context' ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'error',
				'code'            => 'agent_safe_fields_apply_unavailable',
				'message'         => 'Safe field apply helpers are unavailable.',
				'applies_changes' => false,
				'apply_method'    => 'field_only_safe_apply',
			],
			500
		);
	}

	$context = factory_frontend_safe_edit_collect_save_context();

	if ( is_wp_error( $context ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'blocked',
				'code'            => $context->get_error_code(),
				'message'         => $context->get_error_message(),
				'applies_changes' => false,
				'apply_method'    => 'field_only_safe_apply',
			],
			(int) ( $context->get_error_data()['status'] ?? 409 )
		);
	}

	$ownership = $context['ownership'];
	$fields         = $request->get_param( 'fields' );
	$raw_fields     = $fields;
	$allowlist      = factory_rest_agent_safe_field_allowlist();
	$context_param  = $request->get_param( 'context' );
	$client_context = is_array( $context_param ) ? $context_param : [];
	$safe_render_context = $client_context['safe_render_context'] ?? null;
	$preserved_fields    = $client_context['preserved_fields'] ?? null;
	$validated      = factory_rest_agent_validate_safe_field_payload( $raw_fields );
	$validated_render_context = factory_rest_agent_validate_safe_field_context_payload( $safe_render_context, 'safe_render_context' );
	$validated_preserved_fields = factory_rest_agent_validate_safe_field_context_payload( $preserved_fields, 'preserved_fields' );

	if ( ! $validated['ok'] || ! $validated_render_context['ok'] || ! $validated_preserved_fields['ok'] ) {
		$rejected_fields = array_values(
			array_unique(
				array_merge(
					$validated['rejected_fields'],
					$validated_render_context['rejected_fields'],
					$validated_preserved_fields['rejected_fields']
				)
			)
		);
		$unknown_fields = array_values(
			array_unique(
				array_merge(
					$validated['unknown_fields'],
					$validated_render_context['unknown_fields'],
					$validated_preserved_fields['unknown_fields']
				)
			)
		);
		$invalid_fields = array_merge(
			$validated['invalid_fields'],
			$validated_render_context['invalid_fields'],
			$validated_preserved_fields['invalid_fields']
		);
		$rejected_reasons = array_merge(
			$validated['rejected_reasons'],
			$validated_render_context['rejected_reasons'],
			$validated_preserved_fields['rejected_reasons']
		);

		return new WP_REST_Response(
			[
				'status'           => 'error',
				'code'             => 'agent_safe_fields_invalid_values',
				'message'          => 'Safe field apply rejected malformed values before mutation.',
				'applies_changes'  => false,
				'apply_method'     => 'field_only_safe_apply',
				'no_wp_mutation'   => true,
				'rejected_fields'  => $rejected_fields,
				'rejected_reasons' => $rejected_reasons,
				'unknown_fields'   => $unknown_fields,
				'invalid_fields'   => $invalid_fields,
				'current_values'   => $before_values,
			],
			400
		);
	}

	$launcher_safe_refresh_source = sanitize_key( (string) ( $client_context['source'] ?? '' ) );

	if (
		! empty( $ownership['blocked'] )
		&& in_array( $launcher_safe_refresh_source, [ 'launcher_state_apply', 'state_apply_rollback_v1' ], true )
		&& function_exists( 'factory_frontend_safe_edit_prepare_page_refresh_targets' )
		&& is_array( $context['blueprint'] ?? null )
	) {
		factory_frontend_safe_edit_prepare_page_refresh_targets( $context['blueprint'], [ 'home', 'native_filters', 'contact' ] );
		$context = factory_frontend_safe_edit_collect_save_context();

		if ( is_wp_error( $context ) ) {
			return new WP_REST_Response(
				[
					'status'          => 'blocked',
					'code'            => $context->get_error_code(),
					'message'         => $context->get_error_message(),
					'applies_changes' => false,
					'apply_method'    => 'field_only_safe_apply',
				],
				(int) ( $context->get_error_data()['status'] ?? 409 )
			);
		}

		$ownership = $context['ownership'];
	}

	if ( ! empty( $ownership['blocked'] ) ) {
		return new WP_REST_Response(
			[
				'status'           => 'blocked',
				'code'             => 'agent_safe_fields_ownership_blocked',
				'message'          => 'Safe field apply is blocked by current ownership state. No site changes were made.',
				'applies_changes'  => false,
				'apply_method'     => 'field_only_safe_apply',
				'blocking_reasons' => array_values( array_unique( $ownership['blocking_reasons'] ?? [] ) ),
				'ownership'        => $ownership,
				'current_values'   => $context['current_values'],
			],
			409
		);
	}

	$before_values  = $context['current_values'];

	$render_context_values = $validated_render_context['valid_fields'];
	$preserved_render_values = $validated_preserved_fields['valid_fields'];

	foreach ( $preserved_render_values as $field_key => $value ) {
		if ( isset( $render_context_values[ $field_key ] ) && $render_context_values[ $field_key ] !== $value ) {
			return new WP_REST_Response(
				[
					'status'           => 'error',
					'code'             => 'agent_safe_fields_invalid_values',
					'message'          => 'Preserved safe render field values must match the safe render context.',
					'applies_changes'  => false,
					'apply_method'     => 'field_only_safe_apply',
					'no_wp_mutation'   => true,
					'rejected_fields'  => [ $field_key ],
					'rejected_reasons' => [
						'preserved_fields.' . $field_key => 'preserved field value must match safe_render_context for the same key.',
					],
					'unknown_fields'   => [],
					'invalid_fields'   => [ $field_key ],
					'current_values'   => $before_values,
				],
				400
			);
		}
	}

	$normalized = factory_frontend_safe_edit_normalize_save_values( $validated['valid_fields'], $before_values );

	if ( ! empty( $normalized['invalid_fields'] ) ) {
		return new WP_REST_Response(
			[
				'status'          => 'error',
				'code'            => 'agent_safe_fields_invalid_values',
				'message'         => 'Safe field apply rejected malformed values before mutation.',
				'applies_changes' => false,
				'apply_method'    => 'field_only_safe_apply',
				'no_wp_mutation'  => true,
				'rejected_fields' => array_keys( $normalized['invalid_fields'] ),
				'rejected_reasons'=> $normalized['invalid_fields'],
				'unknown_fields'  => [],
				'invalid_fields'  => $normalized['invalid_fields'],
				'current_values'  => $before_values,
			],
			400
		);
	}

	$requested_fields = array_values(
		array_values( array_unique( $normalized['submitted_fields'] ) )
	);
	$preview_values = $normalized['values'];
	$diff_summary   = factory_frontend_safe_edit_build_diff_summary( $before_values, $preview_values );
	$changed_fields = array_map(
		static function ( array $item ): string {
			return (string) ( $item['field'] ?? '' );
		},
		$diff_summary['changed_fields'] ?? []
	);
	$changed_fields = array_values(
		array_filter(
			array_unique( $changed_fields ),
			static function ( $field_key ) use ( $allowlist ): bool {
				return in_array( $field_key, $allowlist, true );
			}
		)
	);
	$ignored_fields = array_values( array_diff( $requested_fields, $changed_fields ) );

	if ( empty( $changed_fields ) ) {
		return new WP_REST_Response(
			[
				'status'             => 'ok',
				'code'               => 'agent_safe_fields_no_changes',
				'message'            => 'Safe field apply found no changed values. No site changes were made.',
				'applies_changes'    => false,
				'apply_method'       => 'field_only_safe_apply',
				'requested_fields'   => $requested_fields,
				'applied_fields'     => [],
				'ignored_fields'     => $ignored_fields,
				'before_values'      => $before_values,
				'after_values'       => $before_values,
				'field_only_apply'   => [
					'endpoint'         => '/wp-json/factory/v1/agent/safe-fields/apply',
					'requested_fields' => $requested_fields,
					'applied_fields'   => [],
					'ignored_fields'   => $ignored_fields,
					'agent_manifest'   => '',
					'fallback_used'    => false,
				],
			]
		);
	}

	$applied_variables = [];

	foreach ( $changed_fields as $field_key ) {
		$applied_variables[ $field_key ] = (string) ( $preview_values[ $field_key ] ?? '' );
	}

	$render_variables = $applied_variables;
	foreach ( $render_context_values as $field_key => $value ) {
		if ( in_array( $field_key, $allowlist, true ) ) {
			$render_variables[ $field_key ] = (string) $value;
		}
	}

	$updated_blueprint = factory_rest_apply_real_estate_preset_variables(
		$context['blueprint'],
		$render_variables
	);
	$runtime_snapshot_before = factory_frontend_safe_edit_capture_runtime_snapshot();
	$apply_boundary_started  = false;

	try {
		update_option( FACTORY_BLUEPRINT_OPTION, $updated_blueprint );
		$apply_boundary_started = true;

		if ( function_exists( 'factory_frontend_safe_edit_prepare_page_refresh_targets' ) ) {
			factory_frontend_safe_edit_prepare_page_refresh_targets( $updated_blueprint, [ 'home', 'native_filters', 'contact' ] );
		}

		$adapter = new Factory_Render_Adapter();
		$execution = $adapter->apply_safe_field_refresh( $updated_blueprint, [ 'home', 'native_filters', 'contact' ], true );
		$report = factory_validate_blueprint_state( $updated_blueprint, false );
		$manifest_path = factory_save_run_manifest(
			'Launcher state field-only apply: ' . implode( ',', $changed_fields ),
			'real-estate-safe-fields',
			$updated_blueprint,
			[
				'version' => 1,
				'summary' => [
					'create'  => 0,
					'update'  => count(
						array_filter(
							$execution,
							static function ( $item ): bool {
								return is_array( $item ) && 'update' === ( $item['action'] ?? '' );
							}
						)
					),
					'skip'    => count(
						array_filter(
							$execution,
							static function ( $item ): bool {
								return is_array( $item ) && 'skip' === ( $item['action'] ?? '' );
							}
						)
					),
					'warning' => count(
						array_filter(
							$execution,
							static function ( $item ): bool {
								return is_array( $item ) && 'warning' === ( $item['status'] ?? '' );
							}
						)
					),
					'error'   => count(
						array_filter(
							$execution,
							static function ( $item ): bool {
								return is_array( $item ) && 'error' === ( $item['status'] ?? '' );
							}
						)
					),
				],
				'items'   => [],
			],
			$report,
			(string) ( $report['status'] ?? 'ok' ),
			$execution,
			[
				'apply_source'       => 'launcher_state_field_only_apply',
				'safe_fields_apply'  => [
					'requested_fields' => $requested_fields,
					'applied_fields'   => $changed_fields,
					'ignored_fields'   => $ignored_fields,
					'rendered_fields'  => array_keys( $render_variables ),
					'context'          => $client_context,
				],
				'prompt_context'     => [
					'prompt'            => 'Launcher state field-only apply: ' . implode( ',', $changed_fields ),
					'preset_variables'  => $render_variables,
					'applied_variables' => $applied_variables,
					'notes'             => [
						'Narrow Agent safe field apply updates only allowlisted safe variables.',
						'Safe render context preserves protected fields for page refresh without broad regeneration.',
						'No properties, attachments, theme state, or dependency state are regenerated in this path.',
					],
				],
			]
		);
	} catch ( Throwable $e ) {
		return new WP_REST_Response(
			[
				'status'                  => 'error',
				'code'                    => $apply_boundary_started
					? 'agent_safe_fields_apply_failed_after_boundary'
					: 'agent_safe_fields_apply_failed',
				'message'                 => $apply_boundary_started
					? 'Safe field apply failed after entering the mutation boundary. Partial mutation may have occurred.'
					: 'Safe field apply failed before completion.',
				'applies_changes'         => $apply_boundary_started,
				'apply_method'            => 'field_only_safe_apply',
				'requested_fields'        => $requested_fields,
				'applied_fields'          => [],
				'ignored_fields'          => $ignored_fields,
				'before_values'           => $before_values,
				'after_values'            => $before_values,
				'runtime_snapshot_before' => $runtime_snapshot_before,
				'mutation_status'         => $apply_boundary_started ? 'unknown_after_apply_started' : 'not_started',
				'field_only_apply'        => [
					'endpoint'         => '/wp-json/factory/v1/agent/safe-fields/apply',
					'requested_fields' => $requested_fields,
					'applied_fields'   => [],
					'ignored_fields'   => $ignored_fields,
					'agent_manifest'   => '',
					'fallback_used'    => false,
				],
			],
			500
		);
	}

	$updated_context = factory_frontend_safe_edit_collect_save_context();
	$after_values = is_wp_error( $updated_context )
		? factory_frontend_safe_edit_get_current_values( $updated_blueprint )
		: $updated_context['current_values'];
	$ownership_after = is_wp_error( $updated_context )
		? $ownership
		: $updated_context['ownership'];
	$runtime_snapshot_after = factory_frontend_safe_edit_capture_runtime_snapshot();
	$results_summary = function_exists( 'factory_build_manifest_results' )
		? factory_build_manifest_results( $report )
		: [ 'summary' => [ 'ok' => 0, 'warning' => 0, 'error' => 0 ] ];

	return new WP_REST_Response(
		[
			'status'                  => 'ok',
			'code'                    => 'agent_safe_fields_applied',
			'message'                 => 'Safe field apply updated the allowlisted generated content fields.',
			'applies_changes'         => true,
			'apply_method'            => 'field_only_safe_apply',
			'requested_fields'        => $requested_fields,
			'applied_fields'          => $changed_fields,
			'ignored_fields'          => $ignored_fields,
			'before_values'           => $before_values,
			'after_values'            => $after_values,
			'ownership_before'        => $ownership,
			'ownership_after'         => $ownership_after,
			'runtime_snapshot_before' => $runtime_snapshot_before,
			'runtime_snapshot_after'  => $runtime_snapshot_after,
			'manifest_file'           => basename( $manifest_path ),
			'manifest_path'           => $manifest_path,
			'execution_count'         => count( $execution ),
			'validation_count'        => count( $report['checks'] ?? [] ),
			'results_summary'         => $results_summary['summary'] ?? [],
			'field_only_apply'        => [
				'endpoint'         => '/wp-json/factory/v1/agent/safe-fields/apply',
				'requested_fields' => $requested_fields,
				'applied_fields'   => $changed_fields,
				'ignored_fields'   => $ignored_fields,
				'rendered_fields'  => array_keys( $render_variables ),
				'agent_manifest'   => $manifest_path,
				'fallback_used'    => false,
			],
			'render_context_fields'     => array_keys( $render_variables ),
			'safe_render_context'       => $render_context_values,
			'preserved_render_values'   => $preserved_render_values,
		]
	);
}

function factory_rest_agent_dependencies(): WP_REST_Response {
	$dependencies = factory_rest_agent_dependency_items( 'real_estate' );
	$blockers = [];

	foreach ( $dependencies as $dependency ) {
		if ( ! empty( $dependency['blocking'] ) ) {
			$blockers[] = $dependency['name'] . ': ' . ( $dependency['notes'] ?: 'Required dependency is not ready.' );
		}
	}

	return new WP_REST_Response(
		[
			'status'     => 'ok',
			'code'       => 'dependencies_ready',
			'site_type'  => 'real_estate',
			'dependencies' => $dependencies,
			'blockers'   => array_values( $blockers ),
			'can_generate' => empty( $blockers ),
		]
	);
}

function factory_rest_agent_dependency_items( string $site_type ): array {
	if ( ! function_exists( 'get_plugins' ) || ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$definitions = function_exists( 'factory_console_dependency_definitions' )
		? factory_console_dependency_definitions()
		: [];
	$capability_model = function_exists( 'factory_console_dependency_capability_model' )
		? factory_console_dependency_capability_model()
		: [
			'site_type_capabilities' => [
				'real_estate' => [ 'real_estate_catalog', 'property_filters' ],
			],
		];
	$required_capabilities = array_values( $capability_model['site_type_capabilities'][ $site_type ] ?? [] );
	$dependencies = [];

	foreach ( $definitions as $definition ) {
		if ( 'jet-plugins-wizard' === (string) ( $definition['slug'] ?? '' ) ) {
			continue;
		}

		$item = 'theme' === ( $definition['type'] ?? '' )
			? factory_console_theme_dependency_status( $definition )
			: factory_console_plugin_dependency_status( $definition );
		$capabilities = function_exists( 'factory_console_dependency_capabilities' )
			? factory_console_dependency_capabilities( (string) $item['slug'] )
			: [];
		$capability = isset( $capabilities[0] ) ? (string) $capabilities[0] : '';
		$required = ! empty( array_intersect( $required_capabilities, $capabilities ) );
		$status = (string) ( $item['status'] ?? 'missing' );

		$dependencies[] = [
			'slug'            => (string) ( $item['slug'] ?? '' ),
			'name'            => (string) ( $item['name'] ?? '' ),
			'type'            => (string) ( $item['type'] ?? 'plugin' ),
			'required'        => $required,
			'capability'      => $capability ?: null,
			'installed'       => ! empty( $item['installed'] ),
			'active'          => ! empty( $item['active'] ),
			'version'         => isset( $item['version'] ) ? (string) $item['version'] : null,
			'minimum_version' => isset( $item['minimum_version'] ) ? $item['minimum_version'] : null,
			'source_policy'   => factory_rest_agent_dependency_source_policy( (string) ( $item['slug'] ?? '' ) ),
			'blocking'        => $required && 'ok' !== $status,
			'notes'           => factory_rest_agent_dependency_note( (string) ( $item['slug'] ?? '' ), $required, $status ),
		];
	}

	return $dependencies;
}

function factory_rest_agent_dependency_source_policy( string $slug ): string {
	switch ( $slug ) {
		case 'kava':
		case 'jet-engine':
		case 'jet-smart-filters':
			return 'official_crocoblock';
		case 'jet-form-builder':
		case 'woocommerce':
		case 'elementor':
			return 'wordpress_org';
		default:
			return 'manual';
	}
}

function factory_rest_agent_dependency_note( string $slug, bool $required, string $status ): string {
	$label = str_replace( '-', ' ', $slug );

	if ( 'ok' === $status ) {
		return ucfirst( $label ) . ' is available.';
	}

	if ( $required ) {
		if ( in_array( $slug, [ 'kava', 'jet-engine', 'jet-smart-filters' ], true ) ) {
			return 'Install via the official Crocoblock Wizard or upload the official ZIP manually.';
		}

		return 'Required dependency is not ready yet.';
	}

	if ( in_array( $slug, [ 'woocommerce', 'elementor', 'jet-form-builder' ], true ) ) {
		return 'Optional dependency. Install only if the project needs this capability.';
	}

	return 'Dependency is optional in the current alpha flow.';
}
