<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Dry_Run_Command {

	public function get_plan_items( array $blueprint ): array {
		$all_items = [];

		foreach ( factory_get_adapters() as $adapter ) {
			$class         = get_class( $adapter );
			$adapter_label = $this->format_adapter_name( $class );

			if ( method_exists( $adapter, 'plan' ) ) {
				$items = $adapter->plan( $blueprint );
			} elseif ( method_exists( $adapter, 'validate' ) ) {
				$items = $this->convert_validate_to_plan( $adapter->validate( $blueprint ) );
			} else {
				continue;
			}

			foreach ( $items as $item ) {
				$all_items[] = $this->normalize_plan_item( $item, $class, $adapter_label );
			}
		}

		return $all_items;
	}

	public function __invoke( array $args = [], array $assoc_args = [] ): void {
		$path         = $args[0] ?? FACTORY_BLUEPRINT_PATH;
		$format       = $assoc_args['format'] ?? 'table';
		$output_path  = $assoc_args['output-file'] ?? '';
		$diff_mode    = $assoc_args['diff'] ?? 'short';
		$only_changes = isset( $assoc_args['only-changes'] );
		$only         = $assoc_args['only'] ?? null;
		$is_json      = 'json' === $format;

		$registry = new Factory_Adapter_Registry();
		$only_map = $registry->get_adapter_keys();

		if ( $only && isset( $only_map[ $only ] ) ) {
			$only = $only_map[ $only ];
		}

		if ( ! file_exists( $path ) ) {
			WP_CLI::error( "Blueprint file not found: {$path}" );
		}

		$blueprint = json_decode( file_get_contents( $path ), true );

		if ( ! is_array( $blueprint ) ) {
			WP_CLI::error( 'Invalid blueprint JSON.' );
		}

		$summary = [
			'create'  => 0,
			'update'  => 0,
			'skip'    => 0,
			'warning' => 0,
			'error'   => 0,
		];

		$all_items = [];

		if ( ! $is_json ) {
			WP_CLI::log( '' );
			WP_CLI::log( 'Factory plan' );
			WP_CLI::log( 'Blueprint: ' . $path );
			WP_CLI::log( 'No changes will be applied.' );
			WP_CLI::log( '' );
		}

		foreach ( factory_get_adapters() as $adapter ) {
			$class         = get_class( $adapter );
			$adapter_label = $this->format_adapter_name( $class );

			if ( $only && $class !== $only ) {
				continue;
			}

			if ( method_exists( $adapter, 'plan' ) ) {
				$items = $adapter->plan( $blueprint );
			} elseif ( method_exists( $adapter, 'validate' ) ) {
				$items = $this->convert_validate_to_plan( $adapter->validate( $blueprint ) );
			} else {
				continue;
			}

			if ( empty( $items ) ) {
				continue;
			}

			$visible_items = [];

			foreach ( $items as $item ) {
				$item      = $this->normalize_plan_item( $item, $class, $adapter_label );
				$action    = $item['action'];
				$message   = $item['message'];
				$is_change = in_array( $action, [ 'create', 'update', 'error', 'warning' ], true );

				if ( isset( $summary[ $action ] ) ) {
					$summary[ $action ]++;
				}

				if ( ! $only_changes || $is_change ) {
					$visible_items[] = $item;
					$all_items[]     = $item;
				}
			}

			if ( empty( $visible_items ) ) {
				continue;
			}

			if ( ! $is_json ) {
				WP_CLI::log( $adapter_label );
			}

			foreach ( $visible_items as $item ) {
				if ( $is_json ) {
					continue;
				}

				$action  = $item['action'] ?? 'skip';
				$message = $item['message'] ?? '';

				WP_CLI::log( '  ' . $this->format_action( $action ) . ' ' . $message );

				if ( isset( $item['diff'] ) && is_array( $item['diff'] ) ) {
					foreach ( $item['diff'] as $key => $change ) {
						if ( 'short' === $diff_mode ) {
							WP_CLI::log( "      - {$key} changed" );
							continue;
						}

						if ( is_array( $change ) ) {
							if ( isset( $change['old'], $change['new'] ) ) {
								$old = is_scalar( $change['old'] ) ? $change['old'] : '[complex]';
								$new = is_scalar( $change['new'] ) ? $change['new'] : '[complex]';

								WP_CLI::log( "      - {$key}:" );
								WP_CLI::log( "          old: {$old}" );
								WP_CLI::log( "          new: {$new}" );
								continue;
							}

							if ( isset( $change['value'] ) ) {
								WP_CLI::log( "      - {$key} (new value)" );
								continue;
							}
						}

						WP_CLI::log( "      - {$key} changed" );
					}
				}
			}

			if ( ! $is_json ) {
				WP_CLI::log( '' );
			}
		}

		if ( $is_json ) {
			$data = [
				'version' => 1,
				'summary' => $summary,
				'items'   => $all_items,
			];

			$json = wp_json_encode(
				$data,
				JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
			);

			if ( $output_path ) {
				$dir = dirname( $output_path );

				if ( ! is_dir( $dir ) ) {
					wp_mkdir_p( $dir );
				}

				file_put_contents( $output_path, $json );

				WP_CLI::success( "Dry-run JSON saved: {$output_path}" );
				return;
			}

			WP_CLI::line( $json );
			return;
		}

		WP_CLI::log( 'Summary:' );
		WP_CLI::log( "  + {$summary['create']} to create" );
		WP_CLI::log( "  ~ {$summary['update']} to update" );
		WP_CLI::log( "  = {$summary['skip']} unchanged" );

		if ( $summary['warning'] > 0 ) {
			WP_CLI::log( "  ! {$summary['warning']} warnings" );
		}

		if ( $summary['error'] > 0 ) {
			WP_CLI::log( "  x {$summary['error']} errors" );
		}

		if ( $summary['create'] > 0 || $summary['update'] > 0 || $summary['error'] > 0 ) {
			WP_CLI::warning( 'Plan completed. Changes would be required.' );
			return;
		}

		WP_CLI::success( 'Plan completed. No changes required.' );
	}

	private function convert_validate_to_plan( array $results ): array {
		$items = [];

		foreach ( $results as $line ) {
			$status  = $line['status'] ?? 'ok';
			$message = $line['message'] ?? '';

			$items[] = [
				'action'  => $status === 'ok' ? 'skip' : $status,
				'message' => $message,
			];
		}

		return $items;
	}

	private function normalize_plan_item( array $item, string $adapter_class, string $adapter_label ): array {
		$normalized = $item;
		$diff       = $item['diff'] ?? [];

		$normalized['adapter_class'] = $adapter_class;
		$normalized['adapter']       = $adapter_label;
		$normalized['action']        = $item['action'] ?? 'skip';
		$normalized['type']          = $item['type'] ?? $this->get_adapter_key( $adapter_class, $adapter_label );
		$normalized['entity']        = $item['entity'] ?? '';
		$normalized['message']       = $item['message'] ?? '';
		$normalized['diff']          = is_array( $diff ) ? $diff : [];

		return $normalized;
	}

	private function get_adapter_key( string $adapter_class, string $adapter_label ): string {
		static $keys_by_class = null;

		if ( null === $keys_by_class ) {
			$registry      = new Factory_Adapter_Registry();
			$keys_by_class = array_flip( $registry->get_adapter_keys() );
		}

		return $keys_by_class[ $adapter_class ] ?? $adapter_label;
	}

	private function format_action( string $action ): string {
		return match ( $action ) {
			'create'  => '+',
			'update'  => '~',
			'warning' => '!',
			'error'   => 'x',
			default   => '=',
		};
	}

	private function format_adapter_name( string $class ): string {
		return match ( $class ) {
			'Factory_Plugin_Adapter'            => 'Plugins',
			'Factory_Theme_Adapter'             => 'Theme',
			'Factory_Taxonomy_Adapter'          => 'Taxonomies',
			'Factory_WP_Core_Adapter'           => 'WordPress Core',
			'Factory_JetEngine_Adapter'         => 'JetEngine Meta',
			'Factory_JetEngine_Listing_Adapter' => 'JetEngine Listings',
			'Factory_Render_Adapter'            => 'Render Pages',
			'Factory_Single_Adapter'            => 'Single Templates',
			'Factory_Content_Adapter'           => 'Content',
			default                             => $class,
		};
	}
}
