<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FACTORY_AGENT_SIGNED_AUTH_VERSION = 'factory-agent-hmac-v1';
const FACTORY_AGENT_SIGNED_AUTH_FRESHNESS_SECONDS = 300;
const FACTORY_AGENT_SIGNED_AUTH_CLOCK_SKEW_SECONDS = 30;

function factory_agent_signed_auth_headers(): array {
	return [
		'version'   => 'x-factory-agent-auth-version',
		'key_id'    => 'x-factory-agent-key-id',
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
	];
}

function factory_agent_signed_auth_route_capabilities(): array {
	return [
		'GET /factory/v1/agent/health'              => 'health.read',
		'GET /factory/v1/agent/capabilities'        => 'capabilities.read',
		'GET /factory/v1/agent/dependencies'        => 'dependencies.read',
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
		if ( strtolower( (string) $name ) !== $key ) {
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
			return factory_agent_signed_auth_error(
				'missing' === $result['error'] ? 'signed_auth_required' : 'signed_auth_header_invalid'
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
	$credentials = apply_filters( 'factory_agent_signed_auth_credentials', [], $key_id );
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
		'request_id'       => $headers['request_id'],
		'timestamp'        => $headers['timestamp'],
		'capability'       => $capability,
		'project_slug'     => $credential['project_slug'] ?? null,
	];
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
