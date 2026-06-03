<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Health_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {
		$format  = $assoc_args['format'] ?? 'table';
		$is_json = isset( $assoc_args['json'] ) || 'json' === $format;

		$checks = [
			$this->check_cli(),
			$this->check_wordpress(),
			$this->check_database(),
			$this->check_storage(),
			$this->check_registry(),
			$this->check_adapters(),
			$this->check_blueprint_state(),
			$this->check_rest_registered(),
		];

		$status = $this->aggregate_status( $checks );

		if ( $is_json ) {
			WP_CLI::line(
				wp_json_encode(
					[
						'status' => $status,
						'checks' => $checks,
					],
					JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
				)
			);

			return;
		}

		WP_CLI\Utils\format_items(
			'table',
			$checks,
			[
				'layer',
				'status',
				'message',
			]
		);
	}

	private function check_cli(): array {
		return [
			'layer'   => 'cli',
			'status'  => 'ok',
			'message' => 'WP-CLI bootstrap succeeded.',
		];
	}

	private function check_wordpress(): array {
		if (
			defined( 'ABSPATH' )
			&& function_exists( 'get_bloginfo' )
			&& function_exists( 'wp_upload_dir' )
		) {
			return [
				'layer'   => 'wordpress',
				'status'  => 'ok',
				'message' => 'WordPress bootstrap succeeded.',
			];
		}

		return [
			'layer'   => 'wordpress',
			'status'  => 'error',
			'message' => 'WordPress bootstrap functions are unavailable.',
		];
	}

	private function check_database(): array {
		global $wpdb;

		if ( ! isset( $wpdb ) || ! is_object( $wpdb ) || ! method_exists( $wpdb, 'get_var' ) ) {
			return [
				'layer'   => 'database',
				'status'  => 'error',
				'message' => 'WordPress database object is unavailable.',
			];
		}

		$result = $wpdb->get_var( 'SELECT 1' );

		if ( (string) $result === '1' ) {
			return [
				'layer'   => 'database',
				'status'  => 'ok',
				'message' => 'Database SELECT 1 succeeded.',
			];
		}

		$error = $wpdb->last_error ?? '';

		return [
			'layer'   => 'database',
			'status'  => 'error',
			'message' => $error ? "Database SELECT 1 failed: {$error}" : 'Database SELECT 1 failed.',
		];
	}

	private function check_storage(): array {
		$dir = WP_CONTENT_DIR . '/uploads/factory-runs';

		if ( ! is_dir( $dir ) ) {
			return [
				'layer'   => 'storage',
				'status'  => 'warning',
				'message' => 'Factory runs directory is missing.',
			];
		}

		if ( is_readable( $dir ) && is_writable( $dir ) ) {
			return [
				'layer'   => 'storage',
				'status'  => 'ok',
				'message' => 'Factory runs directory is readable and writable.',
			];
		}

		return [
			'layer'   => 'storage',
			'status'  => 'error',
			'message' => 'Factory runs directory is not readable and writable.',
		];
	}

	private function check_registry(): array {
		$registry = factory_get_runs_registry();

		if ( ! empty( $registry ) ) {
			return [
				'layer'   => 'registry',
				'status'  => 'ok',
				'message' => 'Factory run registry is available.',
			];
		}

		return [
			'layer'   => 'registry',
			'status'  => 'warning',
			'message' => 'Factory run registry is missing or empty.',
		];
	}

	private function check_adapters(): array {
		$registry = new Factory_Adapter_Registry();
		$report   = $registry->get_contract_report();

		foreach ( $report as $adapter ) {
			if ( empty( $adapter['contract_ready'] ) ) {
				return [
					'layer'   => 'adapters',
					'status'  => 'error',
					'message' => 'One or more adapters are missing expected contract methods.',
				];
			}
		}

		return [
			'layer'   => 'adapters',
			'status'  => 'ok',
			'message' => 'All registered adapters are contract-ready.',
		];
	}

	private function check_blueprint_state(): array {
		$latest = factory_get_latest_run_name();

		if ( ! $latest ) {
			return [
				'layer'   => 'blueprint_state',
				'status'  => 'warning',
				'message' => 'No latest run is available for blueprint state validation.',
			];
		}

		$run = factory_get_run_manifest( $latest );

		if ( ! is_array( $run ) ) {
			return [
				'layer'   => 'blueprint_state',
				'status'  => 'error',
				'message' => 'Latest run manifest is missing or invalid.',
			];
		}

		$blueprint = $run['blueprint'] ?? null;

		if ( ! is_array( $blueprint ) ) {
			return [
				'layer'   => 'blueprint_state',
				'status'  => 'warning',
				'message' => 'Latest run does not contain a blueprint.',
			];
		}

		$result = factory_validate_blueprint_state( $blueprint, false );

		if ( ( $result['status'] ?? 'error' ) === 'ok' ) {
			return [
				'layer'   => 'blueprint_state',
				'status'  => 'ok',
				'message' => 'Latest blueprint state is in sync.',
			];
		}

		return [
			'layer'   => 'blueprint_state',
			'status'  => 'error',
			'message' => 'Latest blueprint state has validation issues.',
		];
	}

	private function check_rest_registered(): array {
		if ( ! function_exists( 'rest_get_server' ) ) {
			return [
				'layer'   => 'rest_registered',
				'status'  => 'error',
				'message' => 'WordPress REST server is unavailable.',
			];
		}

		$server = rest_get_server();

		if ( ! is_object( $server ) || ! method_exists( $server, 'get_routes' ) ) {
			return [
				'layer'   => 'rest_registered',
				'status'  => 'error',
				'message' => 'WordPress REST routes cannot be inspected.',
			];
		}

		$routes = array_keys( $server->get_routes() );

		foreach ( $routes as $route ) {
			if ( str_starts_with( $route, '/factory/v1/' ) ) {
				return [
					'layer'   => 'rest_registered',
					'status'  => 'ok',
					'message' => 'Factory REST routes are registered in-process.',
				];
			}
		}

		return [
			'layer'   => 'rest_registered',
			'status'  => 'warning',
			'message' => 'Factory REST routes are not registered in-process.',
		];
	}

	private function aggregate_status( array $checks ): string {
		$has_warning = false;

		foreach ( $checks as $check ) {
			if ( ( $check['status'] ?? '' ) === 'error' ) {
				return 'error';
			}

			if ( ( $check['status'] ?? '' ) === 'warning' ) {
				$has_warning = true;
			}
		}

		return $has_warning ? 'warning' : 'ok';
	}
}
