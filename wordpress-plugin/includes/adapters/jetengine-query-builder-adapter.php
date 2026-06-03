<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_JetEngine_Query_Builder_Adapter {

	private const QUERY_ID_PREFIX = 'factory_';

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		// Query Builder rows are synced during apply only.
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];
		$queries                 = $this->get_blueprint_queries( $blueprint );

		if ( empty( $queries ) ) {
			return;
		}

		if ( ! $this->is_query_builder_available() ) {
			foreach ( $queries as $query ) {
				$this->execution_results[] = $this->execution_item(
					'error',
					'skip',
					$query['slug'],
					"JetEngine Query Builder unavailable. Query sync skipped: {$query['slug']}"
				);
			}

			return;
		}

		foreach ( $queries as $query ) {
			$this->execution_results[] = $this->upsert_query( $query );
		}
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
		$plan    = [];
		$queries = $this->get_blueprint_queries( $blueprint );

		if ( empty( $queries ) ) {
			return $plan;
		}

		if ( ! $this->is_query_builder_available() ) {
			foreach ( $queries as $query ) {
				$plan[] = [
					'action'  => 'error',
					'type'    => 'query',
					'entity'  => $query['slug'],
					'message' => "JetEngine Query Builder unavailable. Query cannot be synced: {$query['slug']}",
				];
			}

			return $plan;
		}

		foreach ( $queries as $query ) {
			$target_state = $this->get_target_query_state( $query );
			$existing     = $this->find_existing_query( $query );

			if ( ! $existing ) {
				$plan[] = [
					'action'  => 'create',
					'type'    => 'query',
					'entity'  => $query['slug'],
					'message' => "Create JetEngine Query Builder query: {$query['slug']}",
				];

				continue;
			}

			$current_state = $this->get_current_query_state( $existing );
			$diff          = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$plan[] = [
					'action'  => 'skip',
					'type'    => 'query',
					'entity'  => $query['slug'],
					'message' => "JetEngine Query Builder query up-to-date: {$query['slug']}",
				];

				continue;
			}

			$plan[] = [
				'action'  => 'update',
				'type'    => 'query',
				'entity'  => $query['slug'],
				'message' => "Update JetEngine Query Builder query: {$query['slug']}",
				'diff'    => $diff,
			];
		}

		return $plan;
	}

	public function validate( array $blueprint ): array {
		$checks  = [];
		$queries = $this->get_blueprint_queries( $blueprint );

		if ( empty( $queries ) ) {
			return $checks;
		}

		if ( ! $this->is_query_builder_available() ) {
			foreach ( $queries as $query ) {
				$checks[] = [
					'status'  => 'error',
					'message' => "JetEngine Query Builder unavailable: {$query['slug']}",
				];
			}

			return $checks;
		}

		foreach ( $queries as $query ) {
			$existing = $this->find_existing_query( $query );

			if ( ! $existing ) {
				$checks[] = [
					'status'  => 'error',
					'message' => "JetEngine Query Builder query missing: {$query['slug']}",
				];

				continue;
			}

			$args       = $this->get_row_args( $existing );
			$query_id   = $this->get_query_id( $query );
			$posts_args = $args['posts'] ?? [];

			$checks[] = [
				'status'  => 'posts' === ( $args['query_type'] ?? '' ) ? 'ok' : 'error',
				'message' => 'posts' === ( $args['query_type'] ?? '' )
					? "JetEngine query type valid: {$query['slug']}"
					: "JetEngine query type invalid: {$query['slug']}",
			];

			$checks[] = [
				'status'  => $query_id === ( $args['query_id'] ?? '' ) ? 'ok' : 'error',
				'message' => $query_id === ( $args['query_id'] ?? '' )
					? "JetEngine query ID valid: {$query_id}"
					: "JetEngine query ID invalid: {$query['slug']}",
			];

			$post_types = $this->normalize_list( $posts_args['post_type'] ?? [] );

			$checks[] = [
				'status'  => in_array( $query['post_type'], $post_types, true ) ? 'ok' : 'error',
				'message' => in_array( $query['post_type'], $post_types, true )
					? "JetEngine query post type valid: {$query['post_type']}"
					: "JetEngine query post type missing: {$query['post_type']}",
			];

			$post_statuses = $this->normalize_list( $posts_args['post_status'] ?? [] );

			$checks[] = [
				'status'  => in_array( $query['post_status'], $post_statuses, true ) ? 'ok' : 'error',
				'message' => in_array( $query['post_status'], $post_statuses, true )
					? "JetEngine query post status valid: {$query['post_status']}"
					: "JetEngine query post status missing: {$query['post_status']}",
			];

			if ( ! empty( $query['native_filters'] ) ) {
				foreach ( $this->validate_native_query_shape( $query, $existing, $args, $posts_args ) as $native_check ) {
					$checks[] = $native_check;
				}
			}
		}

		return $checks;
	}

	private function validate_native_query_shape( array $query, array $row, array $args, array $posts_args ): array {
		$checks = [];
		$slug   = $query['slug'];

		$checks[] = [
			'status'  => 'query' === ( $row['status'] ?? '' ) ? 'ok' : 'error',
			'message' => 'query' === ( $row['status'] ?? '' )
				? "Native JetSmartFilters query row status valid: {$slug}"
				: "Native JetSmartFilters query row status invalid: {$slug}",
		];

		foreach ( [ 'tax_query', 'meta_query', 'date_query' ] as $query_key ) {
			$is_empty = empty( $posts_args[ $query_key ] );

			$checks[] = [
				'status'  => $is_empty ? 'ok' : 'error',
				'message' => $is_empty
					? "Native JetSmartFilters {$query_key} empty: {$slug}"
					: "Native JetSmartFilters {$query_key} must stay empty: {$slug}",
			];
		}

		$cache_query = $args['cache_query'] ?? false;
		$cache_off   = false === $cache_query || 'false' === $cache_query || 0 === $cache_query || '0' === $cache_query || '' === $cache_query;

		$checks[] = [
			'status'  => $cache_off ? 'ok' : 'error',
			'message' => $cache_off
				? "Native JetSmartFilters query cache disabled: {$slug}"
				: "Native JetSmartFilters query cache should be disabled: {$slug}",
		];

		return $checks;
	}

	private function upsert_query( array $query ): array {
		$existing     = $this->find_existing_query( $query );
		$target_item  = $this->get_target_query_item( $query );
		$target_state = $this->get_target_query_state( $query );

		if ( $existing ) {
			$current_state = $this->get_current_query_state( $existing );

			if ( empty( factory_diff_arrays( $current_state, $target_state ) ) ) {
				return $this->execution_item(
					'ok',
					'skip',
					$query['slug'],
					"JetEngine Query Builder query up-to-date: {$query['slug']}"
				);
			}

			$target_item['id'] = (int) ( $existing['id'] ?? 0 );
			$result           = $this->save_query_item( $target_item );

			return $this->execution_item(
				$result ? 'ok' : 'error',
				'update',
				$query['slug'],
				$result
					? "JetEngine Query Builder query updated: {$query['slug']}"
					: "JetEngine Query Builder query update failed: {$query['slug']}"
			);
		}

		$result = $this->save_query_item( $target_item );

		return $this->execution_item(
			$result ? 'ok' : 'error',
			'create',
			$query['slug'],
			$result
				? "JetEngine Query Builder query created: {$query['slug']}"
				: "JetEngine Query Builder query create failed: {$query['slug']}"
		);
	}

	private function save_query_item( array $item ) {
		$manager = $this->get_query_builder_manager();

		if ( ! $manager || empty( $manager->data ) || ! method_exists( $manager->data, 'update_item_in_db' ) ) {
			return false;
		}

		if ( method_exists( $manager->data, 'ensure_db_table' ) ) {
			$manager->data->ensure_db_table();
		}

		$result = $manager->data->update_item_in_db( $item );

		if ( method_exists( $manager->data, 'reset_raw_cache' ) ) {
			$manager->data->reset_raw_cache();
		}

		if ( function_exists( 'jet_engine' ) && isset( jet_engine()->db->query_cache ) ) {
			jet_engine()->db->query_cache = [];
		}

		if ( $result ) {
			do_action( 'jet-engine/query-builder/after-query-update', $manager->data );
		}

		return $result;
	}

	private function find_existing_query( array $query ): ?array {
		$query_id    = $this->get_query_id( $query );
		$description = $this->get_description( $query );

		foreach ( $this->get_existing_query_rows() as $row ) {
			$args = $this->get_row_args( $row );

			if ( ( $args['query_id'] ?? '' ) === $query_id ) {
				return $row;
			}

			if ( ( $args['description'] ?? '' ) === $description ) {
				return $row;
			}
		}

		return null;
	}

	private function get_existing_query_rows(): array {
		$manager = $this->get_query_builder_manager();

		if ( ! $manager || empty( $manager->data ) || empty( $manager->data->db ) ) {
			return [];
		}

		$rows = $manager->data->db->query( $manager->data->table, [ 'status' => 'query' ], null, false );

		return is_array( $rows ) ? $rows : [];
	}

	private function get_current_query_state( array $row ): array {
		$labels = $this->get_row_labels( $row );
		$args   = $this->get_row_args( $row );

		return [
			'label' => $labels['name'] ?? '',
			'args'  => $this->normalize_array_for_diff( $this->get_comparable_args( $args ) ),
		];
	}

	private function get_target_query_state( array $query ): array {
		return [
			'label' => $query['label'],
			'args'  => $this->normalize_array_for_diff( $this->get_comparable_args( $this->get_target_args( $query ) ) ),
		];
	}

	private function get_target_query_item( array $query ): array {
		return [
			'slug'        => null,
			'status'      => 'query',
			'labels'      => [
				'name' => $query['label'],
			],
			'args'        => $this->get_target_args( $query ),
			'meta_fields' => [],
		];
	}

	private function get_target_args( array $query ): array {
		$args = [
			'query_type'      => 'posts',
			'query_id'        => $this->get_query_id( $query ),
			'description'     => $this->get_description( $query ),
			'posts'           => [
				'post_type'      => [ $query['post_type'] ],
				'post_status'    => [ $query['post_status'] ],
				'posts_per_page' => $query['posts_per_page'],
				'orderby'        => [
					[
						'orderby' => $query['orderby'],
						'order'   => $query['order'],
					],
				],
			],
			'__dynamic_posts' => [],
		];

		if ( ! empty( $query['native_filters'] ) ) {
			$args['posts']['tax_query']  = [];
			$args['posts']['meta_query'] = [];
			$args['posts']['date_query'] = [];
			$args['cache_query']         = false;
		}

		return $args;
	}

	private function get_comparable_args( array $args ): array {
		return [
			'query_type'      => $args['query_type'] ?? '',
			'query_id'        => $args['query_id'] ?? '',
			'description'     => $args['description'] ?? '',
			'posts'           => $args['posts'] ?? [],
			'__dynamic_posts' => $args['__dynamic_posts'] ?? [],
			'cache_query'     => (bool) ( $args['cache_query'] ?? false ),
		];
	}

	private function get_blueprint_queries( array $blueprint ): array {
		$queries = [];

		foreach ( $blueprint['queries'] ?? [] as $query ) {
			if ( ! is_array( $query ) ) {
				continue;
			}

			$provider = $query['provider'] ?? 'jetengine';
			$type     = $query['type'] ?? 'posts';
			$slug     = sanitize_key( $query['slug'] ?? '' );

			if ( 'jetengine' !== $provider || 'posts' !== $type || ! $slug ) {
				continue;
			}

			$queries[] = [
				'slug'           => $slug,
				'label'          => sanitize_text_field( $query['label'] ?? $slug ),
				'query_id'       => sanitize_key( $query['query_id'] ?? '' ),
				'native_filters' => filter_var( $query['native_filters'] ?? false, FILTER_VALIDATE_BOOLEAN ),
				'provider'       => 'jetengine',
				'type'           => 'posts',
				'post_type'      => sanitize_key( $query['post_type'] ?? 'post' ),
				'post_status'    => sanitize_key( $query['post_status'] ?? 'publish' ),
				'posts_per_page' => max( 1, min( 100, absint( $query['posts_per_page'] ?? 10 ) ) ),
				'orderby'        => $this->sanitize_orderby( $query['orderby'] ?? 'date' ),
				'order'          => $this->sanitize_order( $query['order'] ?? 'DESC' ),
			];
		}

		return $queries;
	}

	private function is_query_builder_available(): bool {
		$manager = $this->get_query_builder_manager();

		return $manager
			&& ! empty( $manager->data )
			&& method_exists( $manager->data, 'update_item_in_db' );
	}

	private function get_query_builder_manager() {
		if ( ! function_exists( 'jet_engine' ) ) {
			return null;
		}

		if ( ! class_exists( 'Jet_Engine\\Query_Builder\\Manager' ) ) {
			return null;
		}

		return \Jet_Engine\Query_Builder\Manager::instance();
	}

	private function get_row_args( array $row ): array {
		$args = $row['args'] ?? [];
		$args = maybe_unserialize( $args );

		return is_array( $args ) ? $args : [];
	}

	private function get_row_labels( array $row ): array {
		$labels = $row['labels'] ?? [];
		$labels = maybe_unserialize( $labels );

		return is_array( $labels ) ? $labels : [];
	}

	private function get_query_id( array $query ): string {
		if ( ! empty( $query['query_id'] ) ) {
			return $query['query_id'];
		}

		return self::QUERY_ID_PREFIX . $query['slug'];
	}

	private function get_description( array $query ): string {
		return 'Generated by Crocoblock Site Factory: ' . $query['slug'];
	}

	private function normalize_list( $value ): array {
		if ( is_array( $value ) ) {
			return array_values( array_filter( array_map( 'strval', $value ) ) );
		}

		if ( is_string( $value ) && '' !== $value ) {
			return [ $value ];
		}

		return [];
	}

	private function normalize_array_for_diff( $value ): array {
		if ( ! is_array( $value ) ) {
			return [];
		}

		foreach ( $value as $key => $child ) {
			if ( is_array( $child ) ) {
				$value[ $key ] = $this->normalize_array_for_diff( $child );
			}
		}

		ksort( $value );

		return $value;
	}

	private function sanitize_orderby( $value ): string {
		$value   = is_string( $value ) ? $value : 'date';
		$allowed = [ 'date', 'ID', 'title', 'menu_order', 'modified' ];

		return in_array( $value, $allowed, true ) ? $value : 'date';
	}

	private function sanitize_order( $value ): string {
		$value = strtoupper( is_string( $value ) ? $value : 'DESC' );

		return in_array( $value, [ 'ASC', 'DESC' ], true ) ? $value : 'DESC';
	}

	private function execution_item(
		string $status,
		string $action,
		string $entity,
		string $message
	): array {
		return [
			'status'  => $status,
			'action'  => $action,
			'type'    => 'query',
			'entity'  => $entity,
			'message' => $message,
			'details' => [],
		];
	}
}
