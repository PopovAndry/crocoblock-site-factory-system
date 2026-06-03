<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_JetEngine_Adapter {

	private string $option_name = 'jet_engine_meta_boxes';

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		// Runtime registration not needed here.
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];

		if ( ! function_exists( 'jet_engine' ) ) {
			$this->log( 'JetEngine not active. Skipping.' );

			foreach ( $blueprint['cpt'] ?? [] as $cpt ) {
				if ( empty( $cpt['slug'] ) ) {
					continue;
				}

				$box_id = $this->get_box_id( $cpt['slug'] );

				$this->execution_results[] = $this->execution_item(
					'error',
					'create',
					$box_id,
					"JetEngine not active. Meta box sync skipped: {$box_id}"
				);
			}

			return;
		}

		$boxes = get_option( $this->option_name, [] );

		if ( ! is_array( $boxes ) ) {
			$boxes = [];
		}

		$boxes = $this->remove_old_factory_boxes( $boxes );

		foreach ( $blueprint['cpt'] ?? [] as $cpt ) {
			if ( empty( $cpt['slug'] ) ) {
				continue;
			}

			$result = null;
			$boxes  = $this->upsert_meta_box( $boxes, $cpt, $result );

			if ( is_array( $result ) ) {
				$this->execution_results[] = $result;
			}
		}

		update_option( $this->option_name, $boxes );

		$this->log( 'JetEngine meta boxes synced.' );
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
	$plan = [];

	if ( ! function_exists( 'jet_engine' ) ) {
		$plan[] = [
			'action'  => 'warning',
			'type'    => 'jetengine',
			'entity'  => 'JetEngine',
			'message' => 'JetEngine not active. Meta box sync would be skipped.',
		];

		return $plan;
	}

	$boxes = get_option( $this->option_name, [] );

	if ( ! is_array( $boxes ) ) {
		$boxes = [];
	}

	$boxes = $this->remove_old_factory_boxes( $boxes );

	foreach ( $blueprint['cpt'] ?? [] as $cpt ) {
		if ( empty( $cpt['slug'] ) ) {
			continue;
		}

		$post_type = $cpt['slug'];
		$box_id    = $this->get_box_id( $post_type );

		$meta_fields = [];

		foreach ( $cpt['meta'] ?? [] as $meta ) {
			if ( empty( $meta['key'] ) ) {
				continue;
			}

			$meta_fields[] = [
				'name'        => $meta['key'],
				'title'       => $meta['label'] ?? $meta['key'],
				'type'        => $this->map_field_type( $meta['type'] ?? 'text' ),
				'object_type' => 'field',
				'width'       => '100%',
			];
		}

		$target_state = [
			'id'          => $box_id,
			'title'       => 'Factory: ' . ( $cpt['label'] ?? $post_type ),
			'meta_fields' => $this->normalize_meta_fields_for_diff( $meta_fields ),
		];

		$current_state = $this->get_current_meta_box_state( $boxes, $box_id );

		if ( empty( $current_state ) ) {
			$plan[] = [
				'action'  => 'create',
				'type'    => 'jetengine',
				'entity'  => $box_id,
				'message' => "Create JetEngine meta box: {$box_id}",
			];

			continue;
		}

		$diff = factory_diff_arrays( $current_state, $target_state );

		if ( empty( $diff ) ) {
			$plan[] = [
				'action'  => 'skip',
				'type'    => 'jetengine',
				'entity'  => $box_id,
				'message' => "JetEngine meta box up-to-date: {$box_id}",
			];

			continue;
		}

		$plan[] = [
			'action'  => 'update',
			'type'    => 'jetengine',
			'entity'  => $box_id,
			'message' => "Update JetEngine meta box: {$box_id}",
			'diff'    => $diff,
		];
	}

	return $plan;
}

	public function validate( array $blueprint ): array {
		$checks = [];

		if ( ! function_exists( 'jet_engine' ) ) {
			return [
				[
					'status'  => 'warning',
					'message' => 'JetEngine not active',
				],
			];
		}

		$checks[] = [
			'status'  => 'ok',
			'message' => 'JetEngine active',
		];

		$boxes = get_option( $this->option_name, [] );

		foreach ( $blueprint['cpt'] ?? [] as $cpt ) {
			$slug   = $cpt['slug'] ?? '';
			$box_id = $this->get_box_id( $slug );

			$box = $this->find_box( $boxes, $box_id );

			if ( ! $box ) {
				$checks[] = [
					'status'  => 'error',
					'message' => "JetEngine meta box missing: {$box_id}",
				];

				continue;
			}

			$checks[] = [
				'status'  => 'ok',
				'message' => "JetEngine meta box exists: {$box_id}",
			];

			foreach ( $cpt['meta'] ?? [] as $meta ) {
				$key = $meta['key'] ?? '';

				if ( ! $key ) {
					continue;
				}

				$exists = false;

				foreach ( $box['meta_fields'] ?? [] as $field ) {
					if ( ( $field['name'] ?? '' ) === $key ) {
						$exists = true;
						break;
					}
				}

				$checks[] = [
					'status'  => $exists ? 'ok' : 'error',
					'message' => $exists
						? "JetEngine field exists: {$slug}.{$key}"
						: "JetEngine field missing: {$slug}.{$key}",
				];
			}
		}

		return $checks;
	}

	private function upsert_meta_box(
		array $boxes,
		array $cpt,
		?array &$execution_result = null
	): array {
		$post_type = $cpt['slug'];
		$box_id    = $this->get_box_id( $post_type );

		$meta_fields = [];

		foreach ( $cpt['meta'] ?? [] as $meta ) {
			if ( empty( $meta['key'] ) ) {
				continue;
			}

			$meta_fields[] = [
				'name'        => $meta['key'],
				'title'       => $meta['label'] ?? $meta['key'],
				'type'        => $this->map_field_type( $meta['type'] ?? 'text' ),
				'object_type' => 'field',
				'width'       => '100%',
			];
		}

		$new_box = [
			'id'          => $box_id,
			'title'       => 'Factory: ' . ( $cpt['label'] ?? $post_type ),
			'args'        => [
				'object_type'       => 'post',
				'allowed_post_type' => [ $post_type ],
			],
			'meta_fields' => $meta_fields,
		];

		$current_state = $this->get_current_meta_box_state( $boxes, $box_id );

		$target_state = [
			'id'          => $new_box['id'],
			'title'       => $new_box['title'],
			'meta_fields' => $this->normalize_meta_fields_for_diff( $new_box['meta_fields'] ),
		];

		$diff = factory_diff_arrays( $current_state, $target_state );

		global $factory_diff_report;

		if (
			! empty( $diff )
			&& isset( $factory_diff_report )
			&& $factory_diff_report instanceof Factory_Diff_Report
		) {
			$factory_diff_report->add(
				'jetengine',
				$box_id,
				$diff
			);
		}

		if ( empty( $current_state ) || ! empty( $diff ) ) {
			$action = empty( $current_state ) ? 'create' : 'update';

			if ( ! empty( $diff ) ) {
				$this->log( "JetEngine meta box diff detected: {$box_id}" );
			}

			$this->log( "Applying JetEngine meta box: {$box_id}" );

			$boxes = array_values(
				array_filter(
					$boxes,
					function ( $box ) use ( $box_id ) {
						return ( $box['id'] ?? '' ) !== $box_id;
					}
				)
			);

			$boxes[] = $new_box;

			$execution_result = $this->execution_item(
				'ok',
				$action,
				$box_id,
				'create' === $action
					? "JetEngine meta box created: {$box_id}"
					: "JetEngine meta box updated: {$box_id}"
			);

			return $boxes;
		}

		$this->log( "JetEngine meta box up-to-date: {$box_id}" );

		$execution_result = $this->execution_item(
			'ok',
			'skip',
			$box_id,
			"JetEngine meta box up-to-date: {$box_id}"
		);

		return $boxes;
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
			'type'    => 'jetengine',
			'entity'  => $entity,
			'message' => $message,
			'details' => [],
		];
	}

	private function get_current_meta_box_state( array $boxes, string $box_id ): array {
		$box = $this->find_box( $boxes, $box_id );

		if ( ! $box ) {
			return [];
		}

		return [
			'id'          => $box['id'] ?? '',
			'title'       => $box['title'] ?? '',
			'meta_fields' => $this->normalize_meta_fields_for_diff( $box['meta_fields'] ?? [] ),
		];
	}

	private function normalize_meta_fields_for_diff( array $fields ): array {
		$result = [];

		foreach ( $fields as $field ) {
			$name = $field['name'] ?? '';

			if ( ! $name ) {
				continue;
			}

			$result[ $name ] = [
				'name'  => $name,
				'title' => $field['title'] ?? $name,
				'type'  => $field['type'] ?? 'text',
			];
		}

		ksort( $result );

		return $result;
	}

	private function remove_old_factory_boxes( array $boxes ): array {
		return array_values(
			array_filter(
				$boxes,
				function ( $box ) {
					$title = $box['title'] ?? '';

					return ! str_starts_with( $title, 'Factory:' ) || isset( $box['args'] );
				}
			)
		);
	}

	private function find_box( array $boxes, string $box_id ): ?array {
		foreach ( $boxes as $box ) {
			if ( ( $box['id'] ?? '' ) === $box_id ) {
				return $box;
			}
		}

		return null;
	}

	private function get_box_id( string $post_type ): string {
		return 'factory_' . $post_type;
	}

	private function map_field_type( string $type ): string {
		return match ( $type ) {
			'number'  => 'number',
			'boolean' => 'switcher',
			'date'    => 'date',
			default   => 'text',
		};
	}

	private function log( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::log( $message );
		}
	}
}
