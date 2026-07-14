<?php

define( 'ABSPATH', __DIR__ );

class WP_Error {
	private string $code;
	private string $message;
	private $data;

	public function __construct( string $code, string $message = '', $data = null ) {
		$this->code = $code;
		$this->message = $message;
		$this->data = $data;
	}

	public function get_error_code(): string {
		return $this->code;
	}

	public function get_error_data() {
		return $this->data;
	}
}

class WP_REST_Request {
	private string $method;
	private string $route;
	private string $body;
	private array $headers;
	private array $params = [];

	public function __construct( string $method, string $route, string $body = '', array $headers = [] ) {
		$this->method = $method;
		$this->route = $route;
		$this->body = $body;
		$this->headers = $headers;
	}

	public function get_method(): string {
		return $this->method;
	}

	public function get_route(): string {
		return $this->route;
	}

	public function get_body(): string {
		return $this->body;
	}

	public function get_headers(): array {
		return $this->headers;
	}

	public function get_header( string $name ): string {
		$needle = strtolower( $name );
		foreach ( $this->headers as $key => $value ) {
			if ( strtolower( (string) $key ) === $needle ) {
				return is_array( $value ) ? (string) ( $value[0] ?? '' ) : (string) $value;
			}
		}
		return '';
	}

	public function set_param( string $name, $value ): void {
		$this->params[ $name ] = $value;
	}
}

function is_wp_error( $value ): bool {
	return $value instanceof WP_Error;
}

function sanitize_text_field( $value ): string {
	return trim( (string) $value );
}

function sanitize_key( $value ): string {
	return strtolower( preg_replace( '/[^a-z0-9_\-]/', '', (string) $value ) );
}

function apply_filters( $hook, $value ) {
	return $value;
}

if ( ! function_exists( 'wp_parse_url' ) ) {
	function wp_parse_url( $url, $component = -1 ) {
		return parse_url( $url, $component );
	}
}

$GLOBALS['factory_test_options'] = [];

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['factory_test_options'] ) ? $GLOBALS['factory_test_options'][ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ): bool {
	$GLOBALS['factory_test_options'][ $name ] = $value;
	return true;
}

function add_option( $name, $value, $deprecated = '', $autoload = 'yes' ): bool {
	if ( array_key_exists( $name, $GLOBALS['factory_test_options'] ) ) {
		return false;
	}
	$GLOBALS['factory_test_options'][ $name ] = $value;
	return true;
}

function delete_option( $name ): bool {
	unset( $GLOBALS['factory_test_options'][ $name ] );
	return true;
}

require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/security/signed-auth.php';

function code_for( $value ): string {
	return is_wp_error( $value ) ? $value->get_error_code() : 'ok';
}

$json_request = new WP_REST_Request(
	'POST',
	'/factory/v1/agent/safe-fields/apply',
	'{"agency_name":"Alpha"}',
	[ 'content-type' => 'application/json; charset=utf-8' ]
);
$wrong_type = new WP_REST_Request(
	'POST',
	'/factory/v1/agent/safe-fields/apply',
	'{"agency_name":"Alpha"}',
	[ 'content-type' => 'text/plain' ]
);
$oversized = new WP_REST_Request(
	'POST',
	'/factory/v1/agent/safe-fields/apply',
	str_repeat( 'a', FACTORY_AGENT_SIGNED_AUTH_MAX_BODY_BYTES + 1 ),
	[ 'content-type' => 'application/json' ]
);

for ( $i = 0; $i < 30; $i++ ) {
	factory_agent_signed_auth_rate_limit_claim( 'key-alpha', 'state.apply', 1893456000 );
}
$rate_limited = factory_agent_signed_auth_rate_limit_claim( 'key-alpha', 'state.apply', 1893456000 );

echo json_encode(
	[
		'json_content_type_code' => code_for( factory_agent_signed_auth_validate_request_limits( $json_request ) ),
		'wrong_content_type_code' => code_for( factory_agent_signed_auth_validate_request_limits( $wrong_type ) ),
		'oversized_body_code'    => code_for( factory_agent_signed_auth_validate_request_limits( $oversized ) ),
		'rate_limited_code'      => code_for( $rate_limited ),
		'rate_limited_status'    => is_wp_error( $rate_limited ) ? (int) ( $rate_limited->get_error_data()['status'] ?? 0 ) : 0,
		'rate_limited_retry_after_present' => is_wp_error( $rate_limited ) && isset( $rate_limited->get_error_data()['retry_after'] ),
	],
	JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
) . "\n";
