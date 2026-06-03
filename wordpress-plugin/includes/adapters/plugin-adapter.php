<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Plugin_Adapter {

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		// Plugins are handled only during apply/validate.
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];

		foreach ( $blueprint['plugins'] ?? [] as $plugin_config ) {
			$plugin = $this->normalize_plugin_config( $plugin_config );

			if ( empty( $plugin['slug'] ) ) {
				$this->warn( 'Plugin slug is missing.' );
				$this->execution_results[] = $this->execution_item(
					'error',
					'create',
					'',
					'Plugin slug is missing.'
				);
				continue;
			}

			$slug     = $plugin['slug'];
			$path     = $plugin['path'];
			$activate = $plugin['activate'];

			if ( $this->is_active( $slug ) ) {
				$this->log( "Plugin already active: {$slug}" );
				$this->execution_results[] = $this->execution_item(
					'ok',
					'skip',
					$slug,
					"Plugin already active: {$slug}"
				);
				continue;
			}

			if ( $this->exists( $slug ) ) {
				$this->log( "Plugin already installed: {$slug}" );
				$this->execution_results[] = $this->execution_item(
					'ok',
					'skip',
					$slug,
					"Plugin already installed: {$slug}"
				);

				if ( $activate ) {
					$this->activate( $slug );
					$this->execution_results[] = $this->execution_item(
						$this->is_active( $slug ) ? 'ok' : 'error',
						'update',
						$slug,
						$this->is_active( $slug )
							? "Plugin activated: {$slug}"
							: "Plugin activation failed: {$slug}"
					);
				}

				continue;
			}

			if ( $path && file_exists( $path ) ) {
				$this->install_from_path( $slug, $path );
				$this->execution_results[] = $this->execution_item(
					$this->exists( $slug ) ? 'ok' : 'error',
					'create',
					$slug,
					$this->exists( $slug )
						? "Plugin installed: {$slug}"
						: "Plugin install failed: {$slug}"
				);

				if ( $activate ) {
					$this->activate( $slug );
					$this->execution_results[] = $this->execution_item(
						$this->is_active( $slug ) ? 'ok' : 'error',
						'update',
						$slug,
						$this->is_active( $slug )
							? "Plugin activated: {$slug}"
							: "Plugin activation failed: {$slug}"
					);
				}

				continue;
			}

			$this->warn( "Plugin not found: {$slug}" );
			$this->execution_results[] = $this->execution_item(
				'error',
				'create',
				$slug,
				"Plugin not found: {$slug}"
			);
		}
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
		$plan = [];

		foreach ( $blueprint['plugins'] ?? [] as $plugin_config ) {
			$plugin = $this->normalize_plugin_config( $plugin_config );

			if ( empty( $plugin['slug'] ) ) {
				$plan[] = [
					'action'  => 'error',
					'type'    => 'plugin',
					'entity'  => '',
					'message' => 'Plugin slug is missing.',
					'diff'    => [],
				];

				continue;
			}

			$slug = $plugin['slug'];

			if ( $this->is_active( $slug ) ) {
				$plan[] = [
					'action'  => 'skip',
					'type'    => 'plugin',
					'entity'  => $slug,
					'message' => "Plugin active: {$slug}",
					'diff'    => [],
				];

				continue;
			}

			if ( $this->exists( $slug ) ) {
				$plan[] = [
					'action'  => $plugin['activate'] ? 'warning' : 'skip',
					'type'    => 'plugin',
					'entity'  => $slug,
					'message' => $plugin['activate']
						? "Plugin installed but not active: {$slug}"
						: "Plugin installed: {$slug}",
					'diff'    => [],
				];

				continue;
			}

			$source = $this->get_install_source( $plugin );

			if ( $source ) {
				$plan[] = [
					'action'  => 'create',
					'type'    => 'plugin',
					'entity'  => $slug,
					'message' => "Install plugin: {$slug}",
					'diff'    => [
						'installed' => [
							'old' => false,
							'new' => true,
						],
						'source'    => [
							'value' => $source,
						],
					],
				];

				continue;
			}

			$plan[] = [
				'action'  => 'error',
				'type'    => 'plugin',
				'entity'  => $slug,
				'message' => "Plugin missing: {$slug}",
				'diff'    => [],
			];
		}

		return $plan;
	}

	public function validate( array $blueprint ): array {
		$checks = [];

		foreach ( $blueprint['plugins'] ?? [] as $plugin_config ) {
			$plugin = $this->normalize_plugin_config( $plugin_config );

			if ( empty( $plugin['slug'] ) ) {
				$checks[] = [
					'status'  => 'error',
					'message' => 'Plugin slug is missing.',
				];

				continue;
			}

			$slug = $plugin['slug'];

			if ( $this->is_active( $slug ) ) {
				$checks[] = [
					'status'  => 'ok',
					'message' => "Plugin active: {$slug}",
				];
			} elseif ( $this->exists( $slug ) ) {
				$checks[] = [
					'status'  => 'warning',
					'message' => "Plugin installed but not active: {$slug}",
				];
			} else {
				$checks[] = [
					'status'  => 'error',
					'message' => "Plugin missing: {$slug}",
				];
			}
		}

		return $checks;
	}

	private function normalize_plugin_config( $plugin_config ): array {
		if ( is_string( $plugin_config ) ) {
			return [
				'slug'     => $plugin_config,
				'path'     => '',
				'activate' => true,
			];
		}

		if ( is_array( $plugin_config ) ) {
			$slug = $plugin_config['slug'] ?? '';

			return [
				'slug'     => $slug,
				'path'     => $plugin_config['path'] ?? '',
				'activate' => $plugin_config['activate'] ?? true,
			];
		}

		return [
			'slug'     => '',
			'path'     => '',
			'activate' => false,
		];
	}

	private function is_active( string $slug ): bool {
		include_once ABSPATH . 'wp-admin/includes/plugin.php';

		foreach ( get_plugins() as $file => $data ) {
			if ( str_starts_with( $file, $slug . '/' ) ) {
				return is_plugin_active( $file );
			}
		}

		return false;
	}

	private function exists( string $slug ): bool {
		return is_dir( WP_PLUGIN_DIR . '/' . $slug );
	}

	private function get_install_source( array $plugin ): string {
		if ( ! empty( $plugin['path'] ) && file_exists( $plugin['path'] ) ) {
			return $plugin['path'];
		}

		return '';
	}

	private function install_from_path( string $slug, string $path ): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
			return;
		}

		$this->log( "Installing plugin from: {$path}" );

		WP_CLI::runcommand(
			'plugin install ' . escapeshellarg( $path ) . ' --force',
			[ 'launch' => false ]
		);

		$this->log( "Plugin installed: {$slug}" );
	}

	private function activate( string $slug ): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
			return;
		}

		$this->log( "Activating plugin: {$slug}" );

		WP_CLI::runcommand(
			'plugin activate ' . escapeshellarg( $slug ),
			[ 'launch' => false ]
		);
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
			'type'    => 'plugin',
			'entity'  => $slug,
			'message' => $message,
			'details' => [],
		];
	}

	private function log( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::log( $message );
		}
	}

	private function warn( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::warning( $message );
		}
	}
}
