<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Rollback_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {

		$snapshot_id = $args[0] ?? 'latest';

		$upload_dir = wp_upload_dir();

		$base_dir = trailingslashit( $upload_dir['basedir'] ) . 'factory-snapshots';

		if ( ! is_dir( $base_dir ) ) {
			WP_CLI::error( 'Snapshots directory not found.' );
		}

		$snapshot_path = $this->resolve_snapshot_path(
			$base_dir,
			$snapshot_id
		);

		$blueprint_path = trailingslashit( $snapshot_path ) . 'blueprint.json';

		if ( ! file_exists( $blueprint_path ) ) {
			WP_CLI::error( 'Snapshot blueprint.json not found.' );
		}

		$blueprint = json_decode(
			file_get_contents( $blueprint_path ),
			true
		);

		if ( ! is_array( $blueprint ) ) {
			WP_CLI::error( 'Invalid snapshot blueprint JSON.' );
		}

		WP_CLI::log( "Rolling back snapshot: {$snapshot_id}" );

		factory_reset_diff_report();

		factory_apply_blueprint( $blueprint );

		factory_log_diff_report();

		WP_CLI::log( 'Validating rollback state...' );

		$report = factory_validate_blueprint_state( $blueprint );

		if ( ( $report['status'] ?? 'error' ) === 'ok' ) {
			WP_CLI::success( 'Rollback completed successfully.' );
			return;
		}

		WP_CLI::warning( 'Rollback applied, but validation has errors.' );
	}

	private function resolve_snapshot_path(
		string $base_dir,
		string $snapshot_id
	): string {

		if ( $snapshot_id === 'latest' ) {

			$items = scandir( $base_dir, SCANDIR_SORT_DESCENDING );

			foreach ( $items as $item ) {

				if ( in_array( $item, [ '.', '..' ], true ) ) {
					continue;
				}

				$path = trailingslashit( $base_dir ) . $item;

				if ( is_dir( $path ) ) {
					return $path;
				}
			}

			WP_CLI::error( 'No snapshots found.' );
		}

		$path = trailingslashit( $base_dir ) . $snapshot_id;

		if ( ! is_dir( $path ) ) {
			WP_CLI::error( "Snapshot not found: {$snapshot_id}" );
		}

		return $path;
	}
}