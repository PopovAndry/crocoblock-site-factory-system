<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Run_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {

		$file = $args[0] ?? 'latest';

		if ( 'latest' === $file ) {
			$file = factory_get_latest_run_name();

			if ( ! $file ) {
				WP_CLI::error( 'Latest run not found.' );
			}
		}

		$data = factory_get_run_manifest( $file );

		if ( ! is_array( $data ) ) {
			WP_CLI::error( "Run file not found or invalid: {$file}" );
		}

		if ( ! $file ) {
			WP_CLI::error(
				'Provide run filename.'
			);
		}

		$path = factory_get_run_manifest_path( $file );

		if ( ! file_exists( $path ) ) {
			WP_CLI::error(
				"Run file not found: {$file}"
			);
		}

		$data = json_decode(
			file_get_contents( $path ),
			true
		);

		if ( ! is_array( $data ) ) {
			WP_CLI::error(
				'Invalid run manifest JSON.'
			);
		}

		WP_CLI::log( '' );
		WP_CLI::log( 'Factory Run' );
		WP_CLI::log( '' );

		WP_CLI::log(
			'File: ' . $file
		);

		WP_CLI::log(
			'Timestamp: ' .
			( $data['timestamp'] ?? '-' )
		);

		WP_CLI::log(
			'Status: ' .
			( $data['status'] ?? '-' )
		);

		WP_CLI::log(
			'Preset: ' .
			( $data['preset'] ?? '-' )
		);

		WP_CLI::log(
			'Prompt: ' .
			( $data['prompt'] ?? '-' )
		);

		WP_CLI::log( '' );

		$plan = $data['plan']['summary'] ?? [];

		WP_CLI::log( 'Plan Summary' );

		WP_CLI::log(
			'+ Create: ' .
			( $plan['create'] ?? 0 )
		);

		WP_CLI::log(
			'~ Update: ' .
			( $plan['update'] ?? 0 )
		);

		WP_CLI::log(
			'= Skip: ' .
			( $plan['skip'] ?? 0 )
		);

		WP_CLI::log(
			'! Warning: ' .
			( $plan['warning'] ?? 0 )
		);

		WP_CLI::log(
			'x Error: ' .
			( $plan['error'] ?? 0 )
		);

		WP_CLI::log( '' );

		$execution_items = $data['execution']['items'] ?? [];

		if ( ! is_array( $execution_items ) ) {
			$execution_items = [];
		}

		WP_CLI::log( 'Execution' );
		WP_CLI::log(
			'Items: ' .
			count( $execution_items )
		);

		foreach ( $execution_items as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}

			$status  = $item['status'] ?? '';
			$action  = $item['action'] ?? '';
			$type    = $item['type'] ?? '';
			$entity  = $item['entity'] ?? '';
			$message = $item['message'] ?? '';

			$icon = $this->execution_icon(
				$status,
				$action
			);

			$line_parts = array_filter(
				[ $action, $type, $entity ],
				static fn( $part ) => '' !== trim( (string) $part )
			);

			$line = trim(
				$icon . ' ' . implode( ' ', $line_parts )
			);

			if ( '' !== trim( (string) $message ) ) {
				$line .= ' - ' . $message;
			}

			WP_CLI::log( $line );
		}

		WP_CLI::log( '' );

		$checks = $data['validation']['checks'] ?? [];

		if ( ! is_array( $checks ) ) {
			$checks = [];
		}

		WP_CLI::log(
			'Validation checks: ' .
			count( $checks )
		);

		WP_CLI::log( '' );

		foreach ( $checks as $check ) {

			$status = $check['status'] ?? 'unknown';
			$message = $check['message'] ?? '';

			$icon = match ( $status ) {
				'ok'      => '=',
				'warning' => '!',
				'error'   => 'x',
				default   => '-',
			};

			WP_CLI::log(
				"{$icon} {$message}"
			);
		}
	}

	private function execution_icon(
		string $status,
		string $action
	): string {
		if ( 'error' === $status ) {
			return 'x';
		}

		return match ( $action ) {
			'create'  => '+',
			'update'  => '~',
			'skip'    => '=',
			'warning' => '!',
			default   => '-',
		};
	}
}
