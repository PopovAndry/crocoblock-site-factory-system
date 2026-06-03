<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Snapshot_Command {

	public function create( array $args = [], array $assoc_args = [] ): void {

		$upload_dir = wp_upload_dir();

		$base_dir = trailingslashit( $upload_dir['basedir'] ) . 'factory-snapshots';

		if ( ! is_dir( $base_dir ) ) {
			wp_mkdir_p( $base_dir );
		}

		$timestamp = gmdate( 'Ymd-His' );

		$snapshot_dir = trailingslashit( $base_dir ) . $timestamp;

		wp_mkdir_p( $snapshot_dir );

		$blueprint_path = $this->store_blueprint( $snapshot_dir );
		$report_path    = $this->store_report( $snapshot_dir );

		$this->store_metadata(
			$snapshot_dir,
			$timestamp,
			$blueprint_path,
			$report_path,
			$assoc_args
		);

		WP_CLI::success( "Snapshot created: {$timestamp}" );
	}

	public function list( array $args = [], array $assoc_args = [] ): void {

		$upload_dir = wp_upload_dir();

		$base_dir = trailingslashit( $upload_dir['basedir'] ) . 'factory-snapshots';

		if ( ! is_dir( $base_dir ) ) {
			WP_CLI::warning( 'No snapshots found.' );
			return;
		}

		$items = scandir( $base_dir );

		$snapshots = [];

		foreach ( $items as $item ) {

			if ( in_array( $item, [ '.', '..' ], true ) ) {
				continue;
			}

			$path = trailingslashit( $base_dir ) . $item;

			if ( ! is_dir( $path ) ) {
				continue;
			}

			$metadata_path = trailingslashit( $path ) . 'metadata.json';

			$created = $item;
			$type    = 'unknown';
			$source  = 'unknown';

			if ( file_exists( $metadata_path ) ) {

				$metadata = json_decode(
					file_get_contents( $metadata_path ),
					true
				);

				if ( is_array( $metadata ) ) {
					if ( ! empty( $metadata['created_at'] ) ) {
						$created = $metadata['created_at'];
					}

					if ( ! empty( $metadata['snapshot_type'] ) ) {
						$type = $metadata['snapshot_type'];
					}

					if ( ! empty( $metadata['source'] ) ) {
						$source = $metadata['source'];
					}
				}
			}

			$snapshots[] = [
				'id'      => $item,
				'created' => $created,
				'type'    => $type,
				'source'  => $source,
			];
		}

		if ( empty( $snapshots ) ) {
			WP_CLI::warning( 'No snapshots found.' );
			return;
		}

		WP_CLI\Utils\format_items(
			'table',
			$snapshots,
			[ 'id', 'created', 'type', 'source' ]
		);
	}

	public function inspect( array $args = [], array $assoc_args = [] ): void {

		$snapshot_id = $args[0] ?? '';

		if ( ! $snapshot_id ) {
			WP_CLI::error( 'Provide snapshot id.' );
		}

		$upload_dir = wp_upload_dir();

		$snapshot_dir = trailingslashit(
			$upload_dir['basedir']
		) . 'factory-snapshots/' . $snapshot_id;

		if ( ! is_dir( $snapshot_dir ) ) {
			WP_CLI::error( "Snapshot not found: {$snapshot_id}" );
		}

		$metadata_path = trailingslashit( $snapshot_dir ) . 'metadata.json';

		if ( ! file_exists( $metadata_path ) ) {
			WP_CLI::error( 'Snapshot metadata not found.' );
		}

		$metadata = json_decode(
			file_get_contents( $metadata_path ),
			true
		);

		if ( ! is_array( $metadata ) ) {
			WP_CLI::error( 'Invalid snapshot metadata.' );
		}

		WP_CLI::log( '' );
		WP_CLI::log( "Snapshot: {$snapshot_id}" );
		WP_CLI::log( '' );

		WP_CLI::log(
			'Type: ' . ( $metadata['snapshot_type'] ?? 'unknown' )
		);

		WP_CLI::log(
			'Source: ' . ( $metadata['source'] ?? 'unknown' )
		);

		WP_CLI::log(
			'Created: ' . ( $metadata['created_at'] ?? 'unknown' )
		);

		WP_CLI::log( '' );

		WP_CLI::log(
			'WordPress: ' . ( $metadata['wp_version'] ?? 'unknown' )
		);

		WP_CLI::log(
			'PHP: ' . ( $metadata['php_version'] ?? 'unknown' )
		);

		WP_CLI::log( '' );

		WP_CLI::log(
			'Theme: ' . ( $metadata['active_theme'] ?? 'unknown' )
		);

		WP_CLI::log( '' );

		$plugins = $metadata['active_plugins'] ?? [];

		if ( ! empty( $plugins ) && is_array( $plugins ) ) {

			WP_CLI::log( 'Plugins:' );

			foreach ( $plugins as $plugin ) {
				WP_CLI::log( "- {$plugin}" );
			}
		}

		WP_CLI::log( '' );

		$files = [
			'blueprint.json',
			'report.json',
		];

		WP_CLI::log( 'Files:' );

		foreach ( $files as $file ) {

			$exists = file_exists(
				trailingslashit( $snapshot_dir ) . $file
			);

			WP_CLI::log(
				sprintf(
					'- %s %s',
					$exists ? 'вњ“' : 'вњ—',
					$file
				)
			);
		}
	}

	private function store_blueprint( string $snapshot_dir ): ?string {

		$source = FACTORY_GENERATED_BLUEPRINTS_DIR . 'ai-blueprint.json';

		if ( ! file_exists( $source ) ) {
			return null;
		}

		$target = trailingslashit( $snapshot_dir ) . 'blueprint.json';

		copy( $source, $target );

		return $target;
	}

	private function store_report( string $snapshot_dir ): ?string {

		$source = FACTORY_REPORTS_DIR . 'factory-report.json';

		if ( ! file_exists( $source ) ) {
			return null;
		}

		$target = trailingslashit( $snapshot_dir ) . 'report.json';

		copy( $source, $target );

		return $target;
	}

	private function store_metadata(
		string $snapshot_dir,
		string $timestamp,
		?string $blueprint_path,
		?string $report_path,
		array $assoc_args
	): void {

		$metadata = [
			'created_at'             => $timestamp,
			'snapshot_type'          => $assoc_args['type'] ?? 'manual',
			'source'                 => $assoc_args['source'] ?? 'manual',
			'factory_version'        => 'v1',
			'wp_version'             => get_bloginfo( 'version' ),
			'php_version'            => PHP_VERSION,
			'active_theme'           => wp_get_theme()->get( 'Name' ),
			'active_plugins'         => array_values(
				wp_get_active_and_valid_plugins()
			),
			'blueprint_path'         => $blueprint_path,
			'report_path'            => $report_path,
			'current_blueprint_hash' => $this->get_file_hash( $blueprint_path ),
			'current_report_hash'    => $this->get_file_hash( $report_path ),
		];

		file_put_contents(
			trailingslashit( $snapshot_dir ) . 'metadata.json',
			json_encode(
				$metadata,
				JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
			)
		);
	}

	private function get_file_hash( ?string $path ): ?string {
		if ( ! $path || ! file_exists( $path ) ) {
			return null;
		}

		return md5_file( $path );
	}
}
