<?php
if ( ! defined( 'ABSPATH' ) || 'cli' !== PHP_SAPI ) {
	exit( 1 );
}

const FACTORY_REQUEST_VIEWING_BEFORE_V1_SLUG = 'csf-st-viewing-before-v1';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_META = '_factory_request_viewing_before_v1_control';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_CONTROL_OWNER_META = '_factory_request_viewing_before_v1_owner';

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

function factory_request_viewing_before_v1_require_runtime(): void {
	if ( FACTORY_REQUEST_VIEWING_BEFORE_V1_SLUG !== get_option( 'factory_request_viewing_before_v1_runtime_slug' ) ) {
		throw new RuntimeException( 'fixture_runtime_binding_missing' );
	}
}

function factory_request_viewing_before_v1_control_post( string $control, string $slug, string $title, string $status ): int {
	$all_statuses = array_values( get_post_stati( [], 'names' ) );
	if ( ! in_array( 'trash', $all_statuses, true ) ) {
		$all_statuses[] = 'trash';
	}
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

function factory_request_viewing_before_v1_controls(): array {
	factory_request_viewing_before_v1_require_runtime();
	$private_property = factory_request_viewing_before_v1_control_post(
		'private_property_v1',
		'factory-request-viewing-before-v1-private-property',
		'Fixture Private Property',
		'private'
	);
	$trash_property = factory_request_viewing_before_v1_control_post(
		'trash_property_v1',
		'factory-request-viewing-before-v1-trash-property',
		'Fixture Trash Property',
		'trash'
	);
	$controls = compact( 'private_property', 'trash_property' );
	$entities = get_option( 'factory_request_viewing_before_v1_entities', [] );
	if ( ! is_array( $entities ) ) {
		throw new RuntimeException( 'fixture_entities_invalid' );
	}
	update_option( 'factory_request_viewing_before_v1_entities', array_merge( $entities, $controls ), false );
	return $controls;
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
	$contact_id = factory_request_viewing_before_v1_post( 'Fixture Contact', 'page', 'publish' );
	$property_a = factory_request_viewing_before_v1_post( 'Fixture Property A', 'property', 'publish' );
	$property_b = factory_request_viewing_before_v1_post( 'Fixture Property B', 'property', 'publish' );
	$wrong_type = factory_request_viewing_before_v1_post( 'Fixture Published Page', 'page', 'publish' );
	$draft_property = factory_request_viewing_before_v1_post( 'Fixture Draft Property', 'property', 'draft' );
	$controls = factory_request_viewing_before_v1_controls();
	update_option( 'factory_request_viewing_before_v1_entities', array_merge( compact( 'contact_id', 'property_a', 'property_b', 'wrong_type', 'draft_property' ), $controls ), false );
	return get_option( 'factory_request_viewing_before_v1_entities' );
}

function factory_request_viewing_before_v1_form(): array {
	factory_request_viewing_before_v1_require_runtime();
	if ( ! post_type_exists( 'jet-form-builder' ) ) {
		throw new RuntimeException( 'jetformbuilder_not_active' );
	}
	$entities = get_option( 'factory_request_viewing_before_v1_entities', [] );
	if ( empty( $entities['contact_id'] ) ) {
		throw new RuntimeException( 'fixture_entities_missing' );
	}
	$content = factory_request_viewing_before_v1_form_content();
	$form_id = factory_request_viewing_before_v1_post( 'Factory Request Viewing Before v1', 'jet-form-builder', 'publish' );
	wp_update_post( [ 'ID' => $form_id, 'post_content' => $content ] );
	update_post_meta( $form_id, '_factory_request_viewing_before_v1_owner', 'request_viewing_before_v1' );
	update_post_meta( $form_id, '_factory_request_viewing_before_v1_version', '1.0.0' );
	factory_request_viewing_before_v1_store_form_actions( $form_id );
	$stored_content = (string) get_post_field( 'post_content', $form_id );
	$binding = [ 'form_id' => $form_id, 'form_sha256' => hash( 'sha256', $stored_content ), 'email_field' => 'email', 'phone_field' => 'phone', 'property_field' => 'property_id', 'guard_field' => '_factory_policy_guard', 'guard_value' => 'request_viewing_before_v1' ];
	update_option( 'factory_request_viewing_before_v1_binding', $binding, false );
	$contact_url = get_permalink( (int) $entities['contact_id'] );
	foreach ( [ 'property_a', 'property_b' ] as $key ) {
		$property_id = (int) $entities[ $key ];
		wp_update_post( [ 'ID' => $property_id, 'post_content' => '<p>Fixture property.</p><p><a class="factory-request-viewing-cta" href="' . esc_url( add_query_arg( 'factory_property_id', $property_id, $contact_url ) ) . '">Request viewing</a></p>' ] );
	}
	wp_update_post( [ 'ID' => (int) $entities['contact_id'], 'post_content' => '<section class="factory-request-viewing-before-v1"><h1>Request a Viewing</h1>[jet_fb_form form_id="' . $form_id . '" submit_type="ajax"]</section>' ] );
	return [ 'form_id' => $form_id, 'binding' => $binding, 'entities' => $entities, 'contact_url' => $contact_url ];
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
