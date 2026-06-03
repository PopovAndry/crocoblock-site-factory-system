<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_JetEngine_Listing_Adapter {

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		// Listings are created on apply only.
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];

		if ( ! function_exists( 'jet_engine' ) ) {
			$this->log( 'JetEngine not active. Listing sync skipped.' );

			foreach ( $blueprint['listings'] ?? [] as $listing ) {
				$title = $listing['title'] ?? ( $listing['slug'] ?? 'JetEngine' );

				$this->execution_results[] = $this->execution_item(
					'error',
					'skip',
					$title,
					'JetEngine not active. Listing sync skipped.'
				);
			}

			return;
		}

		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			$result = $this->upsert_listing( $listing );

			if ( is_array( $result ) ) {
				$this->execution_results[] = $result;
			}
		}
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
	$plan = [];

	if ( ! function_exists( 'jet_engine' ) ) {
		$plan[] = [
			'action'  => 'warning',
			'type'    => 'listing',
			'entity'  => 'JetEngine',
			'message' => 'JetEngine not active. Listing sync would be skipped.',
		];

		return $plan;
	}

	foreach ( $blueprint['listings'] ?? [] as $listing ) {
		$slug      = $listing['slug'] ?? '';
		$title     = $listing['title'] ?? $slug;
		$post_type = $listing['post_type'] ?? '';
		$query_slug = $this->get_listing_query_slug( $listing );

		if ( ! $slug || ! $post_type ) {
			$plan[] = [
				'action'  => 'error',
				'type'    => 'listing',
				'entity'  => $title ?: 'unknown',
				'message' => 'Listing slug or post_type is missing.',
			];

			continue;
		}

		if ( $query_slug && ! $this->resolve_jetengine_query_row_id( $query_slug ) ) {
			$plan[] = [
				'action'  => 'error',
				'type'    => 'listing',
				'entity'  => $title,
				'message' => "Listing query missing: {$query_slug}",
			];

			continue;
		}

		$content  = $this->generate_blocks( $listing );
		$existing = $this->find_listing_by_slug( $slug );

		$target_state = $this->get_target_listing_state( $listing, $content );

		if ( ! $existing ) {
			$plan[] = [
				'action'  => 'create',
				'type'    => 'listing',
				'entity'  => $title,
				'message' => "Create listing: {$title}",
			];

			continue;
		}

		$current_state = $this->get_current_listing_state( $existing, $listing );
		$diff          = factory_diff_arrays( $current_state, $target_state );

		if ( empty( $diff ) ) {
			$plan[] = [
				'action'  => 'skip',
				'type'    => 'listing',
				'entity'  => $title,
				'message' => "Listing up-to-date: {$title}",
			];

			continue;
		}

		$plan[] = [
			'action'  => 'update',
			'type'    => 'listing',
			'entity'  => $title,
			'message' => "Update listing: {$title}",
			'diff'    => $diff,
		];
	}

	return $plan;
}

public function validate( array $blueprint ): array {
	$results = [];

	foreach ( $blueprint['listings'] ?? [] as $listing ) {

		$slug  = $listing['slug'] ?? '';
		$title = $listing['title'] ?? $slug;

		$existing = $this->find_listing_by_slug( $slug );

		if ( ! $existing ) {
			$results[] = [
				'status'  => 'error',
				'message' => "Listing missing: {$title}",
			];
			continue;
		}

		$query_slug = $this->get_listing_query_slug( $listing );

		if ( $query_slug && ! $this->resolve_jetengine_query_row_id( $query_slug ) ) {
			$results[] = [
				'status'  => 'error',
				'message' => "Listing query missing: {$query_slug}",
			];
			continue;
		}

		$content       = $this->generate_blocks( $listing );
		$current_state = $this->get_current_listing_state( $existing, $listing );
		$target_state  = $this->get_target_listing_state( $listing, $content );

		$diff = factory_diff_arrays( $current_state, $target_state );

		if ( ! empty( $diff ) ) {
			$results[] = [
				'status'  => 'error',
				'message' => "Listing out of sync: {$title}",
			];
			continue;
		}

		$results[] = [
			'status'  => 'ok',
			'message' => "Listing up-to-date: {$title}",
		];
	}

	return $results;
}

	private function upsert_listing( array $listing ): ?array {
		$slug      = $listing['slug'] ?? '';
		$title     = $listing['title'] ?? $slug;
		$post_type = $listing['post_type'] ?? '';
		$query_slug = $this->get_listing_query_slug( $listing );

		if ( ! $slug || ! $post_type ) {
			$this->warn( 'Listing slug or post_type is missing.' );

			return $this->execution_item(
				'error',
				'create',
				$title ?: 'unknown',
				'Listing slug or post_type is missing.'
			);
		}

		if ( $query_slug && ! $this->resolve_jetengine_query_row_id( $query_slug ) ) {
			$this->warn( "Listing query missing: {$query_slug}" );

			return $this->execution_item(
				'error',
				'update',
				$title,
				"Listing query missing: {$query_slug}"
			);
		}

		$content  = $this->generate_blocks( $listing );
		$existing = $this->find_listing_by_slug( $slug );

		$target_state = $this->get_target_listing_state( $listing, $content );

		if ( $existing ) {
			$current_state = $this->get_current_listing_state( $existing, $listing );
			$diff          = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$this->log( "Listing up-to-date: {$title}" );

				return $this->execution_item(
					'ok',
					'skip',
					$title,
					"Listing up-to-date: {$title}"
				);
			}

			$post_id = wp_update_post( [
				'ID'           => $existing->ID,
				'post_type'    => 'jet-engine',
				'post_title'   => $title,
				'post_name'    => $slug,
				'post_status'  => 'publish',
				'post_content' => $content,
			], true );

			if ( is_wp_error( $post_id ) ) {
				$this->warn( $post_id->get_error_message() );

				return $this->execution_item(
					'error',
					'update',
					$title,
					"Listing update failed: {$title}"
				);
			}

			$this->sync_listing_meta( (int) $post_id, $listing );
			$this->log( "Listing updated: {$title}" );

			return $this->execution_item(
				'ok',
				'update',
				$title,
				"Listing updated: {$title}"
			);
		}

		$post_id = wp_insert_post( [
			'post_type'    => 'jet-engine',
			'post_title'   => $title,
			'post_name'    => $slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		], true );

		if ( is_wp_error( $post_id ) ) {
			$this->warn( $post_id->get_error_message() );

			return $this->execution_item(
				'error',
				'create',
				$title,
				"Listing create failed: {$title}"
			);
		}

		$this->sync_listing_meta( (int) $post_id, $listing );
		$this->log( "Listing created: {$title}" );

		return $this->execution_item(
			'ok',
			'create',
			$title,
			"Listing created: {$title}"
		);
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
			'type'    => 'listing',
			'entity'  => $entity,
			'message' => $message,
			'details' => [],
		];
	}

	private function sync_listing_meta( int $post_id, array $listing ): void {
		$post_type = $listing['post_type'] ?? '';
		$slug      = $listing['slug'] ?? '';
		$source    = $this->get_listing_source_config( $listing );

		update_post_meta( $post_id, '_entry_type', 'listing' );
		update_post_meta( $post_id, '_listing_type', 'blocks' );

		update_post_meta( $post_id, '_listing_data', [
			'source'    => $source['source'],
			'post_type' => $post_type,
			'tax'       => 'category',
		] );

		update_post_meta( $post_id, '_elementor_page_settings', [
			'listing_source'               => $source['source'],
			'listing_post_type'            => $post_type,
			'listing_tax'                  => 'category',
			'repeater_source'              => 'jet_engine',
			'repeater_field'               => '',
			'repeater_option'              => '',
			'listing_link'                 => '',
			'listing_link_source'          => '',
			'listing_link_object_prop'     => 'post_id',
			'listing_link_custom_url'      => '',
			'listing_link_add_query_args'  => '',
			'listing_link_query_args'      => '',
			'_post_id'                     => 'current_id',
		] );

		if ( $source['query_id'] > 0 ) {
			update_post_meta( $post_id, '_query_id', $source['query_id'] );
		}

		update_post_meta( $post_id, '_factory_listing_key', $slug );
	}

	private function get_current_listing_state( WP_Post $post, array $listing = [] ): array {
		$state = [
			'title'       => $post->post_title,
			'slug'        => $post->post_name,
			'content'     => $post->post_content,
			'entry_type'  => get_post_meta( $post->ID, '_entry_type', true ),
			'listing_type'=> get_post_meta( $post->ID, '_listing_type', true ),
			'listing_data'=> $this->normalize_array_for_diff( get_post_meta( $post->ID, '_listing_data', true ) ),
		];

		if ( $this->get_listing_query_slug( $listing ) ) {
			$settings = get_post_meta( $post->ID, '_elementor_page_settings', true );
			$settings = is_array( $settings ) ? $settings : [];

			$state['listing_source'] = $settings['listing_source'] ?? '';
			$state['query_id']       = absint( get_post_meta( $post->ID, '_query_id', true ) );
		}

		return $state;
	}

	private function get_target_listing_state( array $listing, string $content ): array {
		$slug      = $listing['slug'] ?? '';
		$title     = $listing['title'] ?? $slug;
		$post_type = $listing['post_type'] ?? '';
		$source    = $this->get_listing_source_config( $listing );

		$state = [
			'title'       => $title,
			'slug'        => $slug,
			'content'     => $content,
			'entry_type'  => 'listing',
			'listing_type'=> 'blocks',
			'listing_data'=> $this->normalize_array_for_diff( [
				'source'    => $source['source'],
				'post_type' => $post_type,
				'tax'       => 'category',
			] ),
		];

		if ( $this->get_listing_query_slug( $listing ) ) {
			$state['listing_source'] = $source['source'];
			$state['query_id']       = $source['query_id'];
		}

		return $state;
	}

	private function get_listing_source_config( array $listing ): array {
		$query_slug = $this->get_listing_query_slug( $listing );
		$query_id   = $query_slug ? $this->resolve_jetengine_query_row_id( $query_slug ) : 0;

		if ( $query_id > 0 ) {
			return [
				'source'   => 'query',
				'query_id' => $query_id,
			];
		}

		return [
			'source'   => 'posts',
			'query_id' => 0,
		];
	}

	private function get_listing_query_slug( array $listing ): string {
		return sanitize_key( $listing['query'] ?? '' );
	}

	private function get_factory_query_id_from_slug( string $slug ): string {
		return 'factory_' . sanitize_key( $slug );
	}

	private function resolve_jetengine_query_row_id( string $query_slug ): int {
		if ( ! function_exists( 'jet_engine' ) || ! class_exists( 'Jet_Engine\\Query_Builder\\Manager' ) ) {
			return 0;
		}

		$manager = \Jet_Engine\Query_Builder\Manager::instance();

		if ( empty( $manager->data ) || empty( $manager->data->db ) ) {
			return 0;
		}

		$factory_query_id = $this->get_factory_query_id_from_slug( $query_slug );
		$rows             = $manager->data->db->query( $manager->data->table, [ 'status' => 'query' ], null, false );

		if ( ! is_array( $rows ) ) {
			return 0;
		}

		foreach ( $rows as $row ) {
			$args = maybe_unserialize( $row['args'] ?? [] );

			if ( is_array( $args ) && ( $args['query_id'] ?? '' ) === $factory_query_id ) {
				return absint( $row['id'] ?? 0 );
			}
		}

		return 0;
	}

	private function normalize_array_for_diff( $value ): array {
		if ( ! is_array( $value ) ) {
			return [];
		}

		ksort( $value );

		return $value;
	}

	private function generate_blocks( array $listing ): string {
		$blocks = [];

		$layout = $listing['layout'] ?? [];

		if ( empty( $layout ) && ! empty( $listing['fields'] ) ) {
			$layout = $listing['fields'];
		}

		foreach ( $layout as $field ) {
			$type = $field['type'] ?? '';

			if ( $type === 'title' ) {
				$blocks[] = $this->dynamic_title_block();
			}

			if ( $type === 'meta' && ! empty( $field['key'] ) ) {
				$blocks[] = $this->dynamic_meta_field_block( $field['key'] );
			}
		}

		return implode( "\n\n", $blocks );
	}

	private function dynamic_title_block(): string {
		return '<!-- wp:jet-engine/dynamic-field {"dynamic_field_source":"post_or_term_object","dynamic_field_post_object":"post_title","crocoblock_styles":{"_uniqueClassName":"factory-title","field_width":"auto","field_alignment":"flex-start","content_alignment":"left"}} /-->';
	}

	private function dynamic_meta_field_block( string $key ): string {
		$class = 'factory-meta-' . sanitize_key( $key );

		return '<!-- wp:jet-engine/dynamic-field {"dynamic_field_source":"meta","dynamic_field_post_meta":"' . esc_attr( $key ) . '","crocoblock_styles":{"_uniqueClassName":"' . esc_attr( $class ) . '","field_width":"auto","field_alignment":"flex-start","content_alignment":"left"}} /-->';
	}

	private function find_listing_by_slug( string $slug ): ?WP_Post {
		$posts = get_posts( [
			'post_type'   => 'jet-engine',
			'post_status' => 'any',
			'name'        => $slug,
			'numberposts' => 1,
		] );

		return $posts[0] ?? null;
	}

	private function log( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::log( $message );
		}
	}

	private function warn( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::warning( $message );
		}
	}
}
