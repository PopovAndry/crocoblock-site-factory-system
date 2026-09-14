<?php
if ( ! defined( 'ABSPATH' ) || 'cli' !== PHP_SAPI ) {
	exit( 1 );
}

const FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META = '_factory_request_viewing_before_v1_control';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META = '_factory_request_viewing_before_v1_owner';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_META = '_factory_request_viewing_before_v1_entity';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_OWNER_META = '_factory_request_viewing_before_v1_entity_owner';

function factory_request_viewing_before_v1_post( string $title, string $type, string $status ): int {
	$id = wp_insert_post( [
		'post_title'   => $title,
		'post_name'    => sanitize_title( $title ),
		'post_type'    => $type,
		'post_status'  => $status,
		'post_content' => '',
	], true );
	if ( is_wp_error( $id ) || ! $id ) {
		throw new RuntimeException( 'fixture_post_create_failed' );
	}
	return (int) $id;
}

function factory_request_viewing_before_v1_require_runtime(): array {
	$identity_keys = [ 'FACTORY_REQUEST_VIEWING_BEFORE_V1_PROJECT_ID', 'FACTORY_REQUEST_VIEWING_BEFORE_V1_PROJECT_SLUG', 'PROJECT_ID', 'PROJECT_SLUG' ];
	foreach ( $identity_keys as $key ) {
		if ( false !== getenv( $key ) ) {
			throw new RuntimeException( 'fixture_runtime_identity_injection' );
		}
	}
	foreach ( [ 'project_id', 'project_slug', 'runtime_project_id', 'runtime_project_slug' ] as $key ) {
		if ( isset( $_GET[ $key ] ) || isset( $_POST[ $key ] ) ) {
			throw new RuntimeException( 'fixture_runtime_identity_injection' );
		}
	}
	if ( ! function_exists( 'factory_runtime_binding_v1_read' ) ) {
		throw new RuntimeException( 'fixture_runtime_binding_missing' );
	}
	$runtime = factory_runtime_binding_v1_read();
	if ( ! is_array( $runtime ) || empty( $runtime['ok'] ) || ! is_array( $runtime['binding'] ?? null ) ) {
		throw new RuntimeException( 'fixture_runtime_binding_missing' );
	}
	return $runtime['binding'];
}

function factory_request_viewing_before_v1_all_statuses(): array {
	$statuses = array_values( get_post_stati( [], 'names' ) );
	if ( ! in_array( 'trash', $statuses, true ) ) {
		$statuses[] = 'trash';
	}
	return $statuses;
}

function factory_request_viewing_before_v1_control_lookup( string $control, string $slug, string $status ): int {
	$all_statuses = factory_request_viewing_before_v1_all_statuses();
	$existing = get_posts( [
		'post_type'      => 'property',
		'post_status'    => $all_statuses,
		'meta_key'       => FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META,
		'meta_value'     => $control,
		'fields'         => 'ids',
		'numberposts'    => 2,
		'suppress_filters' => true,
	] );
	if ( count( $existing ) > 1 ) {
		throw new RuntimeException( 'fixture_control_duplicate' );
	}
	if ( $existing ) {
		$id = (int) $existing[0];
		if ( 'property' !== get_post_type( $id )
			|| $status !== get_post_status( $id )
			|| 'request_viewing_before_v1' !== get_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META, true )
			|| $slug !== get_post_meta( $id, '_factory_request_viewing_before_v1_control_slug', true ) ) {
			throw new RuntimeException( 'fixture_control_conflict' );
		}
		return $id;
	}

	$slug_conflict = get_posts( [
		'name'             => $slug,
		'post_type'        => 'property',
		'post_status'      => $all_statuses,
		'fields'           => 'ids',
		'numberposts'      => 1,
		'suppress_filters' => true,
	] );
	if ( $slug_conflict ) {
		throw new RuntimeException( 'fixture_control_slug_conflict' );
	}
	return 0;
}

function factory_request_viewing_before_v1_control_post( string $control, string $slug, string $title, string $status, int $existing = 0 ): int {
	if ( $existing ) {
		return $existing;
	}

	$id = factory_request_viewing_before_v1_post( $title, 'property', 'private' === $status ? 'private' : 'draft' );
	update_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META, $control );
	update_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META, 'request_viewing_before_v1' );
	update_post_meta( $id, '_factory_request_viewing_before_v1_control_slug', $slug );

	if ( 'trash' === $status && ! wp_trash_post( $id ) ) {
		throw new RuntimeException( 'fixture_control_trash_failed' );
	}
	if ( $status !== get_post_status( $id ) ) {
		throw new RuntimeException( 'fixture_control_status_failed' );
	}

	return $id;
}

function factory_request_viewing_before_v1_preflight_controls(): array {
	return [
		'private_property' => factory_request_viewing_before_v1_control_lookup(
		'private_property_v1',
		'factory-request-viewing-before-v1-private-property',
		'private'
		),
		'trash_property' => factory_request_viewing_before_v1_control_lookup(
		'trash_property_v1',
		'factory-request-viewing-before-v1-trash-property',
		'trash'
		),
	];
}

function factory_request_viewing_before_v1_controls( array $preflight = [] ): array {
	factory_request_viewing_before_v1_require_runtime();
	$entities = get_option( 'factory_request_viewing_before_v1_entities', [] );
	if ( ! is_array( $entities ) ) {
		throw new RuntimeException( 'fixture_entities_invalid' );
	}
	$preflight = $preflight ?: factory_request_viewing_before_v1_preflight_controls();
	$existing_private = (int) ( $preflight['private_property'] ?? 0 );
	$existing_trash = (int) ( $preflight['trash_property'] ?? 0 );
	$private_property = factory_request_viewing_before_v1_control_post(
		'private_property_v1',
		'factory-request-viewing-before-v1-private-property',
		'Fixture Private Property',
		'private',
		$existing_private
	);
	$trash_property = factory_request_viewing_before_v1_control_post(
		'trash_property_v1',
		'factory-request-viewing-before-v1-trash-property',
		'Fixture Trash Property',
		'trash',
		$existing_trash
	);
	$controls = compact( 'private_property', 'trash_property' );
	$next_entities = array_merge( $entities, $controls );
	if ( $entities !== $next_entities ) {
		update_option( 'factory_request_viewing_before_v1_entities', $next_entities, false );
	}
	return $controls;
}

function factory_request_viewing_before_v1_entity_lookup( string $entity, string $title, string $type, string $status ): int {
	$all_statuses = factory_request_viewing_before_v1_all_statuses();
	$existing = get_posts( [
		'post_type'        => $type,
		'post_status'      => $all_statuses,
		'meta_key'         => FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_META,
		'meta_value'       => $entity,
		'fields'           => 'ids',
		'numberposts'      => 2,
		'suppress_filters' => true,
	] );
	if ( count( $existing ) > 1 ) {
		throw new RuntimeException( 'fixture_entity_duplicate' );
	}
	if ( $existing ) {
		$id = (int) $existing[0];
		if ( $type !== get_post_type( $id )
			|| $status !== get_post_status( $id )
			|| 'request_viewing_before_v1' !== get_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_OWNER_META, true )
			|| sanitize_title( $title ) !== get_post_meta( $id, '_factory_request_viewing_before_v1_entity_slug', true ) ) {
			throw new RuntimeException( 'fixture_entity_conflict' );
		}
		return $id;
	}
	$slug_conflict = get_posts( [
		'name'             => sanitize_title( $title ),
		'post_type'        => $type,
		'post_status'      => $all_statuses,
		'fields'           => 'ids',
		'numberposts'      => 1,
		'suppress_filters' => true,
	] );
	if ( $slug_conflict ) {
		throw new RuntimeException( 'fixture_entity_slug_conflict' );
	}
	return 0;
}

function factory_request_viewing_before_v1_entity_post( string $entity, string $title, string $type, string $status, int $existing = 0 ): int {
	if ( $existing ) {
		return $existing;
	}
	$id = factory_request_viewing_before_v1_post( $title, $type, $status );
	update_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_META, $entity );
	update_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_OWNER_META, 'request_viewing_before_v1' );
	update_post_meta( $id, '_factory_request_viewing_before_v1_entity_slug', sanitize_title( $title ) );
	return $id;
}

function factory_request_viewing_before_v1_entity_definitions(): array {
	return [
		'contact_id'     => [ 'contact_v1', 'Fixture Contact', 'page', 'publish' ],
		'property_a'     => [ 'property_a_v1', 'Fixture Property A', 'property', 'publish' ],
		'property_b'     => [ 'property_b_v1', 'Fixture Property B', 'property', 'publish' ],
		'wrong_type'     => [ 'wrong_type_v1', 'Fixture Published Page', 'page', 'publish' ],
		'draft_property' => [ 'draft_property_v1', 'Fixture Draft Property', 'property', 'draft' ],
	];
}

function factory_request_viewing_before_v1_assert_owned_entities( array $entities ): array {
	$resolved = [];
	foreach ( factory_request_viewing_before_v1_entity_definitions() as $key => $definition ) {
		$id = $entities[ $key ] ?? null;
		$post = is_int( $id ) && $id > 0 ? get_post( $id ) : null;
		if ( ! $post || $definition[2] !== $post->post_type || $definition[3] !== $post->post_status
			|| $definition[0] !== get_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_META, true )
			|| 'request_viewing_before_v1' !== get_post_meta( $id, FACTORY_REQUEST_VIEWING_BEFORE_V1_ENTITY_OWNER_META, true )
			|| sanitize_title( $definition[1] ) !== get_post_meta( $id, '_factory_request_viewing_before_v1_entity_slug', true ) ) {
			throw new RuntimeException( 'fixture_entities_invalid' );
		}
		$resolved[ $key ] = $id;
	}
	return $resolved;
}

function factory_request_viewing_before_v1_form_content(): string {
	$guard = 'request_viewing_before_v1';
	return '<!-- wp:jet-forms/hidden-field {"field_value":"query_var","query_var_key":"factory_property_id","name":"property_id","required":true} /-->' . "\n\n"
		. '<!-- wp:jet-forms/text-field {"label":"Name","name":"name","required":true} /-->' . "\n\n"
		. '<!-- wp:jet-forms/text-field {"field_type":"email","label":"Email","name":"email"} /-->' . "\n\n"
		. '<!-- wp:jet-forms/text-field {"field_type":"tel","label":"Phone","name":"phone"} /-->' . "\n\n"
		. '<!-- wp:jet-forms/textarea-field {"label":"Message","name":"message"} /-->' . "\n\n"
		. '<!-- wp:jet-forms/text-field {"field_type":"hidden","default":"' . $guard . '","name":"_factory_policy_guard","required":true,"validation":{"type":"advanced","rules":[{"type":"ssr","value":"factory_request_viewing_before_v1_validate_contacts","message":"Provide an email address or phone number."},{"type":"ssr","value":"factory_request_viewing_before_v1_validate_property","message":"Select a published property."}]}} /-->' . "\n\n"
		. '<!-- wp:jet-forms/submit-field {"label":"Request viewing"} /-->';
}

function factory_request_viewing_before_v1_form_actions(): array {
	return [ [
		'settings'   => [
			'save_record' => [
				'save_user_data'    => false,
				'save_spam'         => false,
				'save_user_journey' => false,
			],
		],
		'type'       => 'save_record',
		'id'         => 0,
		'conditions' => [],
		'events'     => [],
		'index'      => 0,
		'chosen'     => false,
		'selected'   => false,
	] ];
}

function factory_request_viewing_before_v1_store_form_actions( int $form_id ): void {
	$actions = factory_request_viewing_before_v1_form_actions();
	$json = wp_json_encode( $actions, JSON_UNESCAPED_SLASHES );
	if ( ! is_string( $json ) || '' === $json ) {
		throw new RuntimeException( 'fixture_actions_encode_failed' );
	}

	update_post_meta( $form_id, '_jf_actions', wp_slash( $json ) );
	$stored = get_post_meta( $form_id, '_jf_actions', true );
	$decoded = is_string( $stored ) ? json_decode( $stored, true ) : null;
	if ( JSON_ERROR_NONE !== json_last_error() || $actions !== $decoded ) {
		throw new RuntimeException( 'fixture_actions_round_trip_failed' );
	}
}

function factory_request_viewing_before_v1_require_form_records_ready(): array {
	$model_classes = [
		'records' => 'JFB_Modules\\Form_Record\\Models\\Record_Model',
		'fields'  => 'JFB_Modules\\Form_Record\\Models\\Record_Field_Model',
	];
	$count_class = 'JFB_Modules\\Form_Record\\Query_Views\\Record_View_Count';
	$builder_class = 'Jet_Form_Builder\\Db_Queries\\Execution_Builder';

	foreach ( array_merge( array_values( $model_classes ), [ $count_class, $builder_class ] ) as $class ) {
		if ( ! class_exists( $class ) ) {
			throw new RuntimeException( 'fixture_form_records_class_missing' );
		}
	}
	if ( ! method_exists( $count_class, 'count' ) ) {
		throw new RuntimeException( 'fixture_form_records_api_missing' );
	}

	$verifier = new $builder_class();
	if ( ! is_object( $verifier ) || ! method_exists( $verifier, 'is_exist' ) ) {
		throw new RuntimeException( 'fixture_form_records_builder_invalid' );
	}

	$tables = [];
	foreach ( $model_classes as $key => $model_class ) {
		if ( ! method_exists( $model_class, 'table' ) ) {
			throw new RuntimeException( 'fixture_form_records_model_invalid' );
		}
		$model = new $model_class();
		if ( ! method_exists( $model, 'create' ) ) {
			throw new RuntimeException( 'fixture_form_records_model_invalid' );
		}
		$model->create();
		if ( ! $verifier->is_exist( $model ) ) {
			throw new RuntimeException( 'fixture_form_records_table_unavailable' );
		}
		$tables[ $key ] = $model_class::table();
	}

	$record_count = $count_class::count();
	if ( ! is_int( $record_count ) || 0 !== $record_count ) {
		throw new RuntimeException( 'fixture_form_records_not_empty' );
	}

	return [ 'tables' => $tables, 'record_count' => $record_count ];
}

function factory_request_viewing_before_v1_repair_actions(): array {
	factory_request_viewing_before_v1_require_runtime();
	$binding = get_option( 'factory_request_viewing_before_v1_binding', [] );
	$form_id = is_array( $binding ) ? absint( $binding['form_id'] ?? 0 ) : 0;
	$form = $form_id ? get_post( $form_id ) : null;
	if ( ! $form || 'jet-form-builder' !== $form->post_type
		|| 'request_viewing_before_v1' !== get_post_meta( $form_id, '_factory_request_viewing_before_v1_owner', true )
		|| ! is_string( $binding['form_sha256'] ?? null )
		|| ! hash_equals( $binding['form_sha256'], hash( 'sha256', (string) $form->post_content ) ) ) {
		throw new RuntimeException( 'fixture_owned_form_binding_invalid' );
	}

	factory_request_viewing_before_v1_store_form_actions( $form_id );
	return [ 'form_id' => $form_id, 'actions' => get_post_meta( $form_id, '_jf_actions', true ) ];
}

function factory_request_viewing_before_v1_base(): array {
	factory_request_viewing_before_v1_require_runtime();
	$stored = get_option( 'factory_request_viewing_before_v1_entities', [] );
	if ( ! is_array( $stored ) ) {
		throw new RuntimeException( 'fixture_entities_invalid' );
	}
	$definitions = factory_request_viewing_before_v1_entity_definitions();
	$preflight = [];
	foreach ( $definitions as $key => $definition ) {
		$preflight[ $key ] = factory_request_viewing_before_v1_entity_lookup( $definition[0], $definition[1], $definition[2], $definition[3] );
	}
	$control_preflight = factory_request_viewing_before_v1_preflight_controls();
	$entities = [];
	foreach ( $definitions as $key => $definition ) {
		$entities[ $key ] = factory_request_viewing_before_v1_entity_post( $definition[0], $definition[1], $definition[2], $definition[3], $preflight[ $key ] );
	}
	$entities = array_merge( $entities, factory_request_viewing_before_v1_controls( $control_preflight ) );
	if ( $stored !== $entities ) {
		update_option( 'factory_request_viewing_before_v1_entities', $entities, false );
	}
	return $entities;
}

function factory_request_viewing_before_v1_form_lookup( string $content ): int {
	$all_statuses = factory_request_viewing_before_v1_all_statuses();
	$existing = get_posts( [
		'post_type'        => 'jet-form-builder',
		'post_status'      => $all_statuses,
		'meta_key'         => '_factory_request_viewing_before_v1_owner',
		'meta_value'       => 'request_viewing_before_v1',
		'fields'           => 'ids',
		'numberposts'      => 2,
		'suppress_filters' => true,
	] );
	if ( count( $existing ) > 1 ) {
		throw new RuntimeException( 'fixture_form_duplicate' );
	}
	if ( $existing ) {
		$id = (int) $existing[0];
		$form = get_post( $id );
		if ( ! $form || 'jet-form-builder' !== $form->post_type || 'publish' !== $form->post_status
			|| $content !== (string) $form->post_content ) {
			throw new RuntimeException( 'fixture_form_conflict' );
		}
		return $id;
	}
	$slug_conflict = get_posts( [
		'name'             => 'factory-request-viewing-before-v1',
		'post_type'        => 'jet-form-builder',
		'post_status'      => $all_statuses,
		'fields'           => 'ids',
		'numberposts'      => 1,
		'suppress_filters' => true,
	] );
	if ( $slug_conflict ) {
		throw new RuntimeException( 'fixture_form_slug_conflict' );
	}
	return 0;
}

function factory_request_viewing_before_v1_form(): array {
	factory_request_viewing_before_v1_require_runtime();
	if ( ! post_type_exists( 'jet-form-builder' ) ) {
		throw new RuntimeException( 'jetformbuilder_not_active' );
	}
	$entities = get_option( 'factory_request_viewing_before_v1_entities', [] );
	if ( ! is_array( $entities ) ) {
		throw new RuntimeException( 'fixture_entities_missing' );
	}
	$owned_entities = factory_request_viewing_before_v1_assert_owned_entities( $entities );
	$content = factory_request_viewing_before_v1_form_content();
	$form_id = factory_request_viewing_before_v1_form_lookup( $content );
	$stored_binding = get_option( 'factory_request_viewing_before_v1_binding', [] );
	if ( $stored_binding ) {
		if ( ! $form_id
			|| ! is_array( $stored_binding )
			|| $form_id !== (int) ( $stored_binding['form_id'] ?? 0 )
			|| ! is_string( $stored_binding['form_sha256'] ?? null )
			|| ! hash_equals( $stored_binding['form_sha256'], hash( 'sha256', $content ) ) ) {
			throw new RuntimeException( 'fixture_form_binding_conflict' );
		}
	}
	$form_records = factory_request_viewing_before_v1_require_form_records_ready();
	if ( ! $form_id ) {
		$form_id = factory_request_viewing_before_v1_post( 'Factory Request Viewing Before v1', 'jet-form-builder', 'publish' );
		wp_update_post( [ 'ID' => $form_id, 'post_content' => $content ] );
		update_post_meta( $form_id, '_factory_request_viewing_before_v1_owner', 'request_viewing_before_v1' );
		update_post_meta( $form_id, '_factory_request_viewing_before_v1_version', '1.0.0' );
		factory_request_viewing_before_v1_store_form_actions( $form_id );
	}
	$stored_content = (string) get_post_field( 'post_content', $form_id );
	$binding = [ 'form_id' => $form_id, 'form_sha256' => hash( 'sha256', $stored_content ), 'email_field' => 'email', 'phone_field' => 'phone', 'property_field' => 'property_id', 'guard_field' => '_factory_policy_guard', 'guard_value' => 'request_viewing_before_v1' ];
	if ( $stored_binding && $stored_binding !== $binding ) {
		throw new RuntimeException( 'fixture_form_binding_conflict' );
	}
	if ( $stored_binding !== $binding ) {
		update_option( 'factory_request_viewing_before_v1_binding', $binding, false );
	}
	if ( $form_id !== (int) ( $stored_binding['form_id'] ?? 0 ) ) {
		$contact_url = get_permalink( $owned_entities['contact_id'] );
		foreach ( [ 'property_a', 'property_b' ] as $key ) {
			$property_id = $owned_entities[ $key ];
			wp_update_post( [ 'ID' => $property_id, 'post_content' => '<p>Fixture property.</p><p><a class="factory-request-viewing-cta" href="' . esc_url( add_query_arg( 'factory_property_id', $property_id, $contact_url ) ) . '">Request viewing</a></p>' ] );
		}
		wp_update_post( [ 'ID' => $owned_entities['contact_id'], 'post_content' => '<section class="factory-request-viewing-before-v1"><h1>Request a Viewing</h1>[jet_fb_form form_id="' . $form_id . '" submit_type="ajax"]</section>' ] );
	}
	$contact_url = get_permalink( $owned_entities['contact_id'] );
	return [ 'form_id' => $form_id, 'binding' => $binding, 'entities' => $entities, 'contact_url' => $contact_url, 'form_records' => $form_records ];
}

if ( defined( 'FACTORY_REQUEST_VIEWING_BEFORE_V1_TESTING' ) && FACTORY_REQUEST_VIEWING_BEFORE_V1_TESTING ) {
	return;
}

$mode = getenv( 'FACTORY_REQUEST_VIEWING_BEFORE_V1_MODE' ) ?: '';
try {
$result = 'base' === $mode ? factory_request_viewing_before_v1_base() : ( 'form' === $mode ? factory_request_viewing_before_v1_form() : ( 'repair_actions' === $mode ? factory_request_viewing_before_v1_repair_actions() : ( 'controls' === $mode ? factory_request_viewing_before_v1_controls() : null ) ) );
	if ( ! is_array( $result ) ) { throw new RuntimeException( 'fixture_mode_invalid' ); }
	echo wp_json_encode( $result, JSON_UNESCAPED_SLASHES );
} catch ( Throwable $error ) {
	fwrite( STDERR, $error->getMessage() . "\n" );
	exit( 1 );
}
