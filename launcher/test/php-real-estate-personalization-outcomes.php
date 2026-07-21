<?php

define( 'ABSPATH', __DIR__ );

class WP_Post {
	public string $post_title = 'Kyiv Realty';
	public string $post_content = '<header>Kyiv Realty</header><h1>Protected hero</h1><p>Safe subtitle</p><a>Browse listings</a>';
}

function sanitize_key( string $value ): string {
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( $value ) );
}

function sanitize_title( string $value ): string {
	return sanitize_key( str_replace( ' ', '-', $value ) );
}

function factory_get_blueprint(): array {
	return [ 'pages' => [ 'home' => [ 'slug' => 'home' ] ] ];
}

function factory_rest_get_real_estate_variable_defaults( array $blueprint ): array {
	return [
		'agency_name'   => 'Kyiv Realty',
		'hero_title'    => 'Protected hero',
		'hero_subtitle' => 'Safe subtitle',
		'hero_cta_text' => 'Browse listings',
	];
}

function get_page_by_path( string $slug ): ?WP_Post {
	return 'home' === $slug ? new WP_Post() : null;
}

function wp_strip_all_tags( string $value ): string {
	return strip_tags( $value );
}

function get_option( string $key, $default = false ) {
	return 'blogname' === $key ? 'Kyiv Realty' : $default;
}

require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/apply/real-estate-apply-service.php';

$variables = [
	'agency_name'   => 'Kyiv Realty',
	'hero_title'    => 'Protected hero',
	'hero_subtitle' => 'Safe subtitle',
	'hero_cta_text' => 'Browse listings',
];
$persisted_fields = factory_real_estate_apply_service_persisted_personalization_fields( $variables );
$applied = factory_real_estate_apply_service_personalization_outcomes(
	$variables,
	[
		[ 'status' => 'ok', 'action' => 'update', 'type' => 'page', 'entity' => 'home' ],
	],
	$persisted_fields
);
$preserved = factory_real_estate_apply_service_personalization_outcomes(
	$variables,
	[
		[ 'status' => 'warning', 'action' => 'skip', 'type' => 'page', 'entity' => 'home' ],
	],
	[]
);
$skipped = factory_real_estate_apply_service_personalization_outcomes(
	$variables,
	[
		[ 'status' => 'ok', 'action' => 'skip', 'type' => 'page', 'entity' => 'home' ],
	],
	array_keys( $variables )
);
$failed = factory_real_estate_apply_service_personalization_outcomes(
	$variables,
	[
		[ 'status' => 'error', 'action' => 'update', 'type' => 'page', 'entity' => 'home' ],
	],
	[]
);

echo json_encode(
	[
		'persisted_agency_is_applied' => in_array( 'agency_name', $persisted_fields, true ) && in_array( 'agency_name', $applied['applied_fields'], true ),
		'preserved_field_not_applied' => in_array( 'hero_title', $preserved['preserved_fields'], true ) && ! in_array( 'hero_title', $preserved['applied_fields'], true ),
		'skipped_field_not_applied'   => in_array( 'hero_subtitle', $skipped['skipped_fields'], true ) && ! in_array( 'hero_subtitle', $skipped['applied_fields'], true ),
		'failed_field_not_applied'    => in_array( 'hero_cta_text', $failed['failed_fields'], true ) && ! in_array( 'hero_cta_text', $failed['applied_fields'], true ),
	],
	JSON_UNESCAPED_SLASHES
);
