<?php

$nonce = getenv( 'CSF_VIEWING_DATE_OBSERVATION_NONCE' );
$admin_login = getenv( 'CSF_VIEWING_DATE_ADMIN_LOGIN' );
if ( ! is_string( $nonce ) || ! preg_match( '/^[a-f0-9]{64}$/', $nonce ) || ! is_string( $admin_login ) || '' === $admin_login ) { echo '{}'; return; }

$fields = array( 'schema', 'version', 'contract_version', 'key_id', 'status', 'created_at', 'revoked_at', 'capabilities', 'project_slug' );
$keys = array_merge( $fields, array( 'signing_secret' ) ); sort( $keys, SORT_STRING );
$stored = get_option( 'factory_agent_signed_auth_credentials', null );
if ( ! is_array( $stored ) || count( $stored ) < 1 || count( $stored ) > 32 ) { echo '{}'; return; }
$credentials = array(); $credential_hmac = array();
foreach ( $stored as $record ) {
	if ( ! is_array( $record ) ) { echo '{}'; return; }
	$record_keys = array_keys( $record ); sort( $record_keys, SORT_STRING );
	if ( $record_keys !== $keys || ! is_string( $record['signing_secret'] ) || '' === $record['signing_secret'] ) { echo '{}'; return; }
	$metadata = array(); foreach ( $fields as $field ) { $metadata[ $field ] = $record[ $field ]; }
	$credentials[] = $metadata; $credential_hmac[] = hash_hmac( 'sha256', $nonce, factory_agent_signed_auth_secret_bytes( $record['signing_secret'] ) );
}
usort( $credentials, static function ( array $left, array $right ): int { return strcmp( (string) $left['key_id'], (string) $right['key_id'] ); } );
sort( $credential_hmac, SORT_STRING );

$user = get_user_by( 'login', $admin_login );
if ( ! $user ) { echo '{}'; return; }
$passwords = get_user_meta( (int) $user->ID, '_application_passwords', true );
if ( ! is_array( $passwords ) || count( $passwords ) > 128 ) { echo '{}'; return; }
$applications = array();
foreach ( $passwords as $password ) {
	if ( ! is_array( $password ) || ! isset( $password['uuid'] ) ) { echo '{}'; return; }
	$applications[] = array( 'uuid' => (string) $password['uuid'], 'app_id' => (string) ( $password['app_id'] ?? '' ), 'name' => (string) ( $password['name'] ?? '' ), 'created' => (int) ( $password['created'] ?? 0 ), 'last_used' => $password['last_used'] ?? null, 'last_ip' => $password['last_ip'] ?? null );
}
usort( $applications, static function ( array $left, array $right ): int { return strcmp( $left['uuid'], $right['uuid'] ); } );

global $wpdb;
$rows = $wpdb->get_results( $wpdb->prepare( "SELECT option_name, option_value, autoload FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'factory_agent_' ) . '%' ), ARRAY_A );
if ( ! is_array( $rows ) || count( $rows ) > 4096 ) { echo '{}'; return; }
$replays = array(); $rates = array(); $other = array();
foreach ( $rows as $row ) {
	if ( ! is_array( $row ) || ! isset( $row['option_name'], $row['option_value'], $row['autoload'] ) ) { echo '{}'; return; }
	$name = (string) $row['option_name']; $value = (string) $row['option_value'];
	if ( strlen( $name ) > 255 || strlen( $value ) > 8192 ) { echo '{}'; return; }
	$entry = array( 'name' => $name, 'value' => $value, 'autoload' => (string) $row['autoload'] );
	if ( 'factory_agent_signed_auth_credentials' === $name ) { continue; }
	if ( 0 === strpos( $name, 'factory_agent_replay_' ) ) { $replays[] = $entry; }
	elseif ( 0 === strpos( $name, 'factory_agent_rate_' ) ) { $rates[] = $entry; }
	else { $other[] = array( 'name' => $name, 'value_sha256' => hash( 'sha256', $value ), 'autoload' => (string) $row['autoload'] ); }
}
foreach ( array( &$replays, &$rates, &$other ) as &$entries ) { usort( $entries, static function ( array $left, array $right ): int { return strcmp( $left['name'], $right['name'] ); } ); } unset( $entries );
$json = wp_json_encode( array(
	'surface' => array( 'credential' => array( 'option_name' => 'factory_agent_signed_auth_credentials', 'credentials' => $credentials ), 'replays' => $replays, 'rates' => $rates, 'other_factory_options' => $other ),
	'credential_hmac' => $credential_hmac,
	'application_passwords' => array( 'user_id' => (int) $user->ID, 'count' => count( $applications ), 'entries' => $applications, 'structure_hmac' => hash_hmac( 'sha256', serialize( $passwords ), $nonce ) ),
) );
echo is_string( $json ) && strlen( $json ) <= 131072 ? $json : '{}';
