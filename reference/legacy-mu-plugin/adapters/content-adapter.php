<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Content_Adapter {

	private array $execution_results = [];
	private array $asset_pool_counters = [];

	public function register( array $blueprint ): void {
		// Content is handled during apply/validate only.
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];
		$this->asset_pool_counters = [];

		foreach ( $blueprint['content'] ?? [] as $post_type => $items ) {
			foreach ( $items as $item ) {
				$result = $this->sync_post( $post_type, $item, $blueprint );

				if ( is_array( $result ) ) {
					$this->execution_results[] = $result;
				}
			}
		}
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

public function plan( array $blueprint ): array {
	$plan = [];

	foreach ( $blueprint['content'] ?? [] as $post_type => $items ) {
		foreach ( $items as $item ) {
			$title = $item['title'] ?? '';

			if ( ! $title ) {
				continue;
			}

			$post = $this->find_post( $post_type, $item );

			if ( ! $post ) {
				$plan[] = [
					'action'  => 'create',
					'type'    => 'content',
					'entity'  => "{$post_type} → {$title}",
					'message' => "Create content item: {$post_type} → {$title}",
				];

				continue;
			}

			$current_state = $this->get_current_post_state( $post, $item );
			$target_state  = $this->get_target_post_state( $item );

			$diff = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$plan[] = [
					'action'  => 'skip',
					'type'    => 'content',
					'entity'  => "{$post_type} → {$title}",
					'message' => "Content up-to-date: {$post_type} → {$title}",
				];

				continue;
			}

			$plan[] = [
				'action'  => 'update',
				'type'    => 'content',
				'entity'  => "{$post_type} → {$title}",
				'message' => "Update content item: {$post_type} → {$title}",
				'diff'    => $diff,
			];
		}
	}

	return $plan;
}

	public function validate( array $blueprint ): array {
		$results = [];

		foreach ( $blueprint['content'] ?? [] as $post_type => $items ) {
			foreach ( $items as $item ) {
				$title = $item['title'] ?? '';

				if ( ! $title ) {
					continue;
				}

				$post = $this->find_post( $post_type, $item );

				if ( ! $post ) {
					$results[] = [
						'status'  => 'error',
						'message' => "Missing content item: {$post_type} → {$title}",
					];

					continue;
				}

				$results[] = [
					'status'  => 'ok',
					'message' => "Content exists: {$post_type} → {$title}",
				];

				foreach ( $item['meta'] ?? [] as $key => $expected_value ) {
					$actual_value = get_post_meta( $post->ID, $key, true );

					$results[] = [
						'status'  => (string) $actual_value === (string) $expected_value ? 'ok' : 'error',
						'message' => (string) $actual_value === (string) $expected_value
							? "Meta value ok: {$title}.{$key} = {$expected_value}"
							: "Meta mismatch: {$title}.{$key}. Expected {$expected_value}, got {$actual_value}",
					];
				}

				foreach ( $item['terms'] ?? [] as $taxonomy => $expected_terms ) {
					if ( ! taxonomy_exists( $taxonomy ) ) {
						$results[] = [
							'status'  => 'error',
							'message' => "Taxonomy missing for content item: {$title}.{$taxonomy}",
						];

						continue;
					}

					if ( ! is_array( $expected_terms ) ) {
						$expected_terms = [ $expected_terms ];
					}

					$actual_terms = wp_get_object_terms( $post->ID, $taxonomy, [
						'fields' => 'names',
					] );

					if ( is_wp_error( $actual_terms ) ) {
						$results[] = [
							'status'  => 'error',
							'message' => "Cannot read terms: {$title}.{$taxonomy}",
						];

						continue;
					}

					sort( $expected_terms );
					sort( $actual_terms );

					$results[] = [
						'status'  => $actual_terms === $expected_terms ? 'ok' : 'error',
						'message' => $actual_terms === $expected_terms
							? "Terms ok: {$title}.{$taxonomy} = " . implode( ', ', $expected_terms )
							: "Terms mismatch: {$title}.{$taxonomy}. Expected " . implode( ', ', $expected_terms ) . ', got ' . implode( ', ', $actual_terms ),
					];
				}
			}
		}

		return $results;
	}

	private function sync_post( string $post_type, array $item, array $blueprint ): ?array {
		if ( empty( $item['title'] ) ) {
			return null;
		}

		$title = $item['title'];
		$post = $this->find_post( $post_type, $item );

		$target_state = $this->get_target_post_state( $item );

		if ( ! $post ) {
			$post_id = $this->create_post( $post_type, $item );

			if ( $post_id ) {
				$this->sync_post_meta( $post_id, $item );
				$this->sync_post_terms( $post_id, $item );
				$this->sync_featured_image( $post_id, $post_type, $item, $blueprint );
				$this->log_success( "Created: {$item['title']}" );

				return $this->execution_item(
					'ok',
					'create',
					$post_type,
					$title,
					"Post created: {$title}"
				);
			}
            
			return $this->execution_item(
				'error',
				'create',
				$post_type,
				$title,
				"Post create failed: {$title}"
			);
		}

		$current_state = $this->get_current_post_state( $post, $item );

		$diff = factory_diff_arrays( $current_state, $target_state );

		if ( empty( $diff ) ) {
			$this->sync_featured_image( $post->ID, $post_type, $item, $blueprint );
			$this->log( "Post up-to-date: {$item['title']}" );

			return $this->execution_item(
				'ok',
				'skip',
				$post_type,
				$title,
				"Post skipped: {$title}"
			);
		}

		$error = $this->update_post( $post->ID, $post_type, $item );
		$this->sync_post_meta( $post->ID, $item );
		$this->sync_post_terms( $post->ID, $item );
		$this->sync_featured_image( $post->ID, $post_type, $item, $blueprint );

		$this->log_success( "Updated: {$item['title']}" );

		if ( $error ) {
			return $this->execution_item(
				'error',
				'update',
				$post_type,
				$title,
				"Post update failed: {$title}"
			);
		}

		return $this->execution_item(
			'ok',
			'update',
			$post_type,
			$title,
			"Post updated: {$title}"
		);
	}

	private function create_post( string $post_type, array $item ): int {
		$post_id = wp_insert_post( [
			'post_type'    => $post_type,
			'post_title'   => $item['title'],
			'post_content' => $item['content'] ?? '',
			'post_status'  => 'publish',
		], true );

		if ( is_wp_error( $post_id ) ) {
			$this->warn( $post_id->get_error_message() );
			return 0;
		}

		update_post_meta( $post_id, '_factory_source_key', $this->get_source_key( $post_type, $item ) );

		return (int) $post_id;
	}

	private function update_post( int $post_id, string $post_type, array $item ): ?string {
		$result = wp_update_post( [
			'ID'           => $post_id,
			'post_type'    => $post_type,
			'post_title'   => $item['title'],
			'post_content' => $item['content'] ?? '',
			'post_status'  => 'publish',
		], true );

		if ( is_wp_error( $result ) ) {
			$message = $result->get_error_message();

			$this->warn( $message );
			return $message;
		}
		update_post_meta( $post_id, '_factory_source_key', $this->get_source_key( $post_type, $item ) );

		return null;
	}

	private function execution_item(
		string $status,
		string $action,
		string $post_type,
		string $title,
		string $message
	): array {
		$arrow = html_entity_decode( '&#8594;', ENT_QUOTES, 'UTF-8' );

		return [
			'status'  => $status,
			'action'  => $action,
			'type'    => 'content',
			'entity'  => "{$post_type} {$arrow} {$title}",
			'message' => $message,
			'details' => [],
		];
	}

	private function sync_featured_image( int $post_id, string $post_type, array $item, array $blueprint ): void {
		$source = $this->resolve_featured_image_source( $post_type, $item, $blueprint );

		if ( '' === $source ) {
			return;
		}

		$title = $item['title'] ?? '';
		$path  = $this->resolve_local_asset_path( $source );

		if ( '' === $path || ! is_readable( $path ) ) {
			$this->execution_results[] = $this->media_execution_item(
				'warning',
				'skip',
				$post_type,
				$title,
				"Featured image source missing: {$source}",
				[
					'source' => $source,
				]
			);

			return;
		}

		$hash = sha1_file( $path );

		if ( ! $hash ) {
			$this->execution_results[] = $this->media_execution_item(
				'warning',
				'skip',
				$post_type,
				$title,
				"Featured image hash failed: {$source}",
				[
					'source' => $source,
					'path'   => $path,
				]
			);

			return;
		}

		$attachment = $this->get_or_import_featured_image_attachment( $path, $source, $hash, $title );

		if ( empty( $attachment['id'] ) ) {
			$this->execution_results[] = $this->media_execution_item(
				'warning',
				'skip',
				$post_type,
				$title,
				"Featured image import failed: {$source}",
				[
					'source' => $source,
					'path'   => $path,
					'hash'   => $hash,
				]
			);

			return;
		}

		$attachment_id = (int) $attachment['id'];

		if ( (int) get_post_thumbnail_id( $post_id ) === $attachment_id ) {
			$this->execution_results[] = $this->media_execution_item(
				'ok',
				'skip',
				$post_type,
				$title,
				"Featured image up-to-date: {$title}",
				[
					'attachment_id' => $attachment_id,
					'source'        => $source,
					'hash'          => $hash,
				]
			);

			return;
		}

		set_post_thumbnail( $post_id, $attachment_id );

		$this->execution_results[] = $this->media_execution_item(
			'ok',
			! empty( $attachment['created'] ) ? 'create' : 'update',
			$post_type,
			$title,
			! empty( $attachment['created'] )
				? "Featured image imported: {$title}"
				: "Featured image assigned: {$title}",
			[
				'attachment_id' => $attachment_id,
				'source'        => $source,
				'hash'          => $hash,
			]
		);
	}

	private function resolve_featured_image_source( string $post_type, array $item, array $blueprint ): string {
		if ( isset( $item['featured_image'] ) ) {
			if ( is_string( $item['featured_image'] ) ) {
				return trim( $item['featured_image'] );
			}

			if ( is_array( $item['featured_image'] ) && isset( $item['featured_image']['source'] ) ) {
				return is_string( $item['featured_image']['source'] )
					? trim( $item['featured_image']['source'] )
					: '';
			}
		}

		$property_type = $item['meta']['property_type'] ?? '';

		if ( '' === $property_type && ! empty( $item['terms']['property_type'] ) ) {
			$terms         = is_array( $item['terms']['property_type'] )
				? $item['terms']['property_type']
				: [ $item['terms']['property_type'] ];
			$property_type = $terms[0] ?? '';
		}

		if ( ! is_string( $property_type ) || '' === trim( $property_type ) ) {
			return '';
		}

		$mapping = $blueprint['site']['assets']['property_images'] ?? [];

		if ( ! is_array( $mapping ) ) {
			return '';
		}

		$property_type = trim( $property_type );
		$pool_key      = "{$post_type}:{$property_type}";

		return $this->resolve_asset_source_from_mapping( $mapping[ $property_type ] ?? '', $pool_key );
	}

	private function resolve_asset_source_from_mapping( $mapping, string $pool_key ): string {
		if ( is_string( $mapping ) ) {
			return trim( $mapping );
		}

		if ( ! is_array( $mapping ) ) {
			return '';
		}

		$sources = array_values(
			array_filter(
				$mapping,
				function ( $source ) {
					return is_string( $source ) && '' !== trim( $source );
				}
			)
		);

		if ( empty( $sources ) ) {
			return '';
		}

		$counter = $this->asset_pool_counters[ $pool_key ] ?? 0;
		$index   = $counter % count( $sources );

		$this->asset_pool_counters[ $pool_key ] = $counter + 1;

		return trim( $sources[ $index ] );
	}

	private function resolve_local_asset_path( string $source ): string {
		if ( '' === trim( $source ) || preg_match( '#^https?://#i', $source ) ) {
			return '';
		}

		$source = str_replace( '\\', '/', trim( $source ) );

		if ( preg_match( '#^(?:[A-Za-z]:)?/#', $source ) && is_readable( $source ) ) {
			return $source;
		}

		$relative   = ltrim( $source, '/\\' );
		$candidates = [];

		if ( defined( 'ABSPATH' ) ) {
			$candidates[] = rtrim( dirname( ABSPATH ), '/\\' ) . '/' . $relative;
			$candidates[] = rtrim( ABSPATH, '/\\' ) . '/' . $relative;
		}

		$candidates[] = rtrim( dirname( __DIR__, 5 ), '/\\' ) . '/' . $relative;

		foreach ( array_unique( $candidates ) as $candidate ) {
			if ( is_readable( $candidate ) ) {
				return $candidate;
			}
		}

		return '';
	}

	private function get_or_import_featured_image_attachment(
		string $path,
		string $source,
		string $hash,
		string $title
	): array {
		$existing_id = $this->find_factory_attachment( $source, $hash );

		if ( $existing_id ) {
			return [
				'id'      => $existing_id,
				'created' => false,
			];
		}

		$attachment_id = $this->import_factory_attachment( $path, $source, $hash, $title );

		return [
			'id'      => $attachment_id,
			'created' => (bool) $attachment_id,
		];
	}

	private function find_factory_attachment( string $source, string $hash ): int {
		$attachments = get_posts( [
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_query'     => [
				[
					'key'   => '_factory_asset_hash',
					'value' => $hash,
				],
				[
					'key'   => '_factory_asset_source',
					'value' => $source,
				],
				[
					'key'   => '_factory_asset_role',
					'value' => 'featured_image',
				],
			],
		] );

		return empty( $attachments ) ? 0 : (int) $attachments[0];
	}

	private function import_factory_attachment( string $path, string $source, string $hash, string $title ): int {
		if ( ! function_exists( 'wp_generate_attachment_metadata' ) ) {
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}

		$contents = file_get_contents( $path );

		if ( false === $contents ) {
			return 0;
		}

		$upload = wp_upload_bits( basename( $path ), null, $contents );

		if ( ! empty( $upload['error'] ) || empty( $upload['file'] ) ) {
			return 0;
		}

		$filetype      = wp_check_filetype( $upload['file'], null );
		$attachment_id = wp_insert_attachment(
			[
				'post_mime_type' => $filetype['type'] ?? 'image/jpeg',
				'post_title'     => sanitize_text_field( $title ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			],
			$upload['file']
		);

		if ( is_wp_error( $attachment_id ) || ! $attachment_id ) {
			return 0;
		}

		$metadata = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );

		if ( is_array( $metadata ) ) {
			wp_update_attachment_metadata( $attachment_id, $metadata );
		}

		update_post_meta( $attachment_id, '_factory_asset_hash', $hash );
		update_post_meta( $attachment_id, '_factory_asset_source', $source );
		update_post_meta( $attachment_id, '_factory_asset_role', 'featured_image' );
		update_post_meta( $attachment_id, '_wp_attachment_image_alt', $title );

		return (int) $attachment_id;
	}

	private function media_execution_item(
		string $status,
		string $action,
		string $post_type,
		string $title,
		string $message,
		array $details = []
	): array {
		$arrow = html_entity_decode( '&#8594;', ENT_QUOTES, 'UTF-8' );

		return [
			'status'  => $status,
			'action'  => $action,
			'type'    => 'media',
			'entity'  => "{$post_type} {$arrow} {$title}",
			'message' => $message,
			'details' => $details,
		];
	}

	private function sync_post_meta( int $post_id, array $item ): void {
		foreach ( $item['meta'] ?? [] as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}
	}

	private function sync_post_terms( int $post_id, array $item ): void {
		foreach ( $item['terms'] ?? [] as $taxonomy => $terms ) {
			if ( ! taxonomy_exists( $taxonomy ) ) {
				continue;
			}

			if ( ! is_array( $terms ) ) {
				$terms = [ $terms ];
			}

			wp_set_object_terms( $post_id, $terms, $taxonomy, false );
		}
	}

	private function find_post( string $post_type, array $item ): ?WP_Post {
		$source_key = $this->get_source_key( $post_type, $item );

		$posts = get_posts( [
			'post_type'   => $post_type,
			'post_status' => 'any',
			'meta_key'    => '_factory_source_key',
			'meta_value'  => $source_key,
			'numberposts' => 1,
		] );

		return $posts[0] ?? null;
	}

	private function get_current_post_state( WP_Post $post, array $item ): array {
		return [
			'title'   => $post->post_title,
			'content' => $post->post_content,
			'meta'    => $this->get_current_meta_state( $post->ID, $item['meta'] ?? [] ),
			'terms'   => $this->get_current_terms_state( $post->ID, $item['terms'] ?? [] ),
		];
	}

	private function get_target_post_state( array $item ): array {
		return [
			'title'   => $item['title'] ?? '',
			'content' => $item['content'] ?? '',
			'meta'    => $this->normalize_meta_state( $item['meta'] ?? [] ),
			'terms'   => $this->normalize_terms_state( $item['terms'] ?? [] ),
		];
	}

	private function get_current_meta_state( int $post_id, array $expected_meta ): array {
		$result = [];

		foreach ( $expected_meta as $key => $value ) {
			$result[ $key ] = get_post_meta( $post_id, $key, true );
		}

		return $this->normalize_meta_state( $result );
	}

	private function normalize_meta_state( array $meta ): array {
		$result = [];

		foreach ( $meta as $key => $value ) {
			$result[ $key ] = is_scalar( $value ) ? (string) $value : $value;
		}

		ksort( $result );

		return $result;
	}

	private function get_current_terms_state( int $post_id, array $expected_terms ): array {
		$result = [];

		foreach ( $expected_terms as $taxonomy => $terms ) {
			if ( ! taxonomy_exists( $taxonomy ) ) {
				continue;
			}

			$actual_terms = wp_get_object_terms( $post_id, $taxonomy, [
				'fields' => 'names',
			] );

			if ( is_wp_error( $actual_terms ) ) {
				continue;
			}

			sort( $actual_terms );

			$result[ $taxonomy ] = $actual_terms;
		}

		ksort( $result );

		return $result;
	}

	private function normalize_terms_state( array $terms_config ): array {
		$result = [];

		foreach ( $terms_config as $taxonomy => $terms ) {
			if ( ! is_array( $terms ) ) {
				$terms = [ $terms ];
			}

			sort( $terms );

			$result[ $taxonomy ] = $terms;
		}

		ksort( $result );

		return $result;
	}

	private function get_source_key( string $post_type, array $item ): string {
		return sanitize_title( $post_type . '-' . ( $item['title'] ?? '' ) );
	}

	private function log( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::log( $message );
		}
	}

	private function log_success( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::success( $message );
		}
	}

	private function warn( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::warning( $message );
		}
	}
}
