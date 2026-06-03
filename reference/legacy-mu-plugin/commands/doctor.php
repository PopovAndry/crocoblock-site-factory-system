<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Doctor_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {
		$format  = $assoc_args['format'] ?? '';
        $is_json = isset( $assoc_args['json'] ) || 'json' === $format;

		$registry_path = WP_CONTENT_DIR . '/uploads/factory-runs/registry.json';

		if ( ! file_exists( $registry_path ) ) {
			if ( $is_json ) {
				$this->output_json( [
					'status' => 'error',
					'message' => 'Run registry not found.',
					'issues' => [],
				] );

				return;
			}

			WP_CLI::warning( 'Run registry not found.' );
			return;
		}

		$registry = json_decode( file_get_contents( $registry_path ), true );

		if ( ! is_array( $registry ) ) {
			WP_CLI::error( 'Invalid registry JSON.' );
		}

		$latest = $registry['latest'] ?? '';

		if ( ! $latest ) {
			if ( $is_json ) {
				$this->output_json( [
					'status' => 'error',
					'message' => 'Latest run not found.',
					'issues' => [],
				] );

				return;
			}

			WP_CLI::warning( 'Latest run not found.' );
			return;
		}

		$run_path = WP_CONTENT_DIR . '/uploads/factory-runs/' . $latest;

		if ( ! file_exists( $run_path ) ) {
			WP_CLI::error( "Latest run manifest missing: {$latest}" );
		}

		$run = json_decode( file_get_contents( $run_path ), true );

		if ( ! is_array( $run ) ) {
			WP_CLI::error( 'Invalid run manifest JSON.' );
		}

		$blueprint = $run['blueprint'] ?? [];

		$current = factory_validate_blueprint_state( $blueprint, false );
		$status  = $current['status'] ?? 'error';

		if ( $is_json ) {
			$issues = [];

			foreach ( $current['checks'] ?? [] as $check ) {
				if ( ( $check['status'] ?? '' ) === 'ok' ) {
					continue;
				}

				$issues[] = [
					'status'  => $check['status'] ?? 'error',
					'message' => $check['message'] ?? '',
				];
			}

			$this->output_json( [
				'status'     => $status,
				'latest_run' => $latest,
				'prompt'     => $run['prompt'] ?? '',
				'issues'     => $issues,
			] );

			return;
		}

		WP_CLI::log( '' );
		WP_CLI::log( 'Factory Doctor' );
		WP_CLI::log( '' );
		WP_CLI::log( 'Latest Run: ' . $latest );
		WP_CLI::log( 'Prompt: ' . ( $run['prompt'] ?? '-' ) );
		WP_CLI::log( '' );

		if ( 'ok' === $status ) {
			WP_CLI::success( 'System healthy. All layers are in sync.' );
			return;
		}

		WP_CLI::warning( 'Drift detected.' );
		WP_CLI::log( '' );
		WP_CLI::log( 'Issues:' );

		foreach ( $current['checks'] ?? [] as $check ) {
			if ( ( $check['status'] ?? '' ) === 'ok' ) {
				continue;
			}

			WP_CLI::log( '  - ' . ( $check['message'] ?? '' ) );
		}

		WP_CLI::log( '' );
		WP_CLI::log( 'Suggested action:' );
		WP_CLI::log( '  wp factory fix' );

            if ( isset( $assoc_args['fix'] ) ) {
                WP_CLI::log( '' );
                WP_CLI::log( 'Running auto-fix...' );

                $fix = new Factory_Fix_Command();
                $fix->__invoke( [], [] );

                WP_CLI::log( '' );
                WP_CLI::log( 'Re-checking system state...' );

                $after_fix = factory_validate_blueprint_state(
                    $blueprint,
                    false
                );

                if ( ( $after_fix['status'] ?? 'error' ) === 'ok' ) {
                    WP_CLI::success( 'System repaired. Current state: IN SYNC' );
                    return;
                }

                WP_CLI::warning( 'Auto-fix completed, but drift still exists.' );
            }
	}

	private function output_json( array $data ): void {
		WP_CLI::line(
			wp_json_encode(
				$data,
				JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
			)
		);
	}
}