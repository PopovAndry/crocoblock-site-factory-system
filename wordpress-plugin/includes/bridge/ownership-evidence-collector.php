<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Read-only collector for Factory ownership markers.
 *
 * This mirrors the Core ownership evidence shape without requiring Core
 * autoloading. It reads existing post/term markers only and never writes
 * runtime state.
 */
class Factory_Ownership_Evidence_Collector {

	private const SOURCE = 'plugin_runtime';
	private const NEXT_REQUIRED_STEP = 'user_confirmation';

	private const STATUSES = [
		'safe',
		'user_modified',
		'locked',
		'conflict',
		'warning',
		'error',
	];

	private const POST_BACKED_TYPES = [
		'post',
		'product',
		'template',
		'listing',
		'form',
		'filter',
	];

	public function collect( array $targets = [] ): array {
		if ( empty( $targets ) ) {
			return [
				'available'          => true,
				'status'             => 'ok',
				'source'             => self::SOURCE,
				'message'            => 'Ownership check completed. No target entities were provided.',
				'requires_runtime'   => true,
				'next_required_step' => self::NEXT_REQUIRED_STEP,
				'summary'            => $this->empty_summary(),
				'items'              => [],
			];
		}

		$items = [];

		foreach ( $targets as $target ) {
			$items[] = is_array( $target )
				? $this->inspect_target( $target )
				: $this->warning_item(
					'unknown',
					'Unsupported ownership target shape.',
					[
						'raw_target' => $target,
					]
				);
		}

		$summary = $this->summary_from_items( $items );

		return [
			'available'          => true,
			'status'             => $this->status_from_summary( $summary ),
			'source'             => self::SOURCE,
			'message'            => 'Ownership check completed.',
			'requires_runtime'   => true,
			'next_required_step' => self::NEXT_REQUIRED_STEP,
			'summary'            => $summary,
			'items'              => $items,
		];
	}

	public function normalize_marker_item( array $target, array $markers ): array {
		$entity_type = $this->normalize_entity_type( $target['entity_type'] ?? 'unknown' );
		$entity_id   = $this->nullable_int( $target['entity_id'] ?? null );
		$entity      = $this->string_value( $target['entity'] ?? '' );
		$lock        = sanitize_key( $markers['_factory_lock'] ?? '' );
		$managed     = $this->truthy_marker( $markers['_factory_managed'] ?? '' );
		$modified    = $this->truthy_marker( $markers['_factory_user_modified'] ?? '' );
		$source      = $this->string_value( $markers['_factory_source'] ?? '' );
		$expected    = $this->string_value( $target['expected_source'] ?? '' );

		if ( '' !== $expected && '' !== $source && $expected !== $source ) {
			return $this->item(
				'conflict',
				$entity_type,
				$entity,
				$entity_id,
				'mixed',
				'Factory ownership source differs from the expected source.',
				$target,
				$markers
			);
		}

		if ( $modified || 'user_modified' === $lock ) {
			return $this->item(
				'user_modified',
				$entity_type,
				$entity,
				$entity_id,
				'mixed',
				'User-modified Factory-managed entity requires review.',
				$target,
				$markers
			);
		}

		if ( in_array( $lock, [ 'locked', 'user_owned', 'frozen' ], true ) ) {
			return $this->item(
				'locked',
				$entity_type,
				$entity,
				$entity_id,
				'locked',
				'Entity is locked and should not be updated without confirmation.',
				$target,
				$markers
			);
		}

		if ( $managed ) {
			return $this->item(
				'safe',
				$entity_type,
				$entity,
				$entity_id,
				'blueprint_managed',
				'Factory-managed entity appears safe for preview.',
				$target,
				$markers
			);
		}

		return $this->item(
			'warning',
			$entity_type,
			$entity,
			$entity_id,
			'unknown',
			'Factory ownership markers were not found.',
			$target,
			$markers
		);
	}

	private function inspect_target( array $target ): array {
		$entity_type = $this->normalize_entity_type( $target['entity_type'] ?? 'unknown' );

		if ( in_array( $entity_type, self::POST_BACKED_TYPES, true ) ) {
			return $this->inspect_post_target( $target, $entity_type );
		}

		if ( 'term' === $entity_type ) {
			return $this->inspect_term_target( $target );
		}

		return $this->warning_item(
			$entity_type,
			'Unsupported ownership entity type.',
			[
				'target' => $target,
			]
		);
	}

	private function inspect_post_target( array $target, string $entity_type ): array {
		$post_id = $this->nullable_int( $target['entity_id'] ?? $target['post_id'] ?? null );

		if ( ! $post_id || ! function_exists( 'get_post' ) ) {
			return $this->warning_item( $entity_type, 'Post ownership target is missing a valid entity_id.', [ 'target' => $target ] );
		}

		$post = get_post( $post_id );

		if ( ! $post ) {
			return $this->warning_item( $entity_type, 'Post ownership target was not found.', [ 'target' => $target ] );
		}

		$target['entity_type'] = $entity_type;
		$target['entity_id']   = $post_id;
		$target['entity']      = $target['entity'] ?? $post->post_title;

		return $this->normalize_marker_item(
			$target,
			$this->read_post_markers( $post_id )
		);
	}

	private function inspect_term_target( array $target ): array {
		$term_id = $this->nullable_int( $target['entity_id'] ?? $target['term_id'] ?? null );

		if ( ! $term_id || ! function_exists( 'get_term' ) ) {
			return $this->warning_item( 'term', 'Term ownership target is missing a valid entity_id.', [ 'target' => $target ] );
		}

		$term = get_term( $term_id );

		if ( ! $term || is_wp_error( $term ) ) {
			return $this->warning_item( 'term', 'Term ownership target was not found.', [ 'target' => $target ] );
		}

		$target['entity_type'] = 'term';
		$target['entity_id']   = $term_id;
		$target['entity']      = $target['entity'] ?? $term->name;

		return $this->normalize_marker_item(
			$target,
			$this->read_term_markers( $term_id )
		);
	}

	private function read_post_markers( int $post_id ): array {
		$markers = [];

		foreach ( $this->post_marker_keys() as $key ) {
			$markers[ $key ] = (string) get_post_meta( $post_id, $key, true );
		}

		return $markers;
	}

	private function read_term_markers( int $term_id ): array {
		$markers = [];

		foreach ( $this->term_marker_keys() as $key ) {
			$markers[ $key ] = (string) get_term_meta( $term_id, $key, true );
		}

		return $markers;
	}

	private function post_marker_keys(): array {
		return [
			'_factory_managed',
			'_factory_source',
			'_factory_entity_type',
			'_factory_lock',
			'_factory_source_key',
			'_factory_page_key',
			'_factory_last_generated_hash',
			'_factory_user_modified',
			'_factory_listing_key',
			'_factory_filter_key',
			'_factory_filter_provider',
			'_factory_form_key',
			'_factory_form_provider',
			'_factory_asset_hash',
			'_factory_asset_source',
			'_factory_asset_role',
		];
	}

	private function term_marker_keys(): array {
		return [
			'_factory_managed',
			'_factory_source',
			'_factory_entity_type',
			'_factory_lock',
			'_factory_last_generated_hash',
			'_factory_user_modified',
		];
	}

	private function item(
		string $status,
		string $entity_type,
		string $entity,
		?int $entity_id,
		string $ownership,
		string $message,
		array $target,
		array $markers
	): array {
		return [
			'status'         => in_array( $status, self::STATUSES, true ) ? $status : 'warning',
			'entity_type'    => $entity_type,
			'entity'         => $entity,
			'entity_id'      => $entity_id,
			'blueprint_path' => $this->string_value( $target['blueprint_path'] ?? '' ),
			'field'          => $this->string_value( $target['field'] ?? '' ),
			'ownership'      => $ownership,
			'message'        => $message,
			'details'        => [
				'markers' => $markers,
			],
		];
	}

	private function warning_item( string $entity_type, string $message, array $details = [] ): array {
		return [
			'status'         => 'warning',
			'entity_type'    => $this->normalize_entity_type( $entity_type ),
			'entity'         => '',
			'entity_id'      => null,
			'blueprint_path' => '',
			'field'          => '',
			'ownership'      => 'unknown',
			'message'        => $message,
			'details'        => $details,
		];
	}

	private function summary_from_items( array $items ): array {
		$summary = $this->empty_summary();

		foreach ( $items as $item ) {
			$status = $item['status'] ?? 'warning';

			if ( ! array_key_exists( $status, $summary ) ) {
				$status = 'warning';
			}

			$summary['checked']++;
			$summary[ $status ]++;
		}

		return $summary;
	}

	private function status_from_summary( array $summary ): string {
		if ( (int) ( $summary['error'] ?? 0 ) > 0 ) {
			return 'error';
		}

		foreach ( [ 'conflict', 'locked', 'user_modified', 'warning' ] as $key ) {
			if ( (int) ( $summary[ $key ] ?? 0 ) > 0 ) {
				return 'warning';
			}
		}

		return 'ok';
	}

	private function empty_summary(): array {
		return [
			'checked'       => 0,
			'safe'          => 0,
			'user_modified' => 0,
			'locked'        => 0,
			'conflict'      => 0,
			'warning'       => 0,
			'error'         => 0,
		];
	}

	private function normalize_entity_type( $entity_type ): string {
		$entity_type = is_string( $entity_type ) || is_numeric( $entity_type )
			? sanitize_key( (string) $entity_type )
			: 'unknown';

		return '' !== $entity_type ? $entity_type : 'unknown';
	}

	private function nullable_int( $value ): ?int {
		if ( is_numeric( $value ) && (int) $value > 0 ) {
			return (int) $value;
		}

		return null;
	}

	private function truthy_marker( $value ): bool {
		return in_array( (string) $value, [ '1', 'yes', 'true', 'on' ], true );
	}

	private function string_value( $value ): string {
		if ( is_scalar( $value ) || null === $value ) {
			return (string) $value;
		}

		return '';
	}
}

function factory_collect_ownership_evidence( array $targets = [] ): array {
	$collector = new Factory_Ownership_Evidence_Collector();

	return $collector->collect( $targets );
}
