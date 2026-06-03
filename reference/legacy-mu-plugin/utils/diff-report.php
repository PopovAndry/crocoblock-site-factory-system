<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Diff_Report {

	private array $data = [
		'created' => [],
		'updated' => [],
		'skipped' => [],
		'errors'  => [],
	];

	public function add( string $type, string $entity, array $diff ): void {
		if ( empty( $diff ) ) {
			$this->data['skipped'][] = "{$type}: {$entity}";
			return;
		}

		$this->data['updated'][] = "{$type}: {$entity}";
	}

	public function created( string $type, string $entity ): void {
		$this->data['created'][] = "{$type}: {$entity}";
	}

	public function error( string $type, string $entity, string $message ): void {
		$this->data['errors'][] = "{$type}: {$entity} → {$message}";
	}

	public function has_changes(): bool {
		return ! empty( $this->data['created'] )
			|| ! empty( $this->data['updated'] )
			|| ! empty( $this->data['errors'] );
	}

	public function output(): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
			return;
		}

		if ( ! $this->has_changes() ) {
			WP_CLI::success( 'Diff report: no changes' );
			return;
		}

		WP_CLI::log( '--- DIFF REPORT ---' );

		foreach ( $this->data as $section => $items ) {
			if ( empty( $items ) ) {
				continue;
			}

			WP_CLI::log( strtoupper( $section ) . ':' );

			foreach ( $items as $line ) {
				WP_CLI::log( "  - {$line}" );
			}
		}
	}
}