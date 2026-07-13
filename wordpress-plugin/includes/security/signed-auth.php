<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FACTORY_AGENT_SIGNED_AUTH_VERSION = 'factory-agent-hmac-v1';
const FACTORY_AGENT_SIGNED_AUTH_FRESHNESS_SECONDS = 300;
const FACTORY_AGENT_SIGNED_AUTH_CLOCK_SKEW_SECONDS = 30;
const FACTORY_AGENT_SIGNED_AUTH_OPTION = 'factory_agent_signed_auth_credentials';

function factory_agent_signed_auth_headers(): array {
	return [
		'version'   => 'x-factory-agent-auth-version',
		'key_id'    => 'x-factory-agent-key-id',
		'project_slug' => 'x-factory-project-slug',
		'timestamp' => 'x-factory-agent-timestamp',
		'request_id' => 'x-factory-agent-request-id',
		'body_hash' => 'x-factory-agent-body-sha256',
		'signature' => 'x-factory-agent-signature',
	];
}

function factory_agent_signed_auth_capabilities(): array {
	return [
		'health.read',
		'capabilities.read',
		'dependencies.read',
		'generate.plan',
		'generate.apply',
		'state.read',
		'state.apply',
		'state.rollback',
		'proof.read',
		'proof.create',
		'ai.plan',
		'ai.estimate',
		'ai.configure',
		'ai.enable_live',
		'auth.rotate',
		'auth.revoke',
	];
}

function factory_agent_signed_auth_route_capabilities(): array {
	return [
		'GET /factory/v1/agent/health'              => 'health.read',
		'GET /factory/v1/agent/capabilities'        => 'capabilities.read',
		'GET /factory/v1/agent/dependencies'        => 'dependencies.read',
		'POST /factory/v1/agent/auth/rotate'        => 'auth.rotate',
		'POST /factory/v1/agent/auth/revoke'        => 'auth.revoke',
		'POST /factory/v1/agent/safe-fields/apply'  => 'state.apply',
		'GET /factory/v1/ai/settings'               => 'ai.configure',
		'POST /factory/v1/ai/settings'              => 'ai.configure',
		'POST /factory/v1/ai/estimate'              => 'ai.estimate',
		'POST /factory/v1/ai/interpret-prompt'      => 'ai.plan',
		'POST /factory/v1/ai/interpret-live'        => 'ai.plan',
		'POST /factory/v1/ai/site-plan'             => 'ai.plan',
		'POST /factory/v1/ai/blueprint-candidate'   => 'ai.plan',
		'POST /factory/v1/ai/preview-diff'          => 'ai.plan',
		'POST /factory/v1/ai/generate-gate'         => 'generate.plan',
		'POST /factory/v1/ai/generate-preflight'    => 'generate.plan',
		'POST /factory/v1/ai/generate-confirmation' => 'generate.plan',
		'POST /factory/v1/ai/controlled-generate'   => 'generate.apply',
	];
}

function factory_agent_signed_auth_normalize_method( string $method ): string {
	return strtoupper( trim( $method ) );
}

function factory_agent_signed_auth_normalize_rest_path( string $path ): string {
	$path = trim( $path );
	if ( '' === $path ) {
		return '/';
	}

	$parts = wp_parse_url( $path );
	if ( is_array( $parts ) && isset( $parts['path'] ) ) {
		$path = (string) $parts['path'];
	}

	$path = str_replace( '\\', '/', $path );
	if ( ! str_starts_with( $path, '/' ) ) {
		$path = '/' . $path;
	}
	$path = preg_replace( '#/+#', '/', $path );
	$path = rtrim( $path, '/' );
	$path = '' === $path ? '/' : $path;

	if ( str_starts_with( $path, '/wp-json/' ) ) {
		$path = substr( $path, strlen( '/wp-json' ) );
	}

	return $path;
}

function factory_agent_signed_auth_encode_query_component( string $value ): string {
	return str_replace( '%7E', '~', rawurlencode( $value ) );
}

function factory_agent_signed_auth_canonical_query( string $query ): string {
	$query = ltrim( $query, '?' );
	if ( '' === $query ) {
		return '';
	}

	$pairs = [];
	foreach ( explode( '&', $query ) as $part ) {
		if ( '' === $part ) {
			continue;
		}
		$bits = explode( '=', $part, 2 );
		$key = rawurldecode( str_replace( '+', '%20', $bits[0] ) );
		$value = rawurldecode( str_replace( '+', '%20', $bits[1] ?? '' ) );
		$pairs[] = [ $key, $value ];
	}

	usort(
		$pairs,
		static function ( array $left, array $right ): int {
			if ( $left[0] === $right[0] ) {
				return $left[1] <=> $right[1];
			}

			return $left[0] <=> $right[0];
		}
	);

	return implode(
		'&',
		array_map(
			static function ( array $pair ): string {
				return factory_agent_signed_auth_encode_query_component( $pair[0] ) . '=' . factory_agent_signed_auth_encode_query_component( $pair[1] );
			},
			$pairs
		)
	);
}

function factory_agent_signed_auth_body_hash( string $body ): string {
	return hash( 'sha256', $body );
}

function factory_agent_signed_auth_canonical_string( array $fields ): string {
	return implode(
		"\n",
		[
			(string) ( $fields['version'] ?? '' ),
			(string) ( $fields['key_id'] ?? '' ),
			(string) ( $fields['project_slug'] ?? '' ),
			(string) ( $fields['timestamp'] ?? '' ),
			(string) ( $fields['request_id'] ?? '' ),
			factory_agent_signed_auth_normalize_method( (string) ( $fields['method'] ?? '' ) ),
			factory_agent_signed_auth_normalize_rest_path( (string) ( $fields['path'] ?? '' ) ),
			factory_agent_signed_auth_canonical_query( (string) ( $fields['query'] ?? '' ) ),
			(string) ( $fields['body_hash'] ?? '' ),
		]
	);
}

function factory_agent_signed_auth_secret_bytes( string $secret ): string {
	if ( preg_match( '/^[A-Za-z0-9_-]+$/', $secret ) ) {
		$base64 = strtr( $secret, '-_', '+/' );
		$padding = strlen( $base64 ) % 4;
		if ( 0 !== $padding ) {
			$base64 .= str_repeat( '=', 4 - $padding );
		}
		$decoded = base64_decode( $base64, true );
		if ( is_string( $decoded ) && strlen( $decoded ) >= 32 ) {
			return $decoded;
		}
	}

	return $secret;
}

function factory_agent_signed_auth_signature( string $secret, string $canonical_string ): string {
	$raw = hash_hmac( 'sha256', $canonical_string, factory_agent_signed_auth_secret_bytes( $secret ), true );
	return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
}

function factory_agent_signed_auth_redact_credential( array $credential ): array {
	if ( array_key_exists( 'signing_secret', $credential ) ) {
		$credential['signing_secret'] = '[redacted]';
	}

	return $credential;
}

function factory_agent_signed_auth_sanitize_credential_metadata( array $credential ): array {
	return [
		'contract_version' => sanitize_text_field( (string) ( $credential['contract_version'] ?? '' ) ),
		'key_id'           => sanitize_text_field( (string) ( $credential['key_id'] ?? '' ) ),
		'status'           => sanitize_key( (string) ( $credential['status'] ?? '' ) ),
		'created_at'       => sanitize_text_field( (string) ( $credential['created_at'] ?? '' ) ),
		'revoked_at'       => isset( $credential['revoked_at'] ) && null !== $credential['revoked_at'] ? sanitize_text_field( (string) $credential['revoked_at'] ) : null,
		'capabilities'     => array_values( array_map( 'sanitize_text_field', is_array( $credential['capabilities'] ?? null ) ? $credential['capabilities'] : [] ) ),
		'project_slug'     => sanitize_key( (string) ( $credential['project_slug'] ?? '' ) ),
	];
}

function factory_agent_signed_auth_validate_credential_record( array $credential ) {
	if ( FACTORY_AGENT_SIGNED_AUTH_VERSION !== ( $credential['contract_version'] ?? '' ) ) {
		return factory_agent_signed_auth_error( 'agent_signed_auth_bootstrap_invalid', 400 );
	}

	if ( ! is_string( $credential['key_id'] ?? null ) || '' === trim( $credential['key_id'] ) ) {
		return factory_agent_signed_auth_error( 'agent_signed_auth_bootstrap_invalid', 400 );
	}

	if ( ! is_string( $credential['signing_secret'] ?? null ) || '' === trim( $credential['signing_secret'] ) ) {
		return factory_agent_signed_auth_error( 'agent_signed_auth_bootstrap_invalid', 400 );
	}

	if ( strlen( factory_agent_signed_auth_secret_bytes( (string) $credential['signing_secret'] ) ) < 32 ) {
		return factory_agent_signed_auth_error( 'agent_signed_auth_bootstrap_invalid', 400 );
	}

	$capabilities = is_array( $credential['capabilities'] ?? null ) ? $credential['capabilities'] : [];
	$allowed = factory_agent_signed_auth_capabilities();
	foreach ( $capabilities as $capability ) {
		if ( ! is_string( $capability ) || ! in_array( $capability, $allowed, true ) ) {
			return factory_agent_signed_auth_error( 'agent_signed_auth_bootstrap_invalid', 400 );
		}
	}

	if ( ! is_string( $credential['project_slug'] ?? null ) || '' === trim( $credential['project_slug'] ) ) {
		return factory_agent_signed_auth_error( 'agent_signed_auth_bootstrap_invalid', 400 );
	}

	return true;
}

function factory_agent_signed_auth_get_stored_credentials(): array {
	$stored = get_option( FACTORY_AGENT_SIGNED_AUTH_OPTION, [] );
	if ( ! is_array( $stored ) ) {
		return [];
	}

	return $stored;
}

function factory_agent_signed_auth_store_credential( array $credential ) {
	$validation = factory_agent_signed_auth_validate_credential_record( $credential );
	if ( is_wp_error( $validation ) ) {
		return $validation;
	}

	$stored = factory_agent_signed_auth_get_stored_credentials();
	$active = array_values(
		array_filter(
			$stored,
			static function ( $candidate ): bool {
				return is_array( $candidate ) && 'active' === ( $candidate['status'] ?? '' );
			}
		)
	);

	foreach ( $active as $candidate ) {
		if ( (string) ( $candidate['key_id'] ?? '' ) === (string) $credential['key_id'] ) {
			$same_secret = hash_equals( (string) ( $candidate['signing_secret'] ?? '' ), (string) $credential['signing_secret'] );
			$same_capabilities = array_values( $candidate['capabilities'] ?? [] ) === array_values( $credential['capabilities'] ?? [] );
			$candidate_project = (string) ( $candidate['project_slug'] ?? '' );
			$incoming_project = (string) ( $credential['project_slug'] ?? '' );
			$same_project = $candidate_project === $incoming_project;
			if ( $same_secret && $same_capabilities && $same_project ) {
				return [
					'status'     => 'ok',
					'code'       => 'agent_auth_bootstrap_already_configured',
					'credential' => factory_agent_signed_auth_sanitize_credential_metadata( $candidate ),
				];
			}

			if ( $same_secret && $same_project ) {
				foreach ( $stored as $index => $stored_candidate ) {
					if ( is_array( $stored_candidate ) && (string) ( $stored_candidate['key_id'] ?? '' ) === (string) $credential['key_id'] ) {
						$stored[ $index ]['capabilities'] = array_values( $credential['capabilities'] ?? [] );
						update_option( FACTORY_AGENT_SIGNED_AUTH_OPTION, $stored, false );
						return [
							'status'     => 'ok',
							'code'       => 'agent_auth_bootstrap_capabilities_updated',
							'credential' => factory_agent_signed_auth_sanitize_credential_metadata( $stored[ $index ] ),
						];
					}
				}
			}

			if ( $same_secret && $same_capabilities && '' === $candidate_project && '' !== $incoming_project ) {
				foreach ( $stored as $index => $stored_candidate ) {
					if ( is_array( $stored_candidate ) && (string) ( $stored_candidate['key_id'] ?? '' ) === (string) $credential['key_id'] ) {
						$stored[ $index ]['project_slug'] = $incoming_project;
						update_option( FACTORY_AGENT_SIGNED_AUTH_OPTION, $stored, false );
						return [
							'status'     => 'ok',
							'code'       => 'agent_auth_bootstrap_project_bound',
							'credential' => factory_agent_signed_auth_sanitize_credential_metadata( $stored[ $index ] ),
						];
					}
				}
			}

			return factory_agent_signed_auth_error( 'agent_auth_bootstrap_conflict', 409 );
		}
	}

	if ( ! empty( $active ) ) {
		return factory_agent_signed_auth_error( 'agent_auth_bootstrap_conflict', 409 );
	}

	$credential['status'] = 'active';
	$stored[] = $credential;
	update_option( FACTORY_AGENT_SIGNED_AUTH_OPTION, $stored, false );

	return [
		'status'     => 'ok',
		'code'       => 'agent_auth_bootstrap_created',
		'credential' => factory_agent_signed_auth_sanitize_credential_metadata( $credential ),
	];
}

function factory_agent_signed_auth_capabilities_subset( array $candidate, array $allowed ): bool {
	foreach ( $candidate as $capability ) {
		if ( ! in_array( $capability, $allowed, true ) ) {
			return false;
		}
	}

	return true;
}

function factory_agent_signed_auth_active_project_credentials( string $project_slug ): array {
	return array_values(
		array_filter(
			factory_agent_signed_auth_get_stored_credentials(),
			static function ( $candidate ) use ( $project_slug ): bool {
				return is_array( $candidate )
					&& 'active' === ( $candidate['status'] ?? '' )
					&& (string) ( $candidate['project_slug'] ?? '' ) === $project_slug;
			}
		)
	);
}

function factory_agent_signed_auth_sanitized_active_keys( string $project_slug ): array {
	return array_values(
		array_map(
			'factory_agent_signed_auth_sanitize_credential_metadata',
			factory_agent_signed_auth_active_project_credentials( $project_slug )
		)
	);
}

function factory_agent_signed_auth_register_rotation_credential( array $credential, array $auth_context ) {
	$validation = factory_agent_signed_auth_validate_credential_record( $credential );
	if ( is_wp_error( $validation ) ) {
		return $validation;
	}

	$project_slug = (string) ( $auth_context['project_slug'] ?? '' );
	if ( '' === $project_slug || $project_slug !== (string) ( $credential['project_slug'] ?? '' ) ) {
		return factory_agent_signed_auth_error( 'agent_auth_rotation_project_mismatch', 403 );
	}

	$current = factory_agent_signed_auth_resolve_credential( (string) ( $auth_context['key_id'] ?? '' ) );
	if ( ! is_array( $current ) || 'active' !== ( $current['status'] ?? '' ) || (string) ( $current['project_slug'] ?? '' ) !== $project_slug ) {
		return factory_agent_signed_auth_error( 'agent_auth_rotation_current_key_invalid', 403 );
	}

	if ( (string) ( $credential['key_id'] ?? '' ) === (string) ( $current['key_id'] ?? '' ) ) {
		return factory_agent_signed_auth_error( 'agent_auth_rotation_invalid', 400 );
	}

	$current_capabilities = is_array( $current['capabilities'] ?? null ) ? array_values( $current['capabilities'] ) : [];
	$new_capabilities = is_array( $credential['capabilities'] ?? null ) ? array_values( $credential['capabilities'] ) : [];
	if ( ! factory_agent_signed_auth_capabilities_subset( $new_capabilities, $current_capabilities ) ) {
		return factory_agent_signed_auth_error( 'agent_auth_rotation_capability_expansion_denied', 403 );
	}

	$stored = factory_agent_signed_auth_get_stored_credentials();
	foreach ( $stored as $candidate ) {
		if ( ! is_array( $candidate ) || (string) ( $candidate['key_id'] ?? '' ) !== (string) $credential['key_id'] ) {
			continue;
		}

		$same_secret = hash_equals( (string) ( $candidate['signing_secret'] ?? '' ), (string) $credential['signing_secret'] );
		$same_capabilities = array_values( $candidate['capabilities'] ?? [] ) === $new_capabilities;
		$same_project = (string) ( $candidate['project_slug'] ?? '' ) === $project_slug;
		if ( $same_secret && $same_capabilities && $same_project && 'active' === ( $candidate['status'] ?? '' ) ) {
			return [
				'status'      => 'ok',
				'code'        => 'agent_auth_rotation_already_registered',
				'credential'  => factory_agent_signed_auth_sanitize_credential_metadata( $candidate ),
				'active_keys' => factory_agent_signed_auth_sanitized_active_keys( $project_slug ),
			];
		}

		return factory_agent_signed_auth_error( 'agent_auth_rotation_conflict', 409 );
	}

	if ( count( factory_agent_signed_auth_active_project_credentials( $project_slug ) ) >= 2 ) {
		return factory_agent_signed_auth_error( 'agent_auth_rotation_too_many_active_keys', 409 );
	}

	$credential['status'] = 'active';
	$stored[] = $credential;
	update_option( FACTORY_AGENT_SIGNED_AUTH_OPTION, $stored, false );

	return [
		'status'      => 'ok',
		'code'        => 'agent_auth_rotation_registered',
		'credential'  => factory_agent_signed_auth_sanitize_credential_metadata( $credential ),
		'active_keys' => factory_agent_signed_auth_sanitized_active_keys( $project_slug ),
	];
}

function factory_agent_signed_auth_revoke_key( string $key_id, array $auth_context ) {
	$key_id = sanitize_text_field( $key_id );
	if ( '' === $key_id ) {
		return factory_agent_signed_auth_error( 'agent_auth_revoke_invalid', 400 );
	}

	$project_slug = (string) ( $auth_context['project_slug'] ?? '' );
	if ( '' === $project_slug ) {
		return factory_agent_signed_auth_error( 'agent_auth_revoke_project_required', 403 );
	}

	$stored = factory_agent_signed_auth_get_stored_credentials();
	foreach ( $stored as $index => $candidate ) {
		if ( ! is_array( $candidate ) || (string) ( $candidate['key_id'] ?? '' ) !== $key_id ) {
			continue;
		}
		if ( (string) ( $candidate['project_slug'] ?? '' ) !== $project_slug ) {
			return factory_agent_signed_auth_error( 'agent_auth_revoke_project_mismatch', 403 );
		}

		if ( 'revoked' === ( $candidate['status'] ?? '' ) || ! empty( $candidate['revoked_at'] ) ) {
			return [
				'status'      => 'ok',
				'code'        => 'agent_auth_revoke_already_revoked',
				'credential'  => factory_agent_signed_auth_sanitize_credential_metadata( $candidate ),
				'active_keys' => factory_agent_signed_auth_sanitized_active_keys( $project_slug ),
			];
		}

		$stored[ $index ]['status'] = 'revoked';
		$stored[ $index ]['revoked_at'] = gmdate( 'Y-m-d\TH:i:s\Z' );
		update_option( FACTORY_AGENT_SIGNED_AUTH_OPTION, $stored, false );

		return [
			'status'      => 'ok',
			'code'        => 'agent_auth_revoke_completed',
			'credential'  => factory_agent_signed_auth_sanitize_credential_metadata( $stored[ $index ] ),
			'active_keys' => factory_agent_signed_auth_sanitized_active_keys( $project_slug ),
		];
	}

	return factory_agent_signed_auth_error( 'agent_auth_revoke_key_unknown', 404 );
}

function factory_agent_signed_auth_error( string $code, int $status = 401 ): WP_Error {
	return new WP_Error(
		$code,
		'Signed Launcher authentication failed.',
		[
			'status' => $status,
			'code'   => $code,
		]
	);
}

function factory_agent_signed_auth_header_value( WP_REST_Request $request, string $header ): array {
	$headers = $request->get_headers();
	$key = strtolower( $header );
	$values = [];

	foreach ( $headers as $name => $value ) {
		$normalized_name = str_replace( '_', '-', strtolower( (string) $name ) );
		if ( $normalized_name !== $key ) {
			continue;
		}
		if ( is_array( $value ) ) {
			$values = array_merge( $values, $value );
		} else {
			$values[] = $value;
		}
	}

	if ( 1 !== count( $values ) ) {
		return [ 'error' => 0 === count( $values ) ? 'missing' : 'duplicate' ];
	}

	$value = trim( (string) $values[0] );
	if ( '' === $value || str_contains( $value, ',' ) ) {
		return [ 'error' => 'invalid' ];
	}

	return [ 'value' => $value ];
}

function factory_agent_signed_auth_read_headers( WP_REST_Request $request ) {
	$out = [];
	foreach ( factory_agent_signed_auth_headers() as $field => $header ) {
		$result = factory_agent_signed_auth_header_value( $request, $header );
		if ( isset( $result['error'] ) ) {
			$missing_code = 'project_slug' === $field ? 'signed_auth_project_required' : 'signed_auth_required';
			$invalid_code = 'project_slug' === $field && 'invalid' === $result['error'] ? 'signed_auth_project_required' : 'signed_auth_header_invalid';
			return factory_agent_signed_auth_error(
				'missing' === $result['error'] ? $missing_code : $invalid_code
			);
		}
		$out[ $field ] = $result['value'];
	}

	return $out;
}

function factory_agent_signed_auth_lookup_capability( string $method, string $path ): ?string {
	$key = factory_agent_signed_auth_normalize_method( $method ) . ' ' . factory_agent_signed_auth_normalize_rest_path( $path );
	$registry = factory_agent_signed_auth_route_capabilities();

	return $registry[ $key ] ?? null;
}

function factory_agent_signed_auth_resolve_credential( string $key_id ): ?array {
	$credentials = apply_filters( 'factory_agent_signed_auth_credentials', factory_agent_signed_auth_get_stored_credentials(), $key_id );
	if ( ! is_array( $credentials ) ) {
		return null;
	}

	if ( isset( $credentials['key_id'] ) && (string) $credentials['key_id'] === $key_id ) {
		return $credentials;
	}

	foreach ( $credentials as $credential ) {
		if ( is_array( $credential ) && (string) ( $credential['key_id'] ?? '' ) === $key_id ) {
			return $credential;
		}
	}

	return null;
}

function factory_agent_signed_auth_replay_option_name( string $key_id, string $request_id ): string {
	return 'factory_agent_replay_' . hash( 'sha256', $key_id . "\n" . $request_id );
}

function factory_agent_signed_auth_replay_claim( string $key_id, string $request_id, int $expires_at, int $now ): bool {
	$option = factory_agent_signed_auth_replay_option_name( $key_id, $request_id );
	$existing = get_option( $option, null );

	if ( null !== $existing ) {
		$existing_expiry = (int) $existing;
		if ( $existing_expiry > $now ) {
			return false;
		}
		delete_option( $option );
	}

	return add_option( $option, (string) $expires_at, '', 'no' );
}

function factory_agent_signed_auth_cleanup_replay_store( int $now ): void {
	global $wpdb;

	if ( ! isset( $wpdb ) || ! $wpdb ) {
		return;
	}

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND CAST(option_value AS UNSIGNED) <= %d",
			$wpdb->esc_like( 'factory_agent_replay_' ) . '%',
			$now
		)
	);
}

function factory_agent_signed_auth_verify( WP_REST_Request $request, ?string $required_capability = null, array $options = [] ) {
	$headers = factory_agent_signed_auth_read_headers( $request );
	if ( is_wp_error( $headers ) ) {
		return $headers;
	}

	if ( FACTORY_AGENT_SIGNED_AUTH_VERSION !== $headers['version'] ) {
		return factory_agent_signed_auth_error( 'signed_auth_header_invalid' );
	}

	$credential = $options['credential'] ?? factory_agent_signed_auth_resolve_credential( $headers['key_id'] );
	if ( ! is_array( $credential ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_key_unknown' );
	}
	if ( ! empty( $credential['revoked_at'] ) || 'revoked' === ( $credential['status'] ?? '' ) || ( isset( $credential['status'] ) && 'active' !== $credential['status'] ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_key_revoked' );
	}
	if ( '' === (string) ( $headers['project_slug'] ?? '' ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_project_required' );
	}
	if ( '' === (string) ( $credential['project_slug'] ?? '' ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_project_required' );
	}
	if ( (string) $credential['project_slug'] !== (string) $headers['project_slug'] ) {
		return factory_agent_signed_auth_error( 'signed_auth_project_mismatch' );
	}

	$timestamp = strtotime( $headers['timestamp'] );
	if ( false === $timestamp || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/', $headers['timestamp'] ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_timestamp_invalid' );
	}

	$now = isset( $options['now'] ) ? (int) $options['now'] : time();
	$freshness = isset( $options['freshness_seconds'] ) ? (int) $options['freshness_seconds'] : FACTORY_AGENT_SIGNED_AUTH_FRESHNESS_SECONDS;
	$skew = isset( $options['clock_skew_seconds'] ) ? (int) $options['clock_skew_seconds'] : FACTORY_AGENT_SIGNED_AUTH_CLOCK_SKEW_SECONDS;
	if ( $timestamp < ( $now - $freshness ) || $timestamp > ( $now + $skew ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_request_expired' );
	}

	$body = (string) $request->get_body();
	$actual_hash = factory_agent_signed_auth_body_hash( $body );
	if ( ! hash_equals( $actual_hash, $headers['body_hash'] ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_body_hash_mismatch' );
	}

	$route = $request->get_route();
	$query = isset( $options['query'] ) ? (string) $options['query'] : '';
	$canonical = factory_agent_signed_auth_canonical_string(
		[
			'version'    => $headers['version'],
			'key_id'     => $headers['key_id'],
			'project_slug' => $headers['project_slug'],
			'timestamp'  => $headers['timestamp'],
			'request_id' => $headers['request_id'],
			'method'     => $request->get_method(),
			'path'       => $route,
			'query'      => $query,
			'body_hash'  => $headers['body_hash'],
		]
	);

	$expected = factory_agent_signed_auth_signature( (string) ( $credential['signing_secret'] ?? '' ), $canonical );
	if ( ! hash_equals( $expected, $headers['signature'] ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_signature_invalid' );
	}

	$capability = $required_capability ?: factory_agent_signed_auth_lookup_capability( $request->get_method(), $route );
	if ( null === $capability ) {
		return factory_agent_signed_auth_error( 'signed_auth_capability_denied', 403 );
	}

	$allowed = is_array( $credential['capabilities'] ?? null ) ? $credential['capabilities'] : [];
	if ( ! in_array( $capability, $allowed, true ) ) {
		return factory_agent_signed_auth_error( 'signed_auth_capability_denied', 403 );
	}

	if ( empty( $options['skip_replay'] ) ) {
		$claimed = factory_agent_signed_auth_replay_claim( $headers['key_id'], $headers['request_id'], $timestamp + $freshness, $now );
		if ( ! $claimed ) {
			return factory_agent_signed_auth_error( 'signed_auth_replay_detected', 409 );
		}
	}

	return [
		'auth_type'        => 'factory_agent_signed_request',
		'contract_version' => FACTORY_AGENT_SIGNED_AUTH_VERSION,
		'key_id'           => $headers['key_id'],
		'project_slug'     => $headers['project_slug'],
		'request_id'       => $headers['request_id'],
		'timestamp'        => $headers['timestamp'],
		'capability'       => $capability,
	];
}

function factory_rest_require_signed_launcher( WP_REST_Request $request ) {
	$auth = factory_agent_signed_auth_verify( $request );
	if ( ! is_wp_error( $auth ) ) {
		$request->set_param( '_factory_signed_auth_context', $auth );
		return true;
	}

	return $auth;
}

function factory_rest_require_signed_launcher_or_legacy_admin( WP_REST_Request $request, ?string $required_capability = null, bool $allow_legacy_admin = true ) {
	$auth = factory_agent_signed_auth_verify( $request, $required_capability );
	if ( ! is_wp_error( $auth ) ) {
		$request->set_param( '_factory_signed_auth_context', $auth );
		return true;
	}

	if ( $allow_legacy_admin && current_user_can( 'manage_options' ) ) {
		$request->set_param(
			'_factory_signed_auth_context',
			[
				'auth_type' => 'legacy_admin_fallback',
				'code'      => $auth->get_error_code(),
			]
		);
		return true;
	}

	return $auth;
}
