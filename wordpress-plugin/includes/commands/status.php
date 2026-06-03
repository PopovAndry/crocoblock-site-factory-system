<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Status_Command {

	public function __invoke(): void {
        $latest = factory_get_latest_run_name();

        if ( ! $latest ) {
            WP_CLI::warning( 'No latest run found.' );
            return;
        }

        $run = factory_get_run_manifest( $latest );

        if ( ! is_array( $run ) ) {
            WP_CLI::error( "Run file missing or invalid: {$latest}" );
        }

		$plan = $run['plan']['summary'] ?? [];

		WP_CLI::log( '' );
		WP_CLI::log( 'Factory Status' );
		WP_CLI::log( '' );

		WP_CLI::log( 'Latest Run: ' . $latest );
		WP_CLI::log( 'Timestamp: ' . ( $run['timestamp'] ?? '-' ) );
		WP_CLI::log( 'Preset: ' . ( $run['preset'] ?? '-' ) );
		WP_CLI::log( 'Status: ' . ( $run['status'] ?? '-' ) );
		WP_CLI::log( 'Prompt: ' . ( $run['prompt'] ?? '-' ) );

		WP_CLI::log( '' );
		WP_CLI::log( 'Plan Summary' );

		WP_CLI::log( '+ Create: ' . ( $plan['create'] ?? 0 ) );
		WP_CLI::log( '~ Update: ' . ( $plan['update'] ?? 0 ) );
		WP_CLI::log( '= Skip: ' . ( $plan['skip'] ?? 0 ) );
		WP_CLI::log( '! Warning: ' . ( $plan['warning'] ?? 0 ) );
		WP_CLI::log( 'x Error: ' . ( $plan['error'] ?? 0 ) );

		WP_CLI::log( '' );

		$current_validation = factory_validate_blueprint_state(
			$run['blueprint'] ?? [],
			false
		);

		$current_status = $current_validation['status'] ?? 'error';

		if ( 'ok' === $current_status ) {
			WP_CLI::success( 'Current system state: IN SYNC' );
			return;
		}

		WP_CLI::warning( 'Current system state: DRIFT DETECTED' );

		$checks = $current_validation['checks'] ?? [];

		foreach ( $checks as $check ) {
			if ( ( $check['status'] ?? '' ) === 'ok' ) {
				continue;
			}

			WP_CLI::log(
				'  - ' . ( $check['message'] ?? '' )
			);
		}
	}
}