<?php

define( 'ABSPATH', __DIR__ );

if ( ! function_exists( 'wp_parse_url' ) ) {
	function wp_parse_url( $url, $component = -1 ) {
		return parse_url( $url, $component );
	}
}

require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/security/signed-auth.php';

$input = json_decode( stream_get_contents( STDIN ), true );
if ( ! is_array( $input ) ) {
	fwrite( STDERR, "invalid json\n" );
	exit( 1 );
}

$body_hash = factory_agent_signed_auth_body_hash( (string) ( $input['body'] ?? '' ) );
$canonical = factory_agent_signed_auth_canonical_string(
	[
		'version'    => (string) ( $input['version'] ?? '' ),
		'key_id'     => (string) ( $input['key_id'] ?? '' ),
		'timestamp'  => (string) ( $input['timestamp'] ?? '' ),
		'request_id' => (string) ( $input['request_id'] ?? '' ),
		'method'     => (string) ( $input['method'] ?? '' ),
		'path'       => (string) ( $input['path'] ?? '' ),
		'query'      => (string) ( $input['query'] ?? '' ),
		'body_hash'  => $body_hash,
	]
);

echo json_encode(
	[
		'body_hash'  => $body_hash,
		'canonical'  => $canonical,
		'signature'  => factory_agent_signed_auth_signature( (string) ( $input['secret'] ?? '' ), $canonical ),
		'capability' => factory_agent_signed_auth_lookup_capability( (string) ( $input['method'] ?? '' ), (string) ( $input['path'] ?? '' ) ),
	],
	JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
) . "\n";
