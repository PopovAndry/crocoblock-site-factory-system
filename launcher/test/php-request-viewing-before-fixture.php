<?php
define( 'ABSPATH', __DIR__ . '/fixture-wordpress/' );
define( 'FACTORY_REQUEST_VIEWING_BEFORE_V1_TESTING', true );

$fixture_options = [];
$fixture_posts = [];
$fixture_meta = [];
$fixture_form_id = 13;
$fixture_mutations = [ 'insert' => 0, 'meta' => 0, 'trash' => 0 ];
$fixture_hooks = 0;

function absint( $value ): int { return abs( (int) $value ); }
function get_option( $key, $default = false ) { global $fixture_options; return $fixture_options[ $key ] ?? $default; }
function update_option( $key, $value ) { global $fixture_options; $fixture_options[ $key ] = $value; return true; }
function get_post( $id ) { global $fixture_posts; return $fixture_posts[ (int) $id ] ?? null; }
function get_post_meta( $id, $key, $single = false ) { global $fixture_meta; return $fixture_meta[ (int) $id ][ $key ] ?? ''; }
function get_post_type( $id ) { $post = get_post( $id ); return $post ? $post->post_type : ''; }
function get_post_status( $id ) { $post = get_post( $id ); return $post ? $post->post_status : ''; }
function get_post_stati( $args = [], $output = 'names' ) { return [ 'publish', 'private', 'draft' ]; }
function sanitize_title( $value ) { return strtolower( preg_replace( '/[^a-z0-9]+/', '-', $value ) ); }
function is_wp_error( $value ) { return false; }
function add_filter() { global $fixture_hooks; ++$fixture_hooks; }
function add_action() { global $fixture_hooks; ++$fixture_hooks; }
function jet_fb_handler() { global $fixture_form_id; return new Fixture_Handler( $fixture_form_id ); }

function get_posts( $query ): array {
	global $fixture_posts, $fixture_meta;
	$statuses = $query['post_status'] ?? 'publish';
	$statuses = 'any' === $statuses ? [ 'publish', 'private', 'draft' ] : (array) $statuses;
	$results = [];
	foreach ( $fixture_posts as $id => $post ) {
		if ( ( $query['post_type'] ?? '' ) !== $post->post_type || ! in_array( $post->post_status, $statuses, true ) ) {
			continue;
		}
		if ( isset( $query['meta_key'] ) && ( $fixture_meta[ $id ][ $query['meta_key'] ] ?? '' ) !== ( $query['meta_value'] ?? '' ) ) {
			continue;
		}
		if ( isset( $query['name'] ) && $post->post_name !== $query['name'] ) {
			continue;
		}
		$results[] = 'ids' === ( $query['fields'] ?? '' ) ? $id : $post;
	}
	return array_slice( $results, 0, $query['numberposts'] ?? -1 );
}

function wp_insert_post( $data, $return_error = false ) { global $fixture_mutations; ++$fixture_mutations['insert']; return 99; }
function update_post_meta( $id, $key, $value ) { global $fixture_mutations, $fixture_meta; ++$fixture_mutations['meta']; $fixture_meta[ $id ][ $key ] = $value; return true; }
function wp_trash_post( $id ) { global $fixture_mutations, $fixture_posts; ++$fixture_mutations['trash']; $fixture_posts[ $id ]->post_status = 'trash'; return $id; }

final class Fixture_Handler {
	public function __construct( private int $form_id ) {}
	public function get_form_id(): int { return $this->form_id; }
}
final class Fixture_Parser {
	public int $updates = 0;
	public function update_request(): void { ++$this->updates; }
}
final class Fixture_Context {
	public array $parsers = [];
	public function __construct( private array $values ) {}
	public function get_value( $key ) { return $this->values[ $key ] ?? null; }
	public function resolve_to_up( $key ): Fixture_Parser {
		return $this->parsers[ $key ] ??= new Fixture_Parser();
	}
}

require __DIR__ . '/../../scripts/fixtures/request-viewing-before-v1/factory-request-viewing-before-v1-policy.php';
require __DIR__ . '/../../scripts/fixtures/request-viewing-before-v1/bootstrap.php';

$content = 'factory form content';
$sha = hash( 'sha256', $content );
$fixture_posts = [
	13 => (object) [ 'ID' => 13, 'post_type' => 'jet-form-builder', 'post_status' => 'publish', 'post_content' => $content, 'post_name' => 'factory-request-viewing-before-v1' ],
	6 => (object) [ 'ID' => 6, 'post_type' => 'property', 'post_status' => 'publish', 'post_content' => '', 'post_name' => 'property-a' ],
	7 => (object) [ 'ID' => 7, 'post_type' => 'property', 'post_status' => 'publish', 'post_content' => '', 'post_name' => 'property-b' ],
	8 => (object) [ 'ID' => 8, 'post_type' => 'page', 'post_status' => 'publish', 'post_content' => '', 'post_name' => 'page-a' ],
	9 => (object) [ 'ID' => 9, 'post_type' => 'property', 'post_status' => 'draft', 'post_content' => '', 'post_name' => 'property-draft' ],
];
$fixture_meta = [ 13 => [ '_factory_request_viewing_before_v1_owner' => 'request_viewing_before_v1' ] ];

function fixture_binding( array $override = [] ): array {
	global $sha;
	return array_merge( [
		'form_id' => 13,
		'form_sha256' => $sha,
		'email_field' => 'email',
		'phone_field' => 'phone',
		'property_field' => 'property_id',
		'guard_field' => '_factory_policy_guard',
		'guard_value' => 'request_viewing_before_v1',
	], $override );
}

function fixture_validate( $binding, int $form_id, array $values, $guard = 'request_viewing_before_v1' ): array {
	global $fixture_options, $fixture_form_id;
	$fixture_options[ FACTORY_REQUEST_VIEWING_BEFORE_V1_BINDING_OPTION ] = $binding;
	$fixture_form_id = $form_id;
	$context = new Fixture_Context( $values );
	return [
		'contacts' => factory_request_viewing_before_v1_validate_contacts( $guard, $context ),
		'property' => factory_request_viewing_before_v1_validate_property( $guard, $context ),
		'updates' => array_sum( array_map( static fn( $parser ) => $parser->updates, $context->parsers ) ),
	];
}

$valid_values = [ 'email' => 'person@example.test', 'phone' => '', 'property_id' => '6' ];
$results = [
	'valid_email' => fixture_validate( fixture_binding(), 13, $valid_values ),
	'valid_phone' => fixture_validate( fixture_binding(), 13, [ 'email' => '', 'phone' => '+12025550101', 'property_id' => '7' ] ),
	'valid_both' => fixture_validate( fixture_binding(), 13, [ 'email' => 'person@example.test', 'phone' => '+12025550101', 'property_id' => '6' ] ),
	'empty_contacts' => fixture_validate( fixture_binding(), 13, [ 'email' => '', 'phone' => '', 'property_id' => '6' ] ),
	'whitespace_contacts' => fixture_validate( fixture_binding(), 13, [ 'email' => ' ', 'phone' => "\t", 'property_id' => '6' ] ),
	'non_scalar_contacts' => fixture_validate( fixture_binding(), 13, [ 'email' => [ 'person@example.test' ], 'phone' => [ '+12025550101' ], 'property_id' => '6' ] ),
	'bad_property' => fixture_validate( fixture_binding(), 13, [ 'email' => 'person@example.test', 'phone' => '', 'property_id' => '8' ] ),
	'malformed_property' => fixture_validate( fixture_binding(), 13, [ 'email' => 'person@example.test', 'phone' => '', 'property_id' => [ '6' ] ] ),
	'missing_binding' => fixture_validate( [], 13, $valid_values ),
	'malformed_binding' => fixture_validate( [ 'form_id' => 13 ], 13, $valid_values ),
	'ambiguous_binding' => fixture_validate( fixture_binding( [ 'unexpected' => 'value' ] ), 13, $valid_values ),
	'retargeted_binding' => fixture_validate( fixture_binding( [ 'form_id' => 14 ] ), 13, $valid_values ),
	'absent_execution_context' => fixture_validate( fixture_binding(), 0, $valid_values ),
	'unrelated_invocation' => fixture_validate( fixture_binding(), 99, $valid_values ),
];

$fixture_options['factory_request_viewing_before_v1_runtime_slug'] = 'csf-st-viewing-before-v1';
$fixture_options['factory_request_viewing_before_v1_entities'] = [];
$fixture_posts[16] = (object) [ 'ID' => 16, 'post_type' => 'property', 'post_status' => 'private', 'post_content' => '', 'post_name' => 'factory-request-viewing-before-v1-private-property' ];
$fixture_posts[17] = (object) [ 'ID' => 17, 'post_type' => 'property', 'post_status' => 'trash', 'post_content' => '', 'post_name' => 'factory-request-viewing-before-v1-trash-property' ];
foreach ( [ 16 => [ 'private_property_v1', 'factory-request-viewing-before-v1-private-property' ], 17 => [ 'trash_property_v1', 'factory-request-viewing-before-v1-trash-property' ] ] as $id => $control ) {
	$fixture_meta[ $id ] = [
		FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META => $control[0],
		FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META => 'request_viewing_before_v1',
		'_factory_request_viewing_before_v1_control_slug' => $control[1],
	];
}
$any_lookup_misses_trash = [] === get_posts( [ 'post_type' => 'property', 'post_status' => 'any', 'meta_key' => FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META, 'meta_value' => 'trash_property_v1', 'fields' => 'ids' ] );
$before_controls = $fixture_mutations;
$controls_once = factory_request_viewing_before_v1_controls();
$controls_twice = factory_request_viewing_before_v1_controls();
$controls_no_mutation = $before_controls === $fixture_mutations;

$fixture_posts[18] = (object) [ 'ID' => 18, 'post_type' => 'property', 'post_status' => 'trash', 'post_content' => '', 'post_name' => 'duplicate-trash-control' ];
$fixture_meta[18] = $fixture_meta[17];
$before_duplicate = $fixture_mutations;
try { factory_request_viewing_before_v1_controls(); $duplicate_error = ''; } catch ( Throwable $error ) { $duplicate_error = $error->getMessage(); }
$duplicate_no_mutation = $before_duplicate === $fixture_mutations;
unset( $fixture_posts[18], $fixture_meta[18] );
$fixture_meta[17][FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META] = 'conflict';
$before_conflict = $fixture_mutations;
try { factory_request_viewing_before_v1_controls(); $conflict_error = ''; } catch ( Throwable $error ) { $conflict_error = $error->getMessage(); }
$conflict_no_mutation = $before_conflict === $fixture_mutations;

echo json_encode( [
	'validations' => $results,
	'global_hooks_added' => $fixture_hooks,
	'controls' => [
		'any_lookup_misses_trash' => $any_lookup_misses_trash,
		'once' => $controls_once,
		'twice' => $controls_twice,
		'no_mutation' => $controls_no_mutation,
		'duplicate_error' => $duplicate_error,
		'duplicate_no_mutation' => $duplicate_no_mutation,
		'conflict_error' => $conflict_error,
		'conflict_no_mutation' => $conflict_no_mutation,
	],
] );
