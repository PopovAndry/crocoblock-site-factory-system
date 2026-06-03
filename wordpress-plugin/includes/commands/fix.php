<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Fix_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {
		$is_dry_run = isset( $assoc_args['dry-run'] );

		WP_CLI::log(
			$is_dry_run
				? 'Running smart fix v4 dry-run (plan-based)...'
				: 'Running smart fix v4 (plan-based)...'
		);

		$blueprint = factory_get_blueprint();

		if ( empty( $blueprint ) ) {
			WP_CLI::error( 'Blueprint not found.' );
		}

		$only = $assoc_args['only'] ?? null;

		$registry = new Factory_Adapter_Registry();
		$only_map = $registry->get_adapter_keys();

		if ( $only && isset( $only_map[ $only ] ) ) {
			$only = $only_map[ $only ];
		}

		$adapters = factory_get_adapters();

		$dry_run    = new Factory_Dry_Run_Command();
		$plan_items = $dry_run->get_plan_items( $blueprint );

		$changes = [];

		foreach ( $plan_items as $item ) {
			$is_change = in_array( $item['action'] ?? '', [ 'create', 'update', 'error' ], true );

			if ( ! $is_change ) {
				continue;
			}

			if ( $only && ( $item['adapter_class'] ?? '' ) !== $only ) {
				continue;
			}

			$changes[] = $item;
		}

		if ( empty( $changes ) ) {
			if ( $only ) {
				WP_CLI::success( "Nothing to fix for: {$only}" );
			} else {
				WP_CLI::success( 'Nothing to fix. State is valid.' );
			}

			return;
		}

		$this->log_plan_changes( $changes );

		$changed_adapter_classes = [];

		foreach ( $changes as $item ) {
			if ( ! empty( $item['adapter_class'] ) ) {
				$changed_adapter_classes[] = $item['adapter_class'];
			}
		}

		$adapters_to_apply = $this->expand_dependencies( array_unique( $changed_adapter_classes ) );

		WP_CLI::log(
			$is_dry_run
				? 'Dry-run: affected adapters with dependencies:'
				: 'Applying affected adapters with dependencies...'
		);

		$execution = [];

		foreach ( $adapters as $adapter ) {
			$class = get_class( $adapter );

			if ( ! in_array( $class, $adapters_to_apply, true ) ) {
				WP_CLI::log( "Skipping {$class}" );
				continue;
			}

			if ( ! method_exists( $adapter, 'apply' ) ) {
				continue;
			}

			if ( method_exists( $adapter, 'plan' ) ) {
				$plan        = $adapter->plan( $blueprint );
				$needs_apply = false;

				foreach ( $plan as $item ) {
					if ( in_array( $item['action'] ?? '', [ 'create', 'update', 'error' ], true ) ) {
						$needs_apply = true;
						break;
					}
				}

				if ( ! $needs_apply ) {
					WP_CLI::log( "Skipping {$class} (dependency only, no changes)" );
					continue;
				}
			}

			if ( $is_dry_run ) {
				WP_CLI::log( "Would fix via {$class}" );
				continue;
			}

			WP_CLI::log( "Fixing via {$class}..." );
			$adapter->apply( $blueprint );

			if ( method_exists( $adapter, 'get_execution_results' ) ) {
				$execution = array_merge( $execution, $adapter->get_execution_results() );
			}
		}

		if ( $is_dry_run ) {
			WP_CLI::warning( 'Dry-run completed. No changes were applied.' );
			return;
		}

		flush_rewrite_rules();

		WP_CLI::log( 'Re-validating...' );

		$remaining_changes = [];

		$plan_items_after_fix = $dry_run->get_plan_items( $blueprint );
		$plan_summary         = $this->build_plan_summary( $plan_items_after_fix );
		$plan                 = [
			'version' => 1,
			'summary' => $plan_summary,
			'items'   => $plan_items_after_fix,
		];

		$report        = factory_validate_blueprint_state( $blueprint, true );
		$manifest_path = factory_save_run_manifest(
			'Fix active blueprint',
			null,
			$blueprint,
			$plan,
			$report,
			$report['status'] ?? 'error',
			$execution
		);

		WP_CLI::log( "Run manifest saved: {$manifest_path}" );

		foreach ( $plan_items_after_fix as $item ) {
			if ( in_array( $item['action'] ?? '', [ 'create', 'update', 'error' ], true ) ) {
				$remaining_changes[] = $item;
			}
		}

		if ( empty( $remaining_changes ) ) {
			WP_CLI::success( 'Fix v4 completed. State is now valid.' );
			return;
		}

		WP_CLI::warning( 'Some issues remain after fix:' );
		$this->log_plan_changes( $remaining_changes );
	}

	private function expand_dependencies( array $changed_classes ): array {
		$registry     = new Factory_Adapter_Registry();
		$dependencies = $registry->get_dependencies();

		$result = [];

		foreach ( $changed_classes as $class ) {
			if ( isset( $dependencies[ $class ] ) ) {
				$result = array_merge( $result, $dependencies[ $class ] );
			} else {
				$result[] = $class;
			}
		}

		return array_values( array_unique( $result ) );
	}

	private function log_plan_changes( array $changes ): void {
		WP_CLI::warning( 'Detected changes from plan:' );

		foreach ( $changes as $item ) {
			$adapter = $item['adapter'] ?? ( $item['adapter_class'] ?? 'Unknown adapter' );
			$message = $item['message'] ?? 'Unknown change';

			WP_CLI::log( "- {$adapter}" );
			WP_CLI::log( "  {$message}" );
		}
	}

	private function build_plan_summary( array $plan_items ): array {
		$summary = [
			'create'  => 0,
			'update'  => 0,
			'skip'    => 0,
			'warning' => 0,
			'error'   => 0,
		];

		foreach ( $plan_items as $item ) {
			$action = $item['action'] ?? 'skip';

			if ( ! array_key_exists( $action, $summary ) ) {
				$action = 'skip';
			}

			$summary[ $action ]++;
		}

		return $summary;
	}
}
