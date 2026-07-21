<?php

define( 'ABSPATH', __DIR__ );

class WP_Post {
	public int $ID;
	public string $post_title;
	public string $post_name;
	public string $post_status;
	public string $post_content;

	public function __construct( int $id, array $state ) {
		$this->ID           = $id;
		$this->post_title   = (string) $state['post_title'];
		$this->post_name    = (string) $state['post_name'];
		$this->post_status  = (string) $state['post_status'];
		$this->post_content = (string) $state['post_content'];
	}
}

$fixture_posts = [];
$fixture_meta  = [];

function get_post( int $post_id ): ?WP_Post {
	global $fixture_posts;

	return $fixture_posts[ $post_id ] ?? null;
}

function get_page_by_path( string $slug ): ?WP_Post {
	global $fixture_posts;

	foreach ( $fixture_posts as $post ) {
		if ( $post->post_name === $slug ) {
			return $post;
		}
	}

	return null;
}

function update_post_meta( int $post_id, string $key, $value ): void {
	global $fixture_meta;

	$fixture_meta[ $post_id ][ $key ] = (string) $value;
}

function delete_post_meta( int $post_id, string $key ): void {
	global $fixture_meta;

	unset( $fixture_meta[ $post_id ][ $key ] );
}

function get_post_meta( int $post_id, string $key, bool $single = false ) {
	global $fixture_meta;

	return $fixture_meta[ $post_id ][ $key ] ?? '';
}

function sanitize_key( string $value ): string {
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( $value ) );
}

function wp_json_encode( $value, int $flags = 0 ) {
	return json_encode( $value, $flags );
}

function wp_kses_post( string $value ): string {
	return str_replace( 'text-wrap: balance; ', '', $value );
}

function factory_diff_arrays( array $current, array $target ): array {
	return $current === $target ? [] : [ 'state' => [ 'current' => $current, 'target' => $target ] ];
}

require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/utils/ownership.php';
require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/adapters/render-adapter.php';

$post_id = 10;
$target_state = [
	'post_title'   => 'Kyiv Realty',
	'post_name'    => 'home',
	'post_status'  => 'publish',
	'post_content' => '<section style="text-wrap: balance; color: #fff">Kyiv Realty</section>',
];
$persisted_state = $target_state;
$persisted_state['post_content'] = '<section style="color: #fff">Kyiv Realty</section>';
$fixture_posts[ $post_id ] = new WP_Post( $post_id, $persisted_state );

$adapter = new Factory_Render_Adapter();
$method  = new ReflectionMethod( Factory_Render_Adapter::class, 'mark_page_factory_managed' );
$method->setAccessible( true );
$method->invoke( $adapter, $post_id, 'home', $target_state );

$stored_hash    = (string) get_post_meta( $post_id, '_factory_last_generated_hash', true );
$persisted_hash = factory_ownership_hash_state( $persisted_state );
$target_hash    = factory_ownership_hash_state( $target_state );
$owner_state    = $persisted_state;
$owner_state['post_content'] = '<section style="color: #fff">Owner copy</section>';

unset( $fixture_posts[ $post_id ] );

$validation_method = new ReflectionMethod( Factory_Render_Adapter::class, 'validate_page_state' );
$validation_method->setAccessible( true );
$synchronized = [];

foreach ( [ 'home', 'native-properties', 'contact' ] as $index => $slug ) {
	$id      = 20 + $index;
	$title   = ucwords( str_replace( '-', ' ', $slug ) );
	$desired = '<section style="text-wrap: balance; color: #fff">' . $title . '</section>';
	$state   = [
		'post_title'   => $title,
		'post_name'    => $slug,
		'post_status'  => 'publish',
		'post_content' => wp_kses_post( $desired ),
	];
	$fixture_posts[ $id ] = new WP_Post( $id, $state );
	$method->invoke( $adapter, $id, $slug, $state );
	$synchronized[] = $validation_method->invoke( $adapter, $slug, $title, $desired, $title )['status'];
}

$mismatch = $validation_method->invoke(
	$adapter,
	'home',
	'Home',
	'<section style="text-wrap: balance; color: #fff">Different content</section>',
	'Home page'
);

echo json_encode(
	[
		'persisted_hash_recorded'       => hash_equals( $persisted_hash, $stored_hash ),
		'pre_normalized_hash_rejected'  => ! hash_equals( $target_hash, $stored_hash ),
		'persisted_page_is_unmodified'  => ! factory_is_post_user_modified( $post_id, $persisted_state, $target_state ),
		'later_owner_edit_is_detected'  => factory_is_post_user_modified( $post_id, $owner_state, $target_state ),
		'synchronized_pages_validate'   => [ 'ok', 'ok', 'ok' ] === $synchronized,
		'real_page_mismatch_is_error'   => 'error' === ( $mismatch['status'] ?? '' ),
	],
	JSON_UNESCAPED_SLASHES
);
