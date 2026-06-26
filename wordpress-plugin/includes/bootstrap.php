<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/contracts/adapter-interface.php';
require_once __DIR__ . '/adapters/plugin-adapter.php';
require_once __DIR__ . '/adapters/wp-core-adapter.php';
require_once __DIR__ . '/adapters/theme-adapter.php';
require_once __DIR__ . '/adapters/jetengine-adapter.php';
require_once __DIR__ . '/adapters/jetengine-query-builder-adapter.php';
require_once __DIR__ . '/adapters/jetengine-listing-adapter.php';
require_once __DIR__ . '/adapters/jetsmartfilters-adapter.php';
require_once __DIR__ . '/adapters/render-adapter.php';
require_once __DIR__ . '/adapters/single-adapter.php';
require_once __DIR__ . '/adapters/taxonomy-adapter.php';
require_once __DIR__ . '/adapters/content-adapter.php';
require_once __DIR__ . '/adapter-registry.php';
require_once __DIR__ . '/utils/diff.php';
require_once __DIR__ . '/utils/diff-report.php';
require_once __DIR__ . '/utils/ownership.php';
require_once __DIR__ . '/utils/run-manifest.php';
require_once __DIR__ . '/utils/run-registry.php';
require_once __DIR__ . '/utils/run-storage.php';
require_once __DIR__ . '/blueprint/blueprint-normalizer.php';
require_once __DIR__ . '/blueprint/blueprint-validator.php';
require_once __DIR__ . '/blueprint/blueprint-preset-manager.php';
require_once __DIR__ . '/apply/real-estate-apply-service.php';
require_once __DIR__ . '/bridge/plugin-dry-run-evidence-collector.php';
require_once __DIR__ . '/bridge/ownership-evidence-collector.php';
require_once __DIR__ . '/bridge/plugin-preview-bridge-service.php';
require_once __DIR__ . '/ai/settings.php';
require_once __DIR__ . '/ai/prompt-interpreter.php';
require_once __DIR__ . '/ai/design-profile-schema.php';
require_once __DIR__ . '/ai/openai-safe-provider.php';
require_once __DIR__ . '/ai/live-prompt-service.php';
require_once __DIR__ . '/ai/site-plan-service.php';
require_once __DIR__ . '/ai/blueprint-candidate-service.php';
require_once __DIR__ . '/ai/preview-diff-service.php';
require_once __DIR__ . '/ai/generate-gate-service.php';
require_once __DIR__ . '/ai/generate-preflight-service.php';
require_once __DIR__ . '/ai/generate-confirmation-service.php';
require_once __DIR__ . '/ai/controlled-generate-service.php';
require_once __DIR__ . '/ai/blueprint-generator.php';
require_once __DIR__ . '/commands/fix.php';
require_once __DIR__ . '/commands/dry-run.php';
require_once __DIR__ . '/commands/ai.php';
require_once __DIR__ . '/commands/snapshot.php';
require_once __DIR__ . '/commands/rollback.php';
require_once __DIR__ . '/commands/runs.php';
require_once __DIR__ . '/commands/run.php';
require_once __DIR__ . '/commands/status.php';
require_once __DIR__ . '/commands/doctor.php';
require_once __DIR__ . '/commands/health.php';
require_once __DIR__ . '/commands/latest.php';
require_once __DIR__ . '/commands/explain.php';
require_once __DIR__ . '/commands/summary.php';
require_once __DIR__ . '/commands/commands.php';
require_once __DIR__ . '/commands/adapters.php';
require_once __DIR__ . '/api/rest.php';
require_once __DIR__ . '/api/ai-settings-rest.php';
require_once __DIR__ . '/api/ai-interpret-rest.php';
require_once __DIR__ . '/api/ai-live-rest.php';
require_once __DIR__ . '/api/ai-site-plan-rest.php';
require_once __DIR__ . '/api/ai-blueprint-candidate-rest.php';
require_once __DIR__ . '/api/ai-preview-diff-rest.php';
require_once __DIR__ . '/api/ai-generate-gate-rest.php';
require_once __DIR__ . '/api/ai-generate-preflight-rest.php';
require_once __DIR__ . '/api/ai-generate-confirmation-rest.php';
require_once __DIR__ . '/api/ai-controlled-generate-rest.php';
require_once __DIR__ . '/api/frontend-safe-edit-rest.php';
require_once FACTORY_PLUGIN_DIR . 'admin/dashboard.php';
require_once FACTORY_PLUGIN_DIR . 'admin/ai-settings.php';

function factory_get_blueprint(): array {
	$blueprint = get_option( FACTORY_BLUEPRINT_OPTION );

	if ( is_array( $blueprint ) ) {
		return $blueprint;
	}

	if ( ! file_exists( FACTORY_BLUEPRINT_PATH ) ) {
		return [];
	}

	$decoded = json_decode( file_get_contents( FACTORY_BLUEPRINT_PATH ), true );

	return is_array( $decoded ) ? $decoded : [];
}

function factory_get_adapters(): array {
	$registry = new Factory_Adapter_Registry();

	return $registry->get_adapters();
}

add_action( 'init', function () {
	$blueprint = factory_get_blueprint();

	foreach ( factory_get_adapters() as $adapter ) {
		$adapter->register( $blueprint );
	}
} );

function factory_apply_blueprint( array $blueprint ): array {
	$execution = [];

	update_option( FACTORY_BLUEPRINT_OPTION, $blueprint );

	$permalink = $blueprint['site']['permalink'] ?? '/%postname%/';
	update_option( 'permalink_structure', $permalink );

	foreach ( factory_get_adapters() as $adapter ) {
		$adapter->apply( $blueprint );

		if ( method_exists( $adapter, 'get_execution_results' ) ) {
			$adapter_results = $adapter->get_execution_results();
			$execution = array_merge( $execution, $adapter_results );
		}
	}

	flush_rewrite_rules();

	return $execution;
}

function factory_validate_blueprint_state( array $blueprint, bool $cli_output = true ): array {
	$report = [
		'timestamp' => current_time( 'mysql' ),
		'status'    => 'ok',
		'checks'    => [],
	];

	foreach ( factory_get_adapters() as $adapter ) {
		if ( ! method_exists( $adapter, 'validate' ) ) {
			continue;
		}

		$results = $adapter->validate( $blueprint );

		foreach ( $results as $line ) {
			$report['checks'][] = $line;

			if ( $line['status'] === 'error' ) {
				$report['status'] = 'error';
			}

			if ( ! $cli_output || ! defined( 'WP_CLI' ) || ! WP_CLI ) {
				continue;
			}

			if ( $line['status'] === 'ok' ) {
				WP_CLI::success( $line['message'] );
			} elseif ( $line['status'] === 'warning' ) {
				WP_CLI::warning( $line['message'] );
			} else {
				WP_CLI::error( $line['message'], false );
			}
		}
	}

	if ( ! is_dir( FACTORY_REPORTS_DIR ) ) {
		wp_mkdir_p( FACTORY_REPORTS_DIR );
	}

	$file_path = FACTORY_REPORTS_DIR . 'factory-report.json';

	file_put_contents(
		$file_path,
		json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE )
	);

	if ( $cli_output && defined( 'WP_CLI' ) && WP_CLI ) {
		WP_CLI::log( "Report saved: {$file_path}" );
	}

	return $report;
}

function factory_reset_diff_report(): Factory_Diff_Report {
	global $factory_diff_report;

	$factory_diff_report = new Factory_Diff_Report();

	return $factory_diff_report;
}

function factory_log_diff_report(): void {
	global $factory_diff_report;

	if ( $factory_diff_report instanceof Factory_Diff_Report ) {
		$factory_diff_report->output();
	}
}

	if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'factory fix', Factory_Fix_Command::class );
	WP_CLI::add_command( 'factory dry-run', Factory_Dry_Run_Command::class );
	WP_CLI::add_command( 'factory snapshot', Factory_Snapshot_Command::class );
	WP_CLI::add_command( 'factory rollback', Factory_Rollback_Command::class );
	WP_CLI::add_command(
		'factory runs',
		'Factory_Runs_Command'
	);
	WP_CLI::add_command(
		'factory run',
		'Factory_Run_Command'
	);
		WP_CLI::add_command(
		'factory status',
		Factory_Status_Command::class
	);
		WP_CLI::add_command(
		'factory doctor',
		Factory_Doctor_Command::class
	);
		WP_CLI::add_command(
		'factory health',
		Factory_Health_Command::class
	);
		WP_CLI::add_command(
		'factory latest',
		'Factory_Latest_Command'
	);
		WP_CLI::add_command(
		'factory explain',
		'Factory_Explain_Command'
	);
		WP_CLI::add_command(
		'factory summary',
		'Factory_Summary_Command'
	);
		WP_CLI::add_command(
		'factory commands',
		'Factory_Commands_Command'
	);
	WP_CLI::add_command(
		'factory adapters',
		Factory_Adapters_Command::class
	);

	WP_CLI::add_command( 'factory validate-blueprint', function ( $args ) {
	$path = $args[0] ?? '';

		if ( ! $path ) {
			WP_CLI::error( 'Provide blueprint path.' );
		}

		if ( ! file_exists( $path ) ) {
			WP_CLI::error( "Blueprint file not found: {$path}" );
		}

		$blueprint = json_decode( file_get_contents( $path ), true );

		if ( ! is_array( $blueprint ) ) {
			WP_CLI::error( 'Invalid blueprint JSON.' );
		}

		$validator = new Factory_Blueprint_Validator();
		$errors    = $validator->validate( $blueprint );

		if ( empty( $errors ) ) {
			WP_CLI::success( 'Blueprint contract is valid.' );
			return;
		}

		WP_CLI::warning( 'Blueprint contract validation failed:' );

		foreach ( $errors as $error ) {
			WP_CLI::log( "- {$error}" );
		}

	WP_CLI::error( 'Invalid blueprint contract.' );
	} );

	if ( factory_legacy_ai_blueprint_generator_enabled() ) {
		WP_CLI::add_command( 'factory ai', Factory_AI_Command::class );

		// Legacy developer-only generator exposure. Disabled by default.
		WP_CLI::add_command( 'factory generate', function () {
			try {
				$generator = new Factory_AI_Blueprint_Generator();

				$generator->generate();

				WP_CLI::success( 'Blueprint generated.' );
				WP_CLI::log( 'Saved to: ' . $generator->get_target_path() );
				WP_CLI::log( 'Next: wp factory apply ' . $generator->get_target_path() );
			} catch ( Throwable $e ) {
				WP_CLI::error( $e->getMessage() );
			}
		} );
	}

	// APPLY
	WP_CLI::add_command( 'factory apply', function ( $args ) {
		$path = $args[0] ?? FACTORY_BLUEPRINT_PATH;

		if ( ! file_exists( $path ) ) {
			WP_CLI::error( "Blueprint file not found: {$path}" );
		}

		$blueprint = json_decode( file_get_contents( $path ), true );

		if ( ! is_array( $blueprint ) ) {
			WP_CLI::error( 'Invalid blueprint JSON.' );
		}

		factory_reset_diff_report();

		$execution = factory_apply_blueprint( $blueprint );

		global $factory_diff_report;

		if ( isset( $factory_diff_report ) ) {
			$factory_diff_report->output();
		}

		$dry_run    = new Factory_Dry_Run_Command();
		$plan_items = $dry_run->get_plan_items( $blueprint );
		$summary    = [
			'create'  => 0,
			'update'  => 0,
			'skip'    => 0,
			'warning' => 0,
			'error'   => 0,
		];

		foreach ( $plan_items as $item ) {
			$action = $item['action'] ?? 'skip';

			if ( isset( $summary[ $action ] ) ) {
				$summary[ $action ]++;
			}
		}

		$plan = [
			'version' => 1,
			'summary' => $summary,
			'items'   => $plan_items,
		];

		$report = factory_validate_blueprint_state( $blueprint, true );

		$manifest_path = factory_save_run_manifest(
			"Manual apply: {$path}",
			null,
			$blueprint,
			$plan,
			$report,
			$report['status'] ?? 'error',
			$execution
		);

		WP_CLI::success(
			"Run manifest saved: {$manifest_path}"
		);

		WP_CLI::success( "Factory blueprint applied: {$path}" );
	} );

	// VALIDATE
	WP_CLI::add_command( 'factory validate', function () {
		$blueprint = factory_get_blueprint();

		$report = [
			'timestamp' => current_time( 'mysql' ),
			'status'    => 'ok',
			'checks'    => [],
		];

		foreach ( factory_get_adapters() as $adapter ) {
			if ( ! method_exists( $adapter, 'validate' ) ) {
				continue;
			}

			$results = $adapter->validate( $blueprint );

			foreach ( $results as $line ) {
				$report['checks'][] = $line;

				if ( $line['status'] === 'ok' ) {
					WP_CLI::success( $line['message'] );
				} elseif ( $line['status'] === 'warning' ) {
					WP_CLI::warning( $line['message'] );
				} else {
					WP_CLI::error( $line['message'], false );
					$report['status'] = 'error';
				}
			}
		}

		if ( ! is_dir( FACTORY_REPORTS_DIR ) ) {
			wp_mkdir_p( FACTORY_REPORTS_DIR );
		}

		$file_path = FACTORY_REPORTS_DIR . 'factory-report.json';

		file_put_contents(
			$file_path,
			json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE )
		);

		WP_CLI::log( "Report saved: {$file_path}" );
		WP_CLI::success( 'Validation complete.' );
	} );

	// RESET
	WP_CLI::add_command( 'factory reset', function () {
		$blueprint = factory_get_blueprint();

		foreach ( $blueprint['cpt'] ?? [] as $cpt ) {
			$posts = get_posts( [
				'post_type'   => $cpt['slug'],
				'post_status' => 'any',
				'numberposts' => -1,
			] );

			foreach ( $posts as $post ) {
				wp_delete_post( $post->ID, true );
				WP_CLI::log( "Deleted: {$post->post_title}" );
			}
		}

		delete_option( FACTORY_BLUEPRINT_OPTION );
		flush_rewrite_rules();

		WP_CLI::success( 'Factory reset complete.' );
	} );

	WP_CLI::add_command( 'factory preset', function ( $args ) {
		$preset = $args[0] ?? '';

		if ( ! $preset ) {
			WP_CLI::error( 'Provide preset slug.' );
		}

		try {
			$manager   = new Factory_Blueprint_Preset_Manager();
			$blueprint = $manager->load_preset( $preset );
			$path      = $manager->save_generated( $preset, $blueprint );

			WP_CLI::success( "Preset generated: {$preset}" );
			WP_CLI::log( "Saved to: {$path}" );
			WP_CLI::log( "Next: wp factory apply {$path}" );
		} catch ( Throwable $e ) {
			WP_CLI::error( $e->getMessage() );
		}
	} );

	if ( factory_legacy_ai_blueprint_generator_enabled() ) {
		WP_CLI::add_command( 'factory build', function ( $args ) {
			$prompt = $args[0] ?? '';

			if ( ! $prompt ) {
				WP_CLI::error( 'Provide prompt.' );
			}

			try {
				WP_CLI::log( 'Generating blueprint...' );

				$generator = new Factory_AI_Blueprint_Generator();
				$blueprint = $generator->generate_from_prompt( $prompt );

				if ( $generator->was_loaded_from_cache() ) {
					WP_CLI::log( 'Blueprint loaded from cache.' );
				} else {
					WP_CLI::log( 'Blueprint generated via AI and saved to cache.' );
				}

				WP_CLI::log( 'Applying blueprint...' );

				factory_reset_diff_report();

				factory_apply_blueprint( $blueprint );

				factory_log_diff_report();

				WP_CLI::log( 'Validating...' );

				$report = factory_validate_blueprint_state( $blueprint );

				if ( ( $report['status'] ?? 'error' ) === 'ok' ) {
					WP_CLI::success( 'Build complete. State is valid.' );
					return;
				}

				WP_CLI::warning( 'Validation failed. Running deterministic fix...' );

				foreach ( factory_get_adapters() as $adapter ) {
					$adapter->apply( $blueprint );
				}

				flush_rewrite_rules();

				WP_CLI::log( 'Re-validating after fix...' );

				$second_report = factory_validate_blueprint_state( $blueprint );

				if ( ( $second_report['status'] ?? 'error' ) === 'ok' ) {
					WP_CLI::success( 'Build complete after fix. State is valid.' );
					return;
				}

				WP_CLI::error( 'Build finished, but validation still has errors.' );

			} catch ( Throwable $e ) {
				WP_CLI::error( $e->getMessage() );
			}
		} );
	}
}
