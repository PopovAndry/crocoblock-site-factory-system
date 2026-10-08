<?php

declare( strict_types=1 );

$repo_root = dirname( __DIR__, 2 );

define( 'ABSPATH', __DIR__ . DIRECTORY_SEPARATOR );

class WP_Query {
	private array $query_vars;

	public function __construct( array $query_vars = [] ) {
		$this->query_vars = $query_vars;
	}

	public function get( string $key ) {
		return $this->query_vars[ $key ] ?? null;
	}
}

class Factory_Test_Wpdb {
	public string $posts    = 'wp_posts';
	public string $postmeta = 'wp_postmeta';

	public function prepare( string $query, ...$values ): string {
		foreach ( $values as $value ) {
			$query = preg_replace( '/%s/', "'" . addslashes( (string) $value ) . "'", $query, 1 );
		}

		return $query;
	}
}

$factory_options = [];
$factory_binding = [];
$_GET            = [];
$factory_query_vars = [ 'paged' => 2, 'page' => 0 ];
$wpdb = new Factory_Test_Wpdb();

function get_option( string $key, $default = false ) {
	global $factory_options;

	return $factory_options[ $key ] ?? $default;
}

function factory_runtime_binding_v1_read(): array {
	global $factory_binding;

	return $factory_binding;
}

function wp_unslash( $value ) {
	return is_string( $value ) ? stripslashes( $value ) : $value;
}

function sanitize_text_field( $value ): string {
	return is_string( $value ) ? $value : '';
}

function absint( $value ): int {
	return abs( (int) $value );
}

function get_query_var( string $key ) {
	global $factory_query_vars;

	return $factory_query_vars[ $key ] ?? 0;
}

function get_permalink(): string {
	return 'https://example.test/properties/';
}

function home_url( string $path = '' ): string {
	return 'https://example.test' . $path;
}

function add_query_arg( array $args, string $url ): string {
	return $url . '?' . http_build_query( $args, '', '&', PHP_QUERY_RFC3986 );
}

function get_term_by( string $field, string $value, string $taxonomy ) {
	return (object) [ 'slug' => sanitize_title( $value ) ];
}

function sanitize_title( string $value ): string {
	return strtolower( str_replace( ' ', '-', $value ) );
}

require_once $repo_root . '/wordpress-plugin/includes/adapters/render-adapter.php';

function assertion( bool $condition, string $message ): void {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

function private_call( object $target, string $method, ...$arguments ) {
	$reflection = new ReflectionMethod( $target, $method );
	$reflection->setAccessible( true );

	return $reflection->invoke( $target, ...$arguments );
}

function activation( string $project_id = '12345678-1234-1234-1234-123456789abc' ): array {
	return [
		'schema_version' => 1,
		'state'          => 'enabled',
		'project_id'     => $project_id,
		'plan_id'        => 'property-area-range-plan-12345678-1234-1234-1234-123456789abc',
		'snapshot_id'    => 'snapshot-2026-10-08t10-00-00-000z-abcdef',
		'operation_id'   => 'op-2026-10-08T10-00-00-000Z-abcdef',
	];
}

function write_binding( string $project_id = '12345678-1234-1234-1234-123456789abc' ): void {
	global $factory_binding;

	$factory_binding = [
		'ok'      => true,
		'binding' => [
			'project_id'   => $project_id,
			'project_slug' => 'property-area-range-test',
		],
	];
}

function set_request( array $request, array $options ): void {
	global $_GET, $factory_options;

	$_GET            = $request;
	$factory_options = $options;
}

function evaluate_area_meta_query( array $meta_query, array $values ): array {
	$range_clauses = array_values( array_filter( $meta_query, static function ( $clause ): bool {
		return is_array( $clause ) && 'property_size' === ( $clause['key'] ?? null );
	} ) );
	$matched       = [];

	foreach ( $values as $id => $value ) {
		$ok = true;
		foreach ( $range_clauses as $clause ) {
			if ( 'REGEXP' === $clause['compare'] ) {
				$ok = is_string( $value ) && 1 === preg_match( '/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/D', $value );
			} elseif ( 'BETWEEN' === $clause['compare'] ) {
				$ok = $ok && (float) $value >= (float) $clause['value'][0] && (float) $value <= (float) $clause['value'][1];
			} elseif ( '>=' === $clause['compare'] ) {
				$ok = $ok && (float) $value >= (float) $clause['value'];
			} elseif ( '<=' === $clause['compare'] ) {
				$ok = $ok && (float) $value <= (float) $clause['value'];
			}
			if ( ! $ok ) {
				break;
			}
		}
		if ( $ok ) {
			$matched[] = $id;
		}
	}

	return $matched;
}

function same_row_area_match( array $values, string $area_min, string $area_max ): bool {
	foreach ( $values as $value ) {
		if ( ! is_string( $value ) || 1 !== preg_match( '/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/D', $value ) ) {
			continue;
		}

		if ( (float) $value >= (float) $area_min && (float) $value <= (float) $area_max ) {
			return true;
		}
	}

	return false;
}

write_binding();
$adapter = new Factory_Render_Adapter();

	set_request( [ 'area_min' => '74', 'area_max' => '80' ], [] );
	$inactive_state = private_call( $adapter, 'get_property_filter_state' );
	$inactive_query = private_call( $adapter, 'apply_property_filters_to_query_args', [ 'post_type' => 'property' ], $inactive_state );
	assertion( false === $inactive_state['area_range_enabled'], 'absent_option_must_disable_area_range' );
	assertion( [ 'post_type' => 'property' ] === $inactive_query, 'unactivated_query_must_remain_unchanged' );

	set_request( [ 'area_min' => '74.00', 'area_max' => '74.12', 'purpose' => 'Sale', 'price_min' => '100000', 'factory_sort' => 'price_desc', 'factory_per_page' => '12' ], [ 'factory_property_area_range_v1' => activation() ] );
	$active_state = private_call( $adapter, 'get_property_filter_state' );
	$active_query = private_call( $adapter, 'apply_property_filters_to_query_args', [ 'post_type' => 'property' ], $active_state );
	$controlled_query = private_call( $adapter, 'apply_property_archive_controls_to_query_args', $active_query, $active_state );
	$active_where = $adapter->filter_property_area_range_where( ' WHERE 1=1', new WP_Query( $active_query ) );
	assertion( true === $active_state['area_range_enabled'] && false === $active_state['area_range_invalid'], 'exact_option_must_enable_valid_bounds' );
	assertion( [ 'area_min' => '74.00', 'area_max' => '74.12' ] === $active_query['factory_property_area_range'], 'two_sided_range_must_remain_a_trusted_query_argument' );
	assertion( str_contains( $active_where, 'EXISTS ( SELECT 1 FROM wp_postmeta AS factory_area_meta WHERE factory_area_meta.post_id = wp_posts.ID' ) && str_contains( $active_where, "factory_area_meta.meta_value REGEXP '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$'" ) && str_contains( $active_where, 'CAST(factory_area_meta.meta_value AS DECIMAL(12,2)) BETWEEN CAST(\'74.00\' AS DECIMAL(12,2)) AND CAST(\'74.12\' AS DECIMAL(12,2))' ), 'one_meta_row_must_satisfy_both_canonicality_and_inclusive_decimal_range' );
	assertion( 'price' === $controlled_query['meta_key'] && 'DESC' === $controlled_query['order'] && 12 === $controlled_query['posts_per_page'] && 2 === $controlled_query['paged'], 'existing_sort_and_pagination_must_be_preserved' );
	assertion( same_row_area_match( [ '74' ], '74.00', '74.12' ) && same_row_area_match( [ '74.00' ], '74.00', '74.12' ) && same_row_area_match( [ '74.12' ], '74.00', '74.12' ) && ! same_row_area_match( [ '74.125' ], '74.00', '74.12' ) && ! same_row_area_match( [ '074' ], '74.00', '74.12' ) && ! same_row_area_match( [ null ], '74.00', '74.12' ) && ! same_row_area_match( [ '74.13' ], '74.00', '74.12' ), 'single_row_semantics_must_include_endpoints_and_exclude_noncanonical_or_missing_values' );
	assertion( ! same_row_area_match( [ '120', '074' ], '74.00', '74.12' ), 'multiple_property_size_rows_must_not_combine_canonicality_from_one_row_with_range_from_another' );

	set_request( [ 'area_min' => '74.12' ], [ 'factory_property_area_range_v1' => activation() ] );
	$one_sided_state = private_call( $adapter, 'get_property_filter_state' );
	$one_sided_query = private_call( $adapter, 'apply_property_filters_to_query_args', [], $one_sided_state );
	$one_sided_where = $adapter->filter_property_area_range_where( ' WHERE 1=1', new WP_Query( $one_sided_query ) );
	assertion( str_contains( $one_sided_where, 'CAST(factory_area_meta.meta_value AS DECIMAL(12,2)) >= CAST(\'74.12\' AS DECIMAL(12,2))' ), 'one_sided_minimum_must_use_decimal_comparison' );

	set_request( [ 'area_max' => '74.12' ], [ 'factory_property_area_range_v1' => activation() ] );
	$upper_only_state = private_call( $adapter, 'get_property_filter_state' );
	$upper_only_query = private_call( $adapter, 'apply_property_filters_to_query_args', [], $upper_only_state );
	$upper_only_where = $adapter->filter_property_area_range_where( ' WHERE 1=1', new WP_Query( $upper_only_query ) );
	assertion( str_contains( $upper_only_where, 'CAST(factory_area_meta.meta_value AS DECIMAL(12,2)) <= CAST(\'74.12\' AS DECIMAL(12,2))' ), 'one_sided_maximum_must_use_decimal_comparison' );

	set_request( [ 'area_min' => '', 'area_max' => '' ], [ 'factory_property_area_range_v1' => activation() ] );
	$empty_range_state = private_call( $adapter, 'get_property_filter_state' );
	$empty_range_query = private_call( $adapter, 'apply_property_filters_to_query_args', [ 'post_type' => 'property' ], $empty_range_state );
	assertion( true === $empty_range_state['area_range_enabled'] && false === $empty_range_state['area_range_invalid'] && [ 'post_type' => 'property' ] === $empty_range_query, 'empty_enabled_bounds_must_keep_the_base_catalog' );

	foreach ( [
		[ 'area_min' => '74.125' ],
		[ 'area_min' => '7e1' ],
		[ 'area_min' => '075' ],
		[ 'area_min' => '90', 'area_max' => '74' ],
		[ 'area_min' => [ '74' ] ],
	] as $invalid_request ) {
		set_request( $invalid_request, [ 'factory_property_area_range_v1' => activation() ] );
		$invalid_state = private_call( $adapter, 'get_property_filter_state' );
		$invalid_query = private_call( $adapter, 'apply_property_filters_to_query_args', [ 'post_type' => 'property' ], $invalid_state );
		assertion( true === $invalid_state['area_range_invalid'] && [ 0 ] === $invalid_query['post__in'], 'invalid_range_must_fail_closed' );
	}

	set_request( [ 'area_min' => '74', 'area_max' => '80', 'purpose' => 'Sale', 'factory_sort' => 'price_desc', 'factory_per_page' => '12' ], [ 'factory_property_area_range_v1' => activation() ] );
	$reset_url = private_call( $adapter, 'get_property_area_range_reset_url' );
	assertion( false === str_contains( $reset_url, 'area_min' ) && false === str_contains( $reset_url, 'area_max' ), 'area_reset_must_remove_only_area_bounds' );
	assertion( str_contains( $reset_url, 'purpose=Sale' ) && str_contains( $reset_url, 'factory_sort=price_desc' ) && str_contains( $reset_url, 'factory_per_page=12' ), 'area_reset_must_preserve_other_archive_state' );

	set_request( [ 'area_min' => '74', 'area_max' => '80', 'factory_property_area_range_v1' => 'enabled' ], [ 'factory_property_area_range_v1' => array_merge( activation(), [ 'extra' => 'rejected' ] ) ] );
	$invalid_activation_state = private_call( $adapter, 'get_property_filter_state' );
	assertion( false === $invalid_activation_state['area_range_enabled'], 'malformed_option_or_get_cannot_activate_area_range' );

	set_request( [ 'area_min' => '74' ], [ 'factory_property_area_range_v1' => activation( 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' ) ] );
	$cross_project_state = private_call( $adapter, 'get_property_filter_state' );
	assertion( false === $cross_project_state['area_range_enabled'], 'cross_project_option_must_not_activate_area_range' );

echo json_encode( [
	'unactivated' => $inactive_state['area_range_enabled'],
	'active_range' => [ $active_state['area_min'], $active_state['area_max'] ],
	'reset_url' => $reset_url,
	'one_sided_compare' => str_contains( $one_sided_where, '>=' ) ? '>=' : '',
], JSON_THROW_ON_ERROR );
