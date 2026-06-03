<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'rest_api_init',
	static function () {

            register_rest_route(
            'factory/v1',
            '/validate',
            [
                'methods'             => 'POST',
                'callback'            => 'factory_rest_validate',
                'permission_callback' => '__return_true',
            ]
        );

		register_rest_route(
			'factory/v1',
			'/summary',
			[
				'methods'             => 'GET',
				'callback'            => 'factory_rest_summary',
				'permission_callback' => '__return_true',
			]
		);

		register_rest_route(
			'factory/v1',
			'/doctor',
			[
				'methods'             => 'GET',
				'callback'            => 'factory_rest_doctor',
				'permission_callback' => '__return_true',
			]
		);

		register_rest_route(
			'factory/v1',
			'/runs',
			[
				'methods'             => 'GET',
				'callback'            => 'factory_rest_runs',
				'permission_callback' => '__return_true',
			]
		);
            register_rest_route(
            'factory/v1',
            '/run/latest',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_latest_run',
                'permission_callback' => '__return_true',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/run/(?P<file>run-[^/]+\.json)',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_run',
                'permission_callback' => '__return_true',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/explain/latest',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_explain_latest',
                'permission_callback' => '__return_true',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/index',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_index',
                'permission_callback' => '__return_true',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/adapters',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_adapters',
                'permission_callback' => '__return_true',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/capabilities',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_capabilities',
                'permission_callback' => '__return_true',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/beta/real-estate/plan',
            [
                'methods'             => 'GET',
                'callback'            => 'factory_rest_beta_real_estate_plan',
                'permission_callback' => 'factory_rest_require_manage_options',
            ]
        );
        register_rest_route(
            'factory/v1',
            '/beta/real-estate/apply',
            [
                'methods'             => 'POST',
                'callback'            => 'factory_rest_beta_real_estate_apply',
                'permission_callback' => 'factory_rest_require_manage_options',
            ]
        );
	}
);

    function factory_rest_require_manage_options(): bool {
        return current_user_can( 'manage_options' );
    }

    function factory_rest_validate(): WP_REST_Response {

        $latest = factory_get_latest_run_name();

        if ( ! $latest ) {

            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'No runs found.',
                ],
                404
            );
        }

        $run = factory_get_run_manifest( $latest );

        if ( ! is_array( $run ) ) {

            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'Invalid run manifest.',
                ],
                500
            );
        }

        $blueprint =
            $run['blueprint'] ?? [];

        $result =
            factory_validate_blueprint_state(
                $blueprint,
                false
            );

        return new WP_REST_Response(
            [
                'status' => $result['status'] ?? 'error',
                'checks' => $result['checks'] ?? [],
            ]
        );
    }

    function factory_rest_capabilities(): WP_REST_Response {
        $registry = new Factory_Adapter_Registry();
        $adapters = $registry->get_contract_report();

        return new WP_REST_Response(
            [
                'version' => '1.0',

                'ai'      => true,
                'docker'  => true,
                'wp_cli'  => true,

                'presets' => [
                    'job-board',
                    'real-estate',
                ],

                'commands' => [
                    'ai',
                    'apply',
                    'validate',
                    'fix',
                    'doctor',
                    'summary',
                    'runs',
                    'latest',
                    'run',
                    'explain',
                    'reset',
                ],

                'adapter_contract_ready' => factory_rest_adapters_contract_ready( $adapters ),

                'adapters' => [
                    'plugins',
                    'theme',
                    'taxonomy',
                    'wp_core',
                    'jetengine',
                    'listing',
                    'render',
                    'single',
                    'content',
                ],
            ]
        );
    }

    function factory_rest_adapters(): WP_REST_Response {
        $registry = new Factory_Adapter_Registry();

        return new WP_REST_Response(
            [
                'status'   => 'ok',
                'adapters' => $registry->get_contract_report(),
            ]
        );
    }

    function factory_rest_adapters_contract_ready( array $adapters ): bool {
        foreach ( $adapters as $adapter ) {
            if ( empty( $adapter['contract_ready'] ) ) {
                return false;
            }
        }

        return true;
    }

    function factory_rest_beta_real_estate_plan(): WP_REST_Response {
        try {
            $blueprint = factory_rest_load_real_estate_blueprint();
            $plan      = factory_rest_build_plan( $blueprint );

            return new WP_REST_Response(
                [
                    'status' => 'ok',
                    'preset' => 'real-estate',
                    'plan'   => $plan,
                ]
            );
        } catch ( Throwable $e ) {
            return factory_rest_beta_error_response( $e->getMessage() );
        }
    }

    function factory_rest_beta_real_estate_apply(): WP_REST_Response {
        try {
            $blueprint = factory_rest_load_real_estate_blueprint();

            if ( function_exists( 'factory_reset_diff_report' ) ) {
                factory_reset_diff_report();
            }

            $execution = factory_apply_blueprint( $blueprint );
            $plan      = factory_rest_build_plan( $blueprint );
            $report    = factory_validate_blueprint_state( $blueprint, false );

            $manifest_path = factory_save_run_manifest(
                'Dashboard apply: real-estate',
                'real-estate',
                $blueprint,
                $plan,
                $report,
                $report['status'] ?? 'error',
                $execution
            );

            $results = function_exists( 'factory_build_manifest_results' )
                ? factory_build_manifest_results( $report )
                : [
                    'summary' => [
                        'ok'      => 0,
                        'warning' => 0,
                        'error'   => 0,
                    ],
                ];

            return new WP_REST_Response(
                [
                    'status'           => $report['status'] ?? 'error',
                    'message'          => 'Real Estate preset applied.',
                    'preset'           => 'real-estate',
                    'file'             => basename( $manifest_path ),
                    'plan_summary'     => $plan['summary'] ?? [],
                    'execution_count'  => count( $execution ),
                    'validation_count' => count( $report['checks'] ?? [] ),
                    'results_summary'  => $results['summary'] ?? [],
                ]
            );
        } catch ( Throwable $e ) {
            return factory_rest_beta_error_response( $e->getMessage() );
        }
    }

    function factory_rest_load_real_estate_blueprint(): array {
        $manager = new Factory_Blueprint_Preset_Manager();

        return $manager->load_preset( 'real-estate' );
    }

    function factory_rest_build_plan( array $blueprint ): array {
        $dry_run = new Factory_Dry_Run_Command();
        $items   = $dry_run->get_plan_items( $blueprint );

        return [
            'version' => 1,
            'summary' => factory_rest_plan_summary( $items ),
            'items'   => $items,
        ];
    }

    function factory_rest_plan_summary( array $items ): array {
        $summary = [
            'create'  => 0,
            'update'  => 0,
            'skip'    => 0,
            'warning' => 0,
            'error'   => 0,
        ];

        foreach ( $items as $item ) {
            $action = $item['action'] ?? 'skip';

            if ( isset( $summary[ $action ] ) ) {
                $summary[ $action ]++;
            }
        }

        return $summary;
    }

    function factory_rest_beta_error_response( string $message, int $status = 500 ): WP_REST_Response {
        return new WP_REST_Response(
            [
                'status'  => 'error',
                'message' => $message,
            ],
            $status
        );
    }

    function factory_rest_index(): WP_REST_Response {

        return new WP_REST_Response(
            [
                'name'        => 'Crocoblock Site Factory API',
                'version'     => '1.0',
                'status'      => 'active',
                'endpoints'   => [
                '/summary',
                '/doctor',
                '/runs',
                '/run/latest',
                '/run/{file}',
                '/explain/latest',
                '/index',
                '/capabilities',
                '/adapters',
                '/beta/real-estate/plan',
                '/beta/real-estate/apply',
                ],
                'description' => 'Runtime inspection and orchestration API for Factory.',
            ]
        );
    }

    function factory_rest_explain_latest(): WP_REST_Response {

        $latest = factory_get_latest_run_name();

        if ( ! $latest ) {
            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'No runs found.',
                ],
                404
            );
        }

        $run = factory_get_run_manifest( $latest );

        if ( ! is_array( $run ) ) {
            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'Invalid run manifest.',
                ],
                500
            );
        }

        $blueprint = $run['blueprint'] ?? [];

        $response = [
            'site'         => $blueprint['site']['name'] ?? '',
            'cpt'          => [],
            'taxonomies'   => [],
            'listings'     => [],
            'archive'      => '',
            'demo_content' => [],
        ];

        foreach ( $blueprint['cpt'] ?? [] as $cpt ) {

            $response['cpt'][] = [
                'slug' => $cpt['slug'] ?? '',
                'meta' => array_map(
                    static fn( $field ) => $field['key'] ?? '',
                    $cpt['meta'] ?? []
                ),
            ];
        }

        foreach ( $blueprint['taxonomies'] ?? [] as $taxonomy ) {

            $response['taxonomies'][] =
                $taxonomy['slug'] ?? '';
        }

        foreach ( $blueprint['listings'] ?? [] as $listing ) {

            $response['listings'][] =
                $listing['title'] ?? '';
        }

        $archive =
            $blueprint['pages']['archive']['slug']
            ?? '';

        if ( $archive ) {
            $response['archive'] =
                '/' . trim( $archive, '/' ) . '/';
        }

        foreach (
            $blueprint['content'] ?? []
            as $items
        ) {

            foreach ( $items as $item ) {

                $response['demo_content'][] =
                    $item['title'] ?? '';
            }
        }

        return new WP_REST_Response( $response );
    }

function factory_rest_summary(): WP_REST_Response {

	$latest = factory_get_latest_run_name();

	if ( ! $latest ) {
		return new WP_REST_Response(
			[
				'status'  => 'error',
				'message' => 'No runs found.',
			],
			404
		);
	}

	$run = factory_get_run_manifest( $latest );

	if ( ! is_array( $run ) ) {
		return new WP_REST_Response(
			[
				'status'  => 'error',
				'message' => 'Invalid run manifest.',
			],
			500
		);
	}

	$blueprint = $run['blueprint'] ?? [];

	$current = factory_validate_blueprint_state(
		$blueprint,
		false
	);

	$state = ( $current['status'] ?? 'error' ) === 'ok'
		? 'IN SYNC'
		: 'DRIFT';

	$cpt_count = count( $blueprint['cpt'] ?? [] );

	$taxonomy_count = count(
		$blueprint['taxonomies'] ?? []
	);

	$listing_count = count(
		$blueprint['listings'] ?? []
	);

	$content_count = 0;

	foreach ( $blueprint['content'] ?? [] as $items ) {
		if ( is_array( $items ) ) {
			$content_count += count( $items );
		}
	}

	return new WP_REST_Response(
		[
			'status'         => $state,
			'latest_run'     => $latest,
			'site'           => $blueprint['site']['name'] ?? '-',
			'cpt_count'      => $cpt_count,
			'taxonomy_count' => $taxonomy_count,
			'listing_count'  => $listing_count,
			'content_count'  => $content_count,
			'doctor'         => $state === 'IN SYNC'
				? 'healthy'
				: 'issues detected',
		]
	);
}

function factory_rest_doctor(): WP_REST_Response {

	$latest = factory_get_latest_run_name();

	if ( ! $latest ) {
		return new WP_REST_Response(
			[
				'status'  => 'error',
				'message' => 'No runs found.',
			],
			404
		);
	}

	$run = factory_get_run_manifest( $latest );

	if ( ! is_array( $run ) ) {
		return new WP_REST_Response(
			[
				'status'  => 'error',
				'message' => 'Invalid run manifest.',
			],
			500
		);
	}

	$blueprint = $run['blueprint'] ?? [];

	$current = factory_validate_blueprint_state(
		$blueprint,
		false
	);

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

	return new WP_REST_Response(
		[
			'status'     => $current['status'] ?? 'error',
			'latest_run' => $latest,
			'prompt'     => $run['prompt'] ?? '',
			'issues'     => $issues,
		]
	);
}

    function factory_rest_latest_run(): WP_REST_Response {

        $latest = factory_get_latest_run_name();

        if ( ! $latest ) {
            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'No runs found.',
                ],
                404
            );
        }

        $run = factory_get_run_manifest( $latest );

        if ( ! is_array( $run ) ) {
            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'Invalid run manifest.',
                ],
                500
            );
        }

        return new WP_REST_Response(
            [
                'status' => 'ok',
                'run'    => factory_rest_enrich_run_manifest( $run, $latest ),
            ]
        );
    }

    function factory_rest_run( WP_REST_Request $request ): WP_REST_Response {

        $file = (string) $request->get_param( 'file' );

        if ( ! factory_rest_is_safe_run_file( $file ) ) {
            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'Invalid run file.',
                ],
                400
            );
        }

        $run = factory_get_run_manifest( $file );

        if ( ! is_array( $run ) ) {
            return new WP_REST_Response(
                [
                    'status'  => 'error',
                    'message' => 'Run file not found or invalid.',
                ],
                404
            );
        }

        return new WP_REST_Response(
            [
                'status' => 'ok',
                'run'    => factory_rest_enrich_run_manifest( $run, $file ),
            ]
        );
    }

    function factory_rest_is_safe_run_file( string $file ): bool {
        if ( '' === $file ) {
            return false;
        }

        if (
            str_contains( $file, '/' ) ||
            str_contains( $file, '\\' ) ||
            str_contains( $file, '..' )
        ) {
            return false;
        }

        if ( basename( $file ) !== $file ) {
            return false;
        }

        return 1 === preg_match( '/^run-[A-Za-z0-9_.-]+\.json$/', $file );
    }

    function factory_rest_enrich_run_manifest( array $run, string $file ): array {
        $run['file'] = $file;

        if ( ! isset( $run['plan'] ) || ! is_array( $run['plan'] ) ) {
            $run['plan'] = [];
        }

        if ( ! isset( $run['plan']['version'] ) || null === $run['plan']['version'] ) {
            $run['plan']['version'] = 1;
        }

        if ( ! isset( $run['plan']['summary'] ) || ! is_array( $run['plan']['summary'] ) ) {
            $run['plan']['summary'] = [];
        }

        if ( ! isset( $run['plan']['items'] ) || ! is_array( $run['plan']['items'] ) ) {
            $run['plan']['items'] = [];
        }

        if ( ! isset( $run['execution'] ) || ! is_array( $run['execution'] ) ) {
            $run['execution'] = [];
        }

        if ( ! isset( $run['execution']['version'] ) || null === $run['execution']['version'] ) {
            $run['execution']['version'] = 1;
        }

        if ( ! isset( $run['execution']['items'] ) || ! is_array( $run['execution']['items'] ) ) {
            $run['execution']['items'] = [];
        }

        $run['execution']['count'] = count( $run['execution']['items'] );

        if ( ! isset( $run['results'] ) || ! is_array( $run['results'] ) ) {
            $run['results'] = [];
        }

        if ( ! isset( $run['results']['version'] ) || null === $run['results']['version'] ) {
            $run['results']['version'] = 1;
        }

        if ( ! isset( $run['results']['source'] ) || null === $run['results']['source'] ) {
            $run['results']['source'] = '';
        }

        if ( ! isset( $run['results']['summary'] ) || ! is_array( $run['results']['summary'] ) ) {
            $run['results']['summary'] = [];
        }

        if ( ! isset( $run['results']['items'] ) || ! is_array( $run['results']['items'] ) ) {
            $run['results']['items'] = [];
        }

        if ( ! isset( $run['validation'] ) || ! is_array( $run['validation'] ) ) {
            $run['validation'] = [];
        }

        if ( ! isset( $run['validation']['status'] ) || null === $run['validation']['status'] ) {
            $run['validation']['status'] = '';
        }

        if ( ! isset( $run['validation']['checks'] ) || ! is_array( $run['validation']['checks'] ) ) {
            $run['validation']['checks'] = [];
        }

        $run['validation']['count'] = count( $run['validation']['checks'] );

        return $run;
    }

function factory_rest_runs( WP_REST_Request $request ): WP_REST_Response {

	$registry = factory_get_runs_registry();

	if ( empty( $registry ) ) {
		return new WP_REST_Response(
			[
				'status'  => 'error',
				'message' => 'Run registry not found.',
				'runs'    => [],
			],
			404
		);
	}

	$runs = $registry['runs'] ?? [];

	if ( $request->get_param( 'latest' ) ) {
		$latest = $registry['latest'] ?? '';

		$runs = array_values(
			array_filter(
				$runs,
				static fn( $run ) => ( $run['file'] ?? '' ) === $latest
			)
		);
	}

	if ( $request->get_param( 'failed' ) ) {
		$runs = array_values(
			array_filter(
				$runs,
				static fn( $run ) => ( $run['status'] ?? '' ) !== 'ok'
			)
		);
	}

	$limit = (int) $request->get_param( 'limit' );

	if ( $limit > 0 ) {
		$runs = array_slice(
			$runs,
			0,
			$limit
		);
	}

	$rows = [];

	foreach ( $runs as $run ) {
		$plan_summary = $run['plan_summary'] ?? [];

		if ( ! is_array( $plan_summary ) ) {
			$plan_summary = [];
		}

		$results_summary = $run['results_summary'] ?? [];

		if ( ! is_array( $results_summary ) ) {
			$results_summary = [];
		}

		$rows[] = [
			'file'             => $run['file'] ?? '',
			'timestamp'        => $run['timestamp'] ?? '',
			'status'           => $run['status'] ?? '',
			'preset'           => $run['preset'] ?? '',
			'prompt'           => $run['prompt'] ?? '',
			'plan_summary'     => $plan_summary,
			'execution_count'  => isset( $run['execution_count'] ) ? (int) $run['execution_count'] : 0,
			'validation_count' => isset( $run['validation_count'] ) ? (int) $run['validation_count'] : 0,
			'results_summary'  => $results_summary,
		];
	}

	return new WP_REST_Response(
		[
			'status' => 'ok',
			'latest' => $registry['latest'] ?? null,
			'runs'   => $rows,
		]
	);
}
