<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Theme_Adapter {

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		// нічого
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];

		if ( empty( $blueprint['theme'] ) ) {
			return;
		}

		$config = $blueprint['theme'];

		$slug = $config['slug'] ?? '';
		$path = $config['path'] ?? '';

		if ( ! $slug ) {
			$this->execution_results[] = $this->execution_item(
				'error',
				'create',
				'',
				'Theme slug is missing.'
			);
			return;
		}

		if ( wp_get_theme()->get_stylesheet() === $slug ) {
			$this->log( "Theme already active: {$slug}" );
			$this->execution_results[] = $this->execution_item(
				'ok',
				'skip',
				$slug,
				"Theme already active: {$slug}"
			);
			return;
		}

		if ( ! wp_get_theme( $slug )->exists() ) {

			if ( $path && file_exists( $path ) ) {
				$this->log( "Installing theme: {$slug}" );

				WP_CLI::runcommand(
					'theme install ' . escapeshellarg( $path ),
					[ 'launch' => false ]
				);

				$this->execution_results[] = $this->execution_item(
					wp_get_theme( $slug )->exists() ? 'ok' : 'error',
					'create',
					$slug,
					wp_get_theme( $slug )->exists()
						? "Theme installed: {$slug}"
						: "Theme install failed: {$slug}"
				);
			} else {
				$this->warn( "Theme not found: {$slug}" );
				$this->execution_results[] = $this->execution_item(
					'error',
					'create',
					$slug,
					"Theme not found: {$slug}"
				);
				return;
			}
		} else {
			$this->execution_results[] = $this->execution_item(
				'ok',
				'skip',
				$slug,
				"Theme already installed: {$slug}"
			);
		}

		$this->log( "Activating theme: {$slug}" );

		WP_CLI::runcommand(
			'theme activate ' . escapeshellarg( $slug ),
			[ 'launch' => false ]
		);

		$this->execution_results[] = $this->execution_item(
			wp_get_theme()->get_stylesheet() === $slug ? 'ok' : 'error',
			'update',
			$slug,
			wp_get_theme()->get_stylesheet() === $slug
				? "Theme activated: {$slug}"
				: "Theme activation failed: {$slug}"
		);
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
		if ( empty( $blueprint['theme'] ) ) {
			return [];
		}

		$config = $blueprint['theme'];
		$slug   = $config['slug'] ?? '';
		$path   = $config['path'] ?? '';

		if ( ! $slug ) {
			return [
				[
					'action'  => 'error',
					'type'    => 'theme',
					'entity'  => '',
					'message' => 'Theme slug is missing.',
					'diff'    => [],
				],
			];
		}

		if ( wp_get_theme()->get_stylesheet() === $slug ) {
			return [
				[
					'action'  => 'skip',
					'type'    => 'theme',
					'entity'  => $slug,
					'message' => "Theme active: {$slug}",
					'diff'    => [],
				],
			];
		}

		if ( wp_get_theme( $slug )->exists() ) {
			return [
				[
					'action'  => 'update',
					'type'    => 'theme',
					'entity'  => $slug,
					'message' => "Activate theme: {$slug}",
					'diff'    => [
						'active_theme' => [
							'old' => wp_get_theme()->get_stylesheet(),
							'new' => $slug,
						],
					],
				],
			];
		}

		if ( $path && file_exists( $path ) ) {
			return [
				[
					'action'  => 'create',
					'type'    => 'theme',
					'entity'  => $slug,
					'message' => "Install theme: {$slug}",
					'diff'    => [
						'installed' => [
							'old' => false,
							'new' => true,
						],
						'source'    => [
							'value' => $path,
						],
					],
				],
			];
		}

		return [
			[
				'action'  => 'error',
				'type'    => 'theme',
				'entity'  => $slug,
				'message' => "Theme missing: {$slug}",
				'diff'    => [],
			],
		];
	}

	public function validate( array $blueprint ): array {

		$checks = [];

		if ( empty( $blueprint['theme'] ) ) {
			return $checks;
		}

		$slug = $blueprint['theme']['slug'] ?? '';

		if ( ! $slug ) {
			return $checks;
		}

		if ( wp_get_theme()->get_stylesheet() === $slug ) {
			$checks[] = [
				'status'  => 'ok',
				'message' => "Theme active: {$slug}",
			];
		} else {
			$checks[] = [
				'status'  => 'error',
				'message' => "Theme NOT active: {$slug}",
			];
		}

		return $checks;
	}

	private function log( $msg ) {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::log( $msg );
		}
	}

	private function warn( $msg ) {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::warning( $msg );
		}
	}

	private function execution_item(
		string $status,
		string $action,
		string $slug,
		string $message
	): array {
		return [
			'status'  => $status,
			'action'  => $action,
			'type'    => 'theme',
			'entity'  => $slug,
			'message' => $message,
			'details' => [],
		];
	}
}
