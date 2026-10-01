<?php
define( 'ABSPATH', __DIR__ . '/fixture-wordpress/' );
define( 'FACTORY_REQUEST_VIEWING_BEFORE_V1_TESTING', true );

$fixture_options = [];
$fixture_posts = [];
$fixture_meta = [];
$fixture_form_id = 13;
$fixture_mutations = [ 'insert' => 0, 'meta' => 0, 'trash' => 0, 'update' => 0, 'option' => 0 ];
$fixture_hooks = 0;
$fixture_form_records_tables = [];
$fixture_form_records_schema_mutations = 0;
$fixture_form_records_count = 0;
$fixture_form_records_verify = true;
$fixture_route_flushes = 0;
$fixture_route_flush_updates = true;

final class Fixture_Rewrite {
	public function rewrite_rules(): array {
		return [ 'property/([^/]+)/?$' => 'index.php?property=$matches[1]' ];
	}
}

$wp_rewrite = new Fixture_Rewrite();

final class Fixture_Record_Model {
	public static function table(): string { return 'wp_jet_fb_records'; }
	public function create(): self { global $fixture_form_records_tables, $fixture_form_records_schema_mutations; if ( empty( $fixture_form_records_tables[ static::table() ] ) ) { $fixture_form_records_tables[ static::table() ] = true; ++$fixture_form_records_schema_mutations; } return $this; }
}
final class Fixture_Record_Field_Model {
	public static function table(): string { return 'wp_jet_fb_records_fields'; }
	public function create(): self { global $fixture_form_records_tables, $fixture_form_records_schema_mutations; if ( empty( $fixture_form_records_tables[ static::table() ] ) ) { $fixture_form_records_tables[ static::table() ] = true; ++$fixture_form_records_schema_mutations; } return $this; }
}
final class Fixture_Record_View_Count {
	public static function count(): int { global $fixture_form_records_count; return $fixture_form_records_count; }
}
final class Fixture_Execution_Builder {
	public function is_exist( $model ): bool { global $fixture_form_records_tables, $fixture_form_records_verify; return $fixture_form_records_verify && ! empty( $fixture_form_records_tables[ $model::table() ] ); }
}

if ( 'missing_class' !== getenv( 'FIXTURE_FORM_RECORDS_TEST_MODE' ) ) {
	class_alias( Fixture_Record_Model::class, 'JFB_Modules\\Form_Record\\Models\\Record_Model' );
	class_alias( Fixture_Record_Field_Model::class, 'JFB_Modules\\Form_Record\\Models\\Record_Field_Model' );
	class_alias( Fixture_Record_View_Count::class, 'JFB_Modules\\Form_Record\\Query_Views\\Record_View_Count' );
	class_alias( Fixture_Execution_Builder::class, 'Jet_Form_Builder\\Db_Queries\\Execution_Builder' );
}
if ( 'table_verification_failed' === getenv( 'FIXTURE_FORM_RECORDS_TEST_MODE' ) ) {
	$fixture_form_records_verify = false;
}
if ( 'records_not_empty' === getenv( 'FIXTURE_FORM_RECORDS_TEST_MODE' ) ) {
	$fixture_form_records_count = 1;
}

function absint( $value ): int { return abs( (int) $value ); }
function get_option( $key, $default = false ) { global $fixture_options; return $fixture_options[ $key ] ?? $default; }
function update_option( $key, $value ) { global $fixture_options, $fixture_mutations; if ( ( $fixture_options[ $key ] ?? null ) !== $value ) { ++$fixture_mutations['option']; $fixture_options[ $key ] = $value; } return true; }
function get_post( $id ) { global $fixture_posts; return $fixture_posts[ (int) $id ] ?? null; }
function get_post_meta( $id, $key, $single = false ) { global $fixture_meta; return $fixture_meta[ (int) $id ][ $key ] ?? ''; }
function get_post_type( $id ) { $post = get_post( $id ); return $post ? $post->post_type : ''; }
function get_post_status( $id ) { $post = get_post( $id ); return $post ? $post->post_status : ''; }
function get_post_stati( $args = [], $output = 'names' ) { return [ 'publish', 'private', 'draft' ]; }
function sanitize_title( $value ) { return preg_replace( '/[^a-z0-9]+/', '-', strtolower( $value ) ); }
function is_wp_error( $value ) { return false; }
function post_type_exists( $type ) { return in_array( $type, [ 'jet-form-builder', 'property' ], true ); }
function get_post_type_object( $type ) {
	if ( 'property' !== $type ) {
		return null;
	}
	return (object) [ 'public' => true, 'publicly_queryable' => true, 'rewrite' => [ 'slug' => 'property', 'with_front' => false ], 'query_var' => 'property' ];
}
function get_post_field( $field, $id ) { $post = get_post( $id ); return $post && isset( $post->{ $field } ) ? $post->{ $field } : ''; }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
function wp_slash( $value ) { return $value; }
function get_permalink( $id ) { $post = get_post( $id ); return $post && 'property' === $post->post_type ? 'https://fixture.test/property/' . $post->post_name . '/' : 'https://fixture.test/?p=' . (int) $id; }
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
function url_to_postid( $url ) {
	global $fixture_posts, $fixture_options;
	$rules = $fixture_options['rewrite_rules'] ?? [];
	if ( ! is_array( $rules ) || ! isset( $rules['property/([^/]+)/?$'] ) ) {
		return 0;
	}
	$path = trim( (string) parse_url( $url, PHP_URL_PATH ), '/' );
	if ( ! preg_match( '#^property/([^/]+)$#', $path, $matches ) ) {
		return 0;
	}
	foreach ( $fixture_posts as $post ) {
		if ( 'property' === $post->post_type && 'publish' === $post->post_status && $matches[1] === $post->post_name ) {
			return $post->ID;
		}
	}
	return 0;
}
function flush_rewrite_rules( $hard = true ) {
	global $fixture_mutations, $fixture_options, $fixture_route_flushes, $fixture_route_flush_updates, $wp_rewrite;
	++$fixture_route_flushes;
	if ( ! $hard && $fixture_route_flush_updates ) {
		++$fixture_mutations['option'];
		$fixture_options['rewrite_rules'] = $wp_rewrite->rewrite_rules();
	}
}
function esc_url( $value ) { return $value; }
function add_query_arg( $key, $value, $url ) { return $url . '&' . rawurlencode( $key ) . '=' . rawurlencode( (string) $value ); }
function add_filter() { global $fixture_hooks; ++$fixture_hooks; }
function add_action() { global $fixture_hooks; ++$fixture_hooks; }
function jet_fb_handler() { global $fixture_form_id; return new Fixture_Handler( $fixture_form_id ); }
function factory_runtime_binding_v1_read(): array { return [ 'ok' => true, 'binding' => [ 'schema_version' => 1, 'binding_kind' => 'server_owned_runtime_binding', 'project_id' => '123e4567-e89b-12d3-a456-426614174000', 'project_slug' => 'fixture-runtime-binding' ] ]; }

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

function wp_insert_post( $data, $return_error = false ) { global $fixture_mutations, $fixture_posts; ++$fixture_mutations['insert']; $id = $fixture_posts ? max( array_keys( $fixture_posts ) ) + 1 : 1; $fixture_posts[ $id ] = (object) [ 'ID' => $id, 'post_type' => $data['post_type'], 'post_status' => $data['post_status'], 'post_content' => $data['post_content'], 'post_name' => $data['post_name'] ]; return $id; }
function wp_update_post( $data ) { global $fixture_mutations, $fixture_posts; ++$fixture_mutations['update']; $id = (int) ( $data['ID'] ?? 0 ); if ( ! isset( $fixture_posts[ $id ] ) ) { return 0; } foreach ( [ 'post_content', 'post_status', 'post_title', 'post_name' ] as $field ) { if ( array_key_exists( $field, $data ) ) { $fixture_posts[ $id ]->{ $field } = $data[ $field ]; } } return $id; }
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

if ( getenv( 'FIXTURE_FORM_RECORDS_TEST_MODE' ) ) {
	try {
		$result = factory_request_viewing_before_v1_require_form_records_ready();
		echo json_encode( [ 'result' => $result, 'schema_mutations' => $fixture_form_records_schema_mutations ] );
	} catch ( Throwable $error ) {
		echo json_encode( [ 'error' => $error->getMessage(), 'schema_mutations' => $fixture_form_records_schema_mutations ] );
	}
	exit( 0 );
}

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
$controls_once = factory_request_viewing_before_v1_controls();
$after_controls_once = $fixture_mutations;
$controls_twice = factory_request_viewing_before_v1_controls();
$controls_no_mutation = $after_controls_once === $fixture_mutations;

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
$fixture_meta[17][FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META] = 'request_viewing_before_v1';
$fixture_options['factory_request_viewing_before_v1_entities'] = 'invalid';
$before_malformed_entities = $fixture_mutations;
try { factory_request_viewing_before_v1_controls(); $malformed_entities_error = ''; } catch ( Throwable $error ) { $malformed_entities_error = $error->getMessage(); }
$malformed_entities_no_mutation = $before_malformed_entities === $fixture_mutations;
$fixture_options['factory_request_viewing_before_v1_entities'] = [];

unset( $fixture_posts[13], $fixture_meta[13], $fixture_options['factory_request_viewing_before_v1_binding'] );
$before_base = $fixture_mutations;
$base_once = factory_request_viewing_before_v1_base();
$after_base = $fixture_mutations;
$route_flushes_after_base_once = $fixture_route_flushes;
$base_twice = factory_request_viewing_before_v1_base();
$base_no_repeat_mutation = $after_base === $fixture_mutations;
$base_no_repeat_route_flush = $route_flushes_after_base_once === $fixture_route_flushes;
$property_routes_ready = [
	'property_a' => (int) $base_once['property_a'] === url_to_postid( get_permalink( $base_once['property_a'] ) ),
	'property_b' => (int) $base_once['property_b'] === url_to_postid( get_permalink( $base_once['property_b'] ) ),
];
$saved_rewrite_rules = $fixture_options['rewrite_rules'];
$fixture_options['rewrite_rules'] = [];
$fixture_route_flush_updates = false;
try { factory_request_viewing_before_v1_require_property_routes( $base_once ); $property_routes_unavailable_error = ''; } catch ( Throwable $error ) { $property_routes_unavailable_error = $error->getMessage(); }
$fixture_route_flush_updates = true;
$fixture_options['rewrite_rules'] = $saved_rewrite_rules;

$fixture_options['factory_request_viewing_before_v1_entities'] = [
	'contact_id' => 8,
	'property_a' => 6,
	'property_b' => 7,
	'wrong_type' => 8,
	'draft_property' => 9,
];
$before_redirected_entities = $fixture_mutations;
$before_redirected_entities_schema = $fixture_form_records_schema_mutations;
try { factory_request_viewing_before_v1_form(); $redirected_entities_error = ''; } catch ( Throwable $error ) { $redirected_entities_error = $error->getMessage(); }
$redirected_entities_no_mutation = $before_redirected_entities === $fixture_mutations;
$redirected_entities_no_schema_mutation = $before_redirected_entities_schema === $fixture_form_records_schema_mutations;
factory_request_viewing_before_v1_base();

$fixture_posts[100] = (object) [ 'ID' => 100, 'post_type' => 'jet-form-builder', 'post_status' => 'publish', 'post_content' => factory_request_viewing_before_v1_form_content(), 'post_name' => 'factory-request-viewing-before-v1' ];
$fixture_meta[100] = [ '_factory_request_viewing_before_v1_owner' => 'request_viewing_before_v1' ];
$fixture_options['factory_request_viewing_before_v1_binding'] = [ 'form_id' => 99, 'form_sha256' => 'stale' ];
$before_binding_conflict_schema = $fixture_form_records_schema_mutations;
try { factory_request_viewing_before_v1_form(); $binding_conflict_error = ''; } catch ( Throwable $error ) { $binding_conflict_error = $error->getMessage(); }
$binding_conflict_no_schema_mutation = $before_binding_conflict_schema === $fixture_form_records_schema_mutations;
unset( $fixture_posts[100], $fixture_meta[100], $fixture_options['factory_request_viewing_before_v1_binding'] );

$fixture_posts[101] = (object) [ 'ID' => 101, 'post_type' => 'jet-form-builder', 'post_status' => 'publish', 'post_content' => 'conflicting form content', 'post_name' => 'factory-request-viewing-before-v1' ];
$fixture_meta[101] = [ '_factory_request_viewing_before_v1_owner' => 'request_viewing_before_v1' ];
$before_form_conflict_schema = $fixture_form_records_schema_mutations;
try { factory_request_viewing_before_v1_form(); $form_conflict_error = ''; } catch ( Throwable $error ) { $form_conflict_error = $error->getMessage(); }
$form_conflict_no_schema_mutation = $before_form_conflict_schema === $fixture_form_records_schema_mutations;
unset( $fixture_posts[101], $fixture_meta[101] );

$before_form = $fixture_mutations;
$form_once = factory_request_viewing_before_v1_form();
$after_form = $fixture_mutations;
$form_twice = factory_request_viewing_before_v1_form();
$form_no_repeat_mutation = $after_form === $fixture_mutations;
$form_records_first = factory_request_viewing_before_v1_require_form_records_ready();
$after_form_records_first = $fixture_form_records_schema_mutations;
$form_records_second = factory_request_viewing_before_v1_require_form_records_ready();
$form_records_no_repeat_mutation = $after_form_records_first === $fixture_form_records_schema_mutations;

$fixture_meta[ $base_once['property_a'] ][ FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_OWNER_META ] = 'conflict';
$before_entity_conflict = $fixture_mutations;
try { factory_request_viewing_before_v1_base(); $entity_conflict_error = ''; } catch ( Throwable $error ) { $entity_conflict_error = $error->getMessage(); }
$entity_conflict_no_mutation = $before_entity_conflict === $fixture_mutations;
$fixture_meta[ $base_once['property_a'] ][ FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_OWNER_META ] = 'request_viewing_before_v1';

$_GET['project_id'] = 'caller-selected';
$before_injection = $fixture_mutations;
try { factory_request_viewing_before_v1_controls(); $identity_injection_error = ''; } catch ( Throwable $error ) { $identity_injection_error = $error->getMessage(); }
$identity_injection_no_mutation = $before_injection === $fixture_mutations;
unset( $_GET['project_id'] );

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
		'malformed_entities_error' => $malformed_entities_error,
		'malformed_entities_no_mutation' => $malformed_entities_no_mutation,
	],
	'baseline' => [
		'base_once' => $base_once,
		'base_twice' => $base_twice,
		'base_no_repeat_mutation' => $base_no_repeat_mutation,
		'route_flushes_after_base_once' => $route_flushes_after_base_once,
		'base_no_repeat_route_flush' => $base_no_repeat_route_flush,
		'property_routes_ready' => $property_routes_ready,
		'property_routes_unavailable_error' => $property_routes_unavailable_error,
		'form_once' => $form_once,
		'form_twice' => $form_twice,
		'form_no_repeat_mutation' => $form_no_repeat_mutation,
		'form_records_first' => $form_records_first,
		'form_records_second' => $form_records_second,
		'form_records_schema_mutations' => $fixture_form_records_schema_mutations,
		'form_records_no_repeat_mutation' => $form_records_no_repeat_mutation,
		'redirected_entities_error' => $redirected_entities_error,
		'redirected_entities_no_mutation' => $redirected_entities_no_mutation,
		'redirected_entities_no_schema_mutation' => $redirected_entities_no_schema_mutation,
		'binding_conflict_error' => $binding_conflict_error,
		'binding_conflict_no_schema_mutation' => $binding_conflict_no_schema_mutation,
		'form_conflict_error' => $form_conflict_error,
		'form_conflict_no_schema_mutation' => $form_conflict_no_schema_mutation,
		'entity_conflict_error' => $entity_conflict_error,
		'entity_conflict_no_mutation' => $entity_conflict_no_mutation,
		'identity_injection_error' => $identity_injection_error,
		'identity_injection_no_mutation' => $identity_injection_no_mutation,
	],
] );
