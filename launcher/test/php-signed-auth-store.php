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

if ( ! function_exists( 'wp_parse_url' ) ) {
	function wp_parse_url( $url, $component = -1 ) {
		return parse_url( $url, $component );
	}
}

require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/security/signed-auth.php';

$base = [
	'schema'           => 'factory_agent_signing_credential',
	'version'          => 1,
	'contract_version' => FACTORY_AGENT_SIGNED_AUTH_VERSION,
	'key_id'           => 'key-alpha',
	'signing_secret'   => str_repeat( 'a', 43 ),
	'status'           => 'active',
	'created_at'       => '2026-07-13T00:00:00.000Z',
	'revoked_at'       => null,
	'capabilities'     => factory_agent_signed_auth_capabilities(),
	'project_slug'     => 'project-alpha',
];

$created = factory_agent_signed_auth_store_credential( $base );
$again = factory_agent_signed_auth_store_credential( $base );
$different_secret = $base;
$different_secret['signing_secret'] = str_repeat( 'b', 43 );
$conflict = factory_agent_signed_auth_store_credential( $different_secret );
$different_key = $base;
$different_key['key_id'] = 'key-beta';
$different_key_conflict = factory_agent_signed_auth_store_credential( $different_key );
$capabilities_update = $base;
$capabilities_update['capabilities'] = array_values( array_merge( $base['capabilities'], [] ) );
$capabilities_update['capabilities'] = array_values( array_filter(
	$capabilities_update['capabilities'],
	static function ( string $capability ): bool {
		return 'ai.enable_live' !== $capability;
	}
) );
$capabilities_updated = factory_agent_signed_auth_store_credential( $capabilities_update );

$GLOBALS['factory_test_options'] = [];
$unbound = $base;
$unbound['project_slug'] = '';
$GLOBALS['factory_test_options'][ FACTORY_AGENT_SIGNED_AUTH_OPTION ] = [ $unbound ];
$bound_migration = factory_agent_signed_auth_store_credential( $base );
$bound_again = factory_agent_signed_auth_store_credential( $base );
$replace_bound = $base;
$replace_bound['project_slug'] = 'project-beta';
$replace_bound_conflict = factory_agent_signed_auth_store_credential( $replace_bound );

$GLOBALS['factory_test_options'] = [];
$rotation_current = $base;
$rotation_current['key_id'] = 'rotation-old';
$rotation_current['signing_secret'] = str_repeat( 'c', 43 );
$rotation_current['capabilities'] = [ 'health.read', 'capabilities.read', 'auth.rotate', 'auth.revoke' ];
factory_agent_signed_auth_store_credential( $rotation_current );
$rotation_context = [
	'key_id'       => 'rotation-old',
	'project_slug' => 'project-alpha',
];
$rotation_new = $base;
$rotation_new['key_id'] = 'rotation-new';
$rotation_new['signing_secret'] = str_repeat( 'd', 43 );
$rotation_new['capabilities'] = $rotation_current['capabilities'];
$rotation_registered = factory_agent_signed_auth_register_rotation_credential( $rotation_new, $rotation_context );
$rotation_again = factory_agent_signed_auth_register_rotation_credential( $rotation_new, $rotation_context );
$rotation_expand = $rotation_new;
$rotation_expand['key_id'] = 'rotation-expand';
$rotation_expand['capabilities'] = array_merge( $rotation_current['capabilities'], [ 'generate.apply' ] );
$rotation_expand_result = factory_agent_signed_auth_register_rotation_credential( $rotation_expand, $rotation_context );
$rotation_wrong_project = $rotation_new;
$rotation_wrong_project['key_id'] = 'rotation-wrong-project';
$rotation_wrong_project['project_slug'] = 'project-beta';
$rotation_wrong_project_result = factory_agent_signed_auth_register_rotation_credential( $rotation_wrong_project, $rotation_context );
$rotation_revoked_old = factory_agent_signed_auth_revoke_key( 'rotation-old', [
	'key_id'       => 'rotation-new',
	'project_slug' => 'project-alpha',
] );
$rotation_revoke_again = factory_agent_signed_auth_revoke_key( 'rotation-old', [
	'key_id'       => 'rotation-new',
	'project_slug' => 'project-alpha',
] );
$rotation_active_after_revoke = factory_agent_signed_auth_sanitized_active_keys( 'project-alpha' );

echo json_encode(
	[
		'created_code'                => is_wp_error( $created ) ? $created->get_error_code() : $created['code'],
		'again_code'                  => is_wp_error( $again ) ? $again->get_error_code() : $again['code'],
		'different_secret_code'       => is_wp_error( $conflict ) ? $conflict->get_error_code() : $conflict['code'],
		'different_active_key_code'   => is_wp_error( $different_key_conflict ) ? $different_key_conflict->get_error_code() : $different_key_conflict['code'],
		'capabilities_updated_code'   => is_wp_error( $capabilities_updated ) ? $capabilities_updated->get_error_code() : $capabilities_updated['code'],
		'bound_migration_code'        => is_wp_error( $bound_migration ) ? $bound_migration->get_error_code() : $bound_migration['code'],
		'bound_again_code'            => is_wp_error( $bound_again ) ? $bound_again->get_error_code() : $bound_again['code'],
		'replace_bound_code'          => is_wp_error( $replace_bound_conflict ) ? $replace_bound_conflict->get_error_code() : $replace_bound_conflict['code'],
		'created_contains_secret'     => str_contains( json_encode( $created ), $base['signing_secret'] ),
		'again_contains_secret'       => str_contains( json_encode( $again ), $base['signing_secret'] ),
		'migration_contains_secret'   => str_contains( json_encode( $bound_migration ), $base['signing_secret'] ),
		'rotation_registered_code'    => is_wp_error( $rotation_registered ) ? $rotation_registered->get_error_code() : $rotation_registered['code'],
		'rotation_again_code'         => is_wp_error( $rotation_again ) ? $rotation_again->get_error_code() : $rotation_again['code'],
		'rotation_expand_code'        => is_wp_error( $rotation_expand_result ) ? $rotation_expand_result->get_error_code() : $rotation_expand_result['code'],
		'rotation_wrong_project_code' => is_wp_error( $rotation_wrong_project_result ) ? $rotation_wrong_project_result->get_error_code() : $rotation_wrong_project_result['code'],
		'rotation_revoke_code'        => is_wp_error( $rotation_revoked_old ) ? $rotation_revoked_old->get_error_code() : $rotation_revoked_old['code'],
		'rotation_revoke_again_code'  => is_wp_error( $rotation_revoke_again ) ? $rotation_revoke_again->get_error_code() : $rotation_revoke_again['code'],
		'rotation_active_key_ids'     => array_values( array_map(
			static function ( array $credential ): string {
				return (string) $credential['key_id'];
			},
			$rotation_active_after_revoke
		) ),
		'rotation_contains_secret'    => str_contains( json_encode( $rotation_registered ), $rotation_new['signing_secret'] )
	],
	JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
) . "\n";
