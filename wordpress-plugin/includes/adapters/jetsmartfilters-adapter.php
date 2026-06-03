<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_JetSmartFilters_Adapter {

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		// JetSmartFilters definitions are synced during apply only.
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];
		$filters                 = $this->get_blueprint_filters( $blueprint );

		if ( empty( $filters ) ) {
			return;
		}

		if ( ! $this->is_jetsmartfilters_available() ) {
			foreach ( $filters as $filter ) {
				$this->execution_results[] = $this->execution_item(
					$filter['required'] ? 'error' : 'ok',
					'skip',
					$filter['slug'],
					$filter['required']
						? "JetSmartFilters unavailable. Required filter cannot be synced: {$filter['slug']}"
						: "JetSmartFilters unavailable. Optional native filter skipped; GET fallback remains active: {$filter['slug']}"
				);
			}

			return;
		}

		foreach ( $filters as $filter ) {
			$this->execution_results[] = $this->upsert_filter( $filter );
		}
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
		$plan    = [];
		$filters = $this->get_blueprint_filters( $blueprint );

		if ( empty( $filters ) ) {
			return $plan;
		}

		if ( ! $this->is_jetsmartfilters_available() ) {
			foreach ( $filters as $filter ) {
				$plan[] = [
					'action'  => $filter['required'] ? 'error' : 'skip',
					'type'    => 'filter',
					'entity'  => $filter['slug'],
					'message' => $filter['required']
						? "JetSmartFilters unavailable. Required filter cannot be synced: {$filter['slug']}"
						: "JetSmartFilters unavailable. Optional native filter would be skipped; GET fallback remains active: {$filter['slug']}",
				];
			}

			return $plan;
		}

		foreach ( $filters as $filter ) {
			$existing = $this->find_existing_filter( $filter['slug'] );

			if ( ! $existing ) {
				$plan[] = [
					'action'  => 'create',
					'type'    => 'filter',
					'entity'  => $filter['slug'],
					'message' => "Create JetSmartFilters filter: {$filter['label']}",
				];

				continue;
			}

			$current_state = $this->get_current_filter_state( $existing );
			$target_state  = $this->get_target_filter_state( $filter );
			$diff          = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$plan[] = [
					'action'  => 'skip',
					'type'    => 'filter',
					'entity'  => $filter['slug'],
					'message' => "JetSmartFilters filter up-to-date: {$filter['label']}",
				];

				continue;
			}

			$plan[] = [
				'action'  => 'update',
				'type'    => 'filter',
				'entity'  => $filter['slug'],
				'message' => "Update JetSmartFilters filter: {$filter['label']}",
				'diff'    => $diff,
			];
		}

		return $plan;
	}

	public function validate( array $blueprint ): array {
		$checks  = [];
		$filters = $this->get_blueprint_filters( $blueprint );

		if ( empty( $filters ) ) {
			return $checks;
		}

		if ( ! $this->is_jetsmartfilters_available() ) {
			foreach ( $filters as $filter ) {
				$checks[] = [
					'status'  => $filter['required'] ? 'error' : 'ok',
					'message' => $filter['required']
						? "JetSmartFilters unavailable for required filter: {$filter['slug']}"
						: "JetSmartFilters optional filter skipped; GET fallback remains active: {$filter['slug']}",
				];
			}

			return $checks;
		}

		foreach ( $filters as $filter ) {
			$existing = $this->find_existing_filter( $filter['slug'] );

			if ( ! $existing ) {
				$checks[] = [
					'status'  => 'error',
					'message' => "JetSmartFilters filter missing: {$filter['slug']}",
				];

				continue;
			}

			$current_state = $this->get_current_filter_state( $existing );
			$target_state  = $this->get_target_filter_state( $filter );

			$checks[] = [
				'status'  => $existing->post_type === 'jet-smart-filters' ? 'ok' : 'error',
				'message' => $existing->post_type === 'jet-smart-filters'
					? "JetSmartFilters filter post type valid: {$filter['slug']}"
					: "JetSmartFilters filter post type invalid: {$filter['slug']}",
			];

			foreach ( $target_state['meta'] as $key => $expected ) {
				$actual = $current_state['meta'][ $key ] ?? '';

				$checks[] = [
					'status'  => $actual === $expected ? 'ok' : 'error',
					'message' => $actual === $expected
						? "JetSmartFilters filter meta valid: {$filter['slug']} {$key}"
						: "JetSmartFilters filter meta invalid: {$filter['slug']} {$key}",
				];
			}
		}

		return $checks;
	}

	private function upsert_filter( array $filter ): array {
		$existing     = $this->find_existing_filter( $filter['slug'] );
		$target_state = $this->get_target_filter_state( $filter );

		if ( $existing ) {
			$current_state = $this->get_current_filter_state( $existing );
			$diff          = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				return $this->execution_item(
					'ok',
					'skip',
					$filter['slug'],
					"JetSmartFilters filter up-to-date: {$filter['label']}"
				);
			}

			$post_id = wp_update_post( [
				'ID'           => $existing->ID,
				'post_type'    => 'jet-smart-filters',
				'post_title'   => $filter['label'],
				'post_name'    => $filter['slug'],
				'post_status'  => 'publish',
				'post_content' => '',
			], true );

			if ( is_wp_error( $post_id ) ) {
				return $this->execution_item(
					'error',
					'update',
					$filter['slug'],
					"JetSmartFilters filter update failed: {$filter['label']}"
				);
			}

			$this->sync_filter_meta( (int) $post_id, $filter );

			return $this->execution_item(
				'ok',
				'update',
				$filter['slug'],
				"JetSmartFilters filter updated: {$filter['label']}"
			);
		}

		$post_id = wp_insert_post( [
			'post_type'    => 'jet-smart-filters',
			'post_title'   => $filter['label'],
			'post_name'    => $filter['slug'],
			'post_status'  => 'publish',
			'post_content' => '',
		], true );

		if ( is_wp_error( $post_id ) ) {
			return $this->execution_item(
				'error',
				'create',
				$filter['slug'],
				"JetSmartFilters filter create failed: {$filter['label']}"
			);
		}

		$this->sync_filter_meta( (int) $post_id, $filter );

		return $this->execution_item(
			'ok',
			'create',
			$filter['slug'],
			"JetSmartFilters filter created: {$filter['label']}"
		);
	}

	private function sync_filter_meta( int $post_id, array $filter ): void {
		foreach ( $this->get_target_filter_meta( $filter ) as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}
	}

	private function find_existing_filter( string $slug ): ?WP_Post {
		$posts = get_posts( [
			'post_type'   => 'jet-smart-filters',
			'post_status' => 'any',
			'numberposts' => 1,
			'meta_query'  => [
				'relation' => 'AND',
				[
					'key'   => '_factory_filter_key',
					'value' => $slug,
				],
				[
					'key'   => '_factory_filter_provider',
					'value' => 'jetsmartfilters',
				],
			],
		] );

		return $posts[0] ?? null;
	}

	private function get_current_filter_state( WP_Post $post ): array {
		return [
			'title' => $post->post_title,
			'meta'  => $this->normalize_array_for_diff( $this->get_filter_meta_state( $post->ID ) ),
		];
	}

	private function get_target_filter_state( array $filter ): array {
		return [
			'title' => $filter['label'],
			'meta'  => $this->normalize_array_for_diff( $this->get_target_filter_meta( $filter ) ),
		];
	}

	private function get_filter_meta_state( int $post_id ): array {
		$state = [];

		foreach ( $this->get_filter_meta_keys() as $key ) {
			$state[ $key ] = (string) get_post_meta( $post_id, $key, true );
		}

		return $state;
	}

	private function get_target_filter_meta( array $filter ): array {
		return [
			'_filter_type'               => 'select',
			'_data_source'               => 'taxonomies',
			'_source_taxonomy'           => $filter['taxonomy'],
			'_is_custom_query_var'       => '',
			'_custom_query_var'          => '',
			'_is_default_filter_value'   => '',
			'_default_filter_value'      => '',
			'_query_compare'             => 'equal',
			'_terms_orderby'             => 'name',
			'_terms_order'               => 'ASC',
			'_terms_relational_operator' => 'OR',
			'_all_option_label'          => 'All',
			'_factory_generated'         => '1',
			'_factory_filter_key'        => $filter['slug'],
			'_factory_filter_provider'   => 'jetsmartfilters',
		];
	}

	private function get_filter_meta_keys(): array {
		return [
			'_filter_type',
			'_data_source',
			'_source_taxonomy',
			'_is_custom_query_var',
			'_custom_query_var',
			'_is_default_filter_value',
			'_default_filter_value',
			'_query_compare',
			'_terms_orderby',
			'_terms_order',
			'_terms_relational_operator',
			'_all_option_label',
			'_factory_generated',
			'_factory_filter_key',
			'_factory_filter_provider',
		];
	}

	private function get_blueprint_filters( array $blueprint ): array {
		$filters = [];

		foreach ( $blueprint['filters'] ?? [] as $filter ) {
			if ( ! is_array( $filter ) ) {
				continue;
			}

			$provider  = sanitize_key( $filter['provider'] ?? '' );
			$type      = sanitize_key( $filter['type'] ?? '' );
			$source    = sanitize_key( $filter['source'] ?? '' );
			$slug      = sanitize_key( $filter['slug'] ?? '' );
			$taxonomy  = sanitize_key( $filter['taxonomy'] ?? '' );
			$query_var = sanitize_key( $filter['query_var'] ?? $taxonomy );

			if ( 'jetsmartfilters' !== $provider || 'select' !== $type || 'taxonomy' !== $source ) {
				continue;
			}

			if ( ! $slug || ! $taxonomy || ! $query_var ) {
				continue;
			}

			$filters[] = [
				'slug'      => $slug,
				'label'     => sanitize_text_field( $filter['label'] ?? $slug ),
				'provider'  => 'jetsmartfilters',
				'type'      => 'select',
				'source'    => 'taxonomy',
				'taxonomy'  => $taxonomy,
				'query_var' => $query_var,
				'query'     => sanitize_key( $filter['query'] ?? '' ),
				'listing'   => sanitize_key( $filter['listing'] ?? '' ),
				'required'  => filter_var( $filter['required'] ?? false, FILTER_VALIDATE_BOOLEAN ),
			];
		}

		return $filters;
	}

	private function is_jetsmartfilters_available(): bool {
		return post_type_exists( 'jet-smart-filters' )
			|| ( function_exists( 'jet_smart_filters' ) && '' !== (string) get_option( 'jet_smart_filters_version', '' ) );
	}

	private function normalize_array_for_diff( array $value ): array {
		ksort( $value );

		return $value;
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
			'type'    => 'filter',
			'entity'  => $entity,
			'message' => $message,
			'details' => [],
		];
	}
}
