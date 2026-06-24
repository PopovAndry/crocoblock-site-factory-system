<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_rest_routes' );

function factory_register_rest_routes(): void {
	$namespace = 'factory/v1';

	$routes = [
		'/validate' => [
			'methods'  => 'POST',
			'callback' => 'factory_rest_validate',
		],
		'/summary' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_summary',
		],
		'/doctor' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_doctor',
		],
		'/runs' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_runs',
		],
		'/run/latest' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_latest_run',
		],
		'/run/(?P<file>run-[^/]+\.json)' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_run',
		],
		'/explain/latest' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_explain_latest',
		],
		'/index' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_index',
		],
		'/adapters' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_adapters',
		],
		'/capabilities' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_capabilities',
		],
		'/preview-bridge' => [
			'methods'  => 'POST',
			'callback' => 'factory_rest_preview_bridge',
		],
		'/beta/real-estate/plan' => [
			'methods'  => [ 'GET', 'POST' ],
			'callback' => 'factory_rest_beta_real_estate_plan',
		],
		'/beta/real-estate/requirements' => [
			'methods'  => 'GET',
			'callback' => 'factory_rest_beta_real_estate_requirements',
		],
		'/beta/real-estate/apply' => [
			'methods'  => 'POST',
			'callback' => 'factory_rest_beta_real_estate_apply',
		],
	];

	foreach ( $routes as $route => $args ) {
		register_rest_route(
			$namespace,
			$route,
			[
				'methods'             => $args['methods'],
				'callback'            => $args['callback'],
				'permission_callback' => 'factory_rest_require_manage_options',
			]
		);
	}
}

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

	function factory_rest_preview_bridge( WP_REST_Request $request ) {
		$blueprint_result = factory_rest_get_preview_bridge_blueprint( $request );

		if ( is_wp_error( $blueprint_result ) ) {
			return $blueprint_result;
		}

		if ( ! function_exists( 'factory_build_plugin_preview_bridge_response' ) ) {
			return new WP_Error(
				'factory_preview_bridge_unavailable',
				'Plugin preview bridge service is unavailable.',
				[ 'status' => 500 ]
			);
		}

		$core_preview = $request->get_param( 'core_preview' );

		if ( ! is_array( $core_preview ) ) {
			$core_preview = [];
		}

		$ownership_targets = $request->get_param( 'ownership_targets' );

		if ( ! is_array( $ownership_targets ) ) {
			$ownership_targets = [];
		}

		try {
			return new WP_REST_Response(
				factory_build_plugin_preview_bridge_response(
					$blueprint_result,
					$core_preview,
					$ownership_targets
				)
			);
		} catch ( Throwable $e ) {
			return new WP_Error(
				'factory_preview_bridge_failed',
				$e->getMessage(),
				[ 'status' => 500 ]
			);
		}
	}

	function factory_rest_get_preview_bridge_blueprint( WP_REST_Request $request ) {
		$blueprint = $request->get_param( 'blueprint' );

		if ( null !== $blueprint ) {
			if ( ! is_array( $blueprint ) ) {
				return new WP_Error(
					'factory_preview_bridge_invalid_blueprint',
					'Preview bridge blueprint must be an object.',
					[ 'status' => 400 ]
				);
			}

			return $blueprint;
		}

		$preset = $request->get_param( 'preset' );
		$preset = is_string( $preset ) || is_numeric( $preset )
			? sanitize_key( (string) $preset )
			: 'real-estate';

		if ( '' === $preset ) {
			$preset = 'real-estate';
		}

		if ( 'real-estate' !== $preset ) {
			return new WP_Error(
				'factory_preview_bridge_invalid_preset',
				'Preview bridge supports the bundled real-estate preset only.',
				[ 'status' => 400 ]
			);
		}

		try {
			$blueprint = factory_rest_load_real_estate_blueprint();
		} catch ( Throwable $e ) {
			return new WP_Error(
				'factory_preview_bridge_preset_unavailable',
				$e->getMessage(),
				[ 'status' => 500 ]
			);
		}

		if ( empty( $blueprint ) ) {
			return new WP_Error(
				'factory_preview_bridge_empty_blueprint',
				'Preview bridge blueprint is empty.',
				[ 'status' => 400 ]
			);
		}

		return $blueprint;
	}

    function factory_rest_beta_real_estate_plan( WP_REST_Request $request ): WP_REST_Response {
        try {
            $base_blueprint = factory_rest_load_real_estate_blueprint();
            $prompt_context = factory_rest_get_real_estate_prompt_context( $request, $base_blueprint, 'Dashboard preview: real-estate' );
            $style_context = factory_rest_get_real_estate_style_context( $request );
            $image_context = factory_rest_get_real_estate_image_context( $request, $base_blueprint );
            $blueprint    = factory_rest_apply_real_estate_preset_variables( $base_blueprint, $prompt_context['applied_variables'] );
            $blueprint    = factory_rest_apply_real_estate_style_tokens( $blueprint, $style_context['tokens'] );
            $prompt       = $prompt_context['prompt'];
            $plan         = factory_rest_build_plan( $blueprint );
            $dependencies = factory_rest_get_real_estate_dependency_status();
            $product_plan = factory_rest_build_real_estate_product_plan( $blueprint, $plan, $dependencies, $prompt, $prompt_context, $style_context, $image_context );

            return new WP_REST_Response(
                [
                    'status'            => 'ok',
                    'preset'            => 'real-estate',
                    'prompt'            => $prompt,
                    'preset_variables'  => $prompt_context['preset_variables'],
                    'applied_variables' => $prompt_context['applied_variables'],
                    'prompt_notes'      => $prompt_context['notes'],
                    'style_context'     => $style_context['context'],
                    'style_tokens'      => $style_context['tokens'],
                    'image_context'     => $image_context['context'],
                    'image_notes'       => $image_context['notes'],
                    'plan'              => $plan,
                    'dependencies'      => $dependencies,
                    'product_plan'      => $product_plan,
                ]
            );
        } catch ( Throwable $e ) {
            return factory_rest_beta_error_response( $e->getMessage() );
        }
    }

    function factory_rest_beta_real_estate_requirements(): WP_REST_Response {
        $dependencies = factory_rest_get_real_estate_dependency_status();

        return new WP_REST_Response(
            factory_rest_build_real_estate_requirements_response( $dependencies )
        );
    }

    function factory_rest_beta_real_estate_apply( WP_REST_Request $request ): WP_REST_Response {
        try {
            $base_blueprint = factory_rest_load_real_estate_blueprint();
            $prompt_context = factory_rest_get_real_estate_prompt_context( $request, $base_blueprint, 'Dashboard apply: real-estate' );
            $style_context = factory_rest_get_real_estate_style_context( $request );
            $image_context = factory_rest_get_real_estate_image_context( $request, $base_blueprint );

            $result = factory_apply_real_estate_preset_internal(
                [
                    'source'         => 'beta_rest',
                    'base_blueprint' => $base_blueprint,
                    'prompt_context' => $prompt_context,
                    'style_context'  => $style_context,
                    'image_context'  => $image_context,
                ]
            );

            if ( empty( $result['ok'] ) ) {
                return factory_rest_beta_error_response(
                    $result['error_message'] ?? 'Real Estate apply failed.',
                    (int) ( $result['http_status'] ?? 500 ),
                    [
                        'dependencies' => $result['dependencies'] ?? [],
                    ]
                );
            }

            return new WP_REST_Response( $result['response'] ?? [] );
        } catch ( Throwable $e ) {
            return factory_rest_beta_error_response( $e->getMessage() );
        }
    }

    function factory_rest_load_real_estate_blueprint(): array {
        $manager = new Factory_Blueprint_Preset_Manager();

        return $manager->load_preset( 'real-estate' );
    }

    function factory_rest_get_beta_prompt( WP_REST_Request $request, string $fallback ): string {
        $prompt = $request->get_param( 'prompt' );

        if ( is_array( $prompt ) || is_object( $prompt ) ) {
            $prompt = '';
        }

        $prompt = is_string( $prompt ) || is_numeric( $prompt ) ? (string) $prompt : '';
        $prompt = function_exists( 'wp_unslash' ) ? wp_unslash( $prompt ) : $prompt;
        $prompt = function_exists( 'sanitize_textarea_field' )
            ? sanitize_textarea_field( $prompt )
            : trim( wp_strip_all_tags( $prompt ) );
        $prompt = trim( $prompt );

        return '' !== $prompt ? $prompt : $fallback;
    }

    function factory_rest_get_real_estate_prompt_context( WP_REST_Request $request, array $blueprint, string $fallback_prompt ): array {
        $defaults = factory_rest_get_real_estate_variable_defaults( $blueprint );
        $received = $request->get_param( 'preset_variables' );
        $allowed  = factory_rest_get_real_estate_variable_schema();
        $sanitized = [];
        $applied   = [];
        $notes     = [
            'Prepared Real Estate preset is used as the base.',
            'Only whitelisted copy fields are overlaid.',
            'No schema, filters, forms, property data, media, or page topology changes are applied.',
        ];

        if ( ! is_array( $received ) ) {
            $received = [];
        }

        foreach ( $received as $key => $value ) {
            if ( ! isset( $allowed[ $key ] ) ) {
                $notes[] = "Ignored unsupported preset variable: {$key}";
            }
        }

        foreach ( $allowed as $key => $schema ) {
            $default = $defaults[ $key ] ?? '';
            $value   = $received[ $key ] ?? '';
            $value   = factory_rest_sanitize_preset_variable( $value, $schema );

            if ( '' === $value ) {
                $value = $default;
                $notes[] = "Used preset default for {$key}.";
            }

            $sanitized[ $key ] = $value;
            $applied[ $key ]   = $value;
        }

        return [
            'prompt'            => factory_rest_get_beta_prompt( $request, $fallback_prompt ),
            'preset_variables'  => $sanitized,
            'applied_variables' => $applied,
            'notes'             => array_values( array_unique( $notes ) ),
        ];
    }

    function factory_rest_get_real_estate_variable_schema(): array {
        return [
            'agency_name'   => [
                'max'       => 80,
                'sanitizer' => 'text',
            ],
            'hero_title'    => [
                'max'       => 120,
                'sanitizer' => 'text',
            ],
            'hero_subtitle' => [
                'max'       => 240,
                'sanitizer' => 'textarea',
            ],
            'hero_cta_text' => [
                'max'       => 60,
                'sanitizer' => 'text',
            ],
            'contact_title' => [
                'max'       => 120,
                'sanitizer' => 'text',
            ],
            'contact_intro' => [
                'max'       => 400,
                'sanitizer' => 'textarea',
            ],
            'phone'         => [
                'max'       => 60,
                'sanitizer' => 'phone',
            ],
            'email'         => [
                'max'       => 120,
                'sanitizer' => 'email',
            ],
        ];
    }

    function factory_rest_get_real_estate_style_context( WP_REST_Request $request ): array {
        $received = $request->get_param( 'style_context' );

        if ( ! is_array( $received ) ) {
            $received = [];
        }

        $tones = [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ];
        $presets = [ 'turquoise', 'blue', 'green', 'beige', 'slate' ];
        $tone = sanitize_key( $received['tone'] ?? 'premium' );
        $primary_preset = sanitize_key( $received['primary_preset'] ?? 'turquoise' );
        $notes = [
            'Factory design tokens are deterministic; no AI palette generation is used.',
            'No Kava Customizer, Elementor Global Colors, typography, image, schema, filter, form, or layout changes are applied.',
        ];

        if ( ! in_array( $tone, $tones, true ) ) {
            $tone = 'premium';
            $notes[] = 'Used default style tone.';
        }

        if ( ! in_array( $primary_preset, $presets, true ) ) {
            $primary_preset = 'turquoise';
            $notes[] = 'Used default primary color preset.';
        }

        $context = [
            'tone'           => $tone,
            'primary_preset' => $primary_preset,
        ];

        return [
            'context' => $context,
            'tokens'  => factory_rest_derive_real_estate_style_tokens( $context ),
            'notes'   => array_values( array_unique( $notes ) ),
        ];
    }

    function factory_rest_derive_real_estate_style_tokens( array $context ): array {
        $primary_preset = $context['primary_preset'] ?? 'turquoise';
        $tone = $context['tone'] ?? 'premium';
        $palettes = [
            'turquoise' => [
                'primary'    => '#0f766e',
                'accent'     => '#14b8a6',
                'background' => '#ecfeff',
                'surface'    => '#ffffff',
                'text'       => '#10201d',
                'muted'      => '#52635f',
                'border'     => '#d7eee9',
                'link_hover' => '#0d9488',
            ],
            'blue' => [
                'primary'    => '#1d4ed8',
                'accent'     => '#38bdf8',
                'background' => '#eff6ff',
                'surface'    => '#ffffff',
                'text'       => '#102033',
                'muted'      => '#53657a',
                'border'     => '#dbeafe',
                'link_hover' => '#2563eb',
            ],
            'green' => [
                'primary'    => '#15803d',
                'accent'     => '#22c55e',
                'background' => '#f0fdf4',
                'surface'    => '#ffffff',
                'text'       => '#10251a',
                'muted'      => '#53665a',
                'border'     => '#dcfce7',
                'link_hover' => '#16a34a',
            ],
            'slate' => [
                'primary'    => '#334155',
                'accent'     => '#64748b',
                'background' => '#f8fafc',
                'surface'    => '#ffffff',
                'text'       => '#0f172a',
                'muted'      => '#475569',
                'border'     => '#e2e8f0',
                'link_hover' => '#1e293b',
            ],
            'beige' => [
                'primary'    => '#8a5a2b',
                'accent'     => '#d6a45f',
                'background' => '#fff7ed',
                'surface'    => '#ffffff',
                'text'       => '#2a2118',
                'muted'      => '#675d52',
                'border'     => '#f1dcc4',
                'link_hover' => '#a16207',
            ],
        ];
        $tone_overrides = [
            'premium' => [],
            'minimal' => [
                'background' => '#f8fafc',
                'border'     => '#e2e8f0',
                'muted'      => '#64748b',
            ],
            'modern' => [
                'surface' => '#ffffff',
            ],
            'corporate' => [
                'text'    => '#111827',
                'muted'   => '#4b5563',
                'surface' => '#ffffff',
            ],
            'warm' => [
                'background' => '#fff7ed',
                'surface'    => '#fffaf4',
                'border'     => '#f1dcc4',
            ],
        ];
        $tokens = array_merge(
            $palettes[ $primary_preset ] ?? $palettes['turquoise'],
            $tone_overrides[ $tone ] ?? []
        );

        $tokens['tone'] = $tone;
        $tokens['primary_preset'] = $primary_preset;
        $tokens['button'] = $tokens['accent'];
        $tokens['button_text'] = '#ffffff';
        $tokens['link'] = $tokens['primary'];
        $tokens['heading'] = $tokens['text'];

        return $tokens;
    }

    function factory_rest_get_real_estate_image_context( WP_REST_Request $request, array $blueprint ): array {
        $received = $request->get_param( 'image_context' );

        if ( ! is_array( $received ) ) {
            $received = [];
        }

        $source = sanitize_key( $received['source'] ?? 'demo_pool' );
        $mode = sanitize_key( $received['mode'] ?? 'round_robin' );
        $notes = [
            'Using bundled real estate image pools.',
            'Images are assigned as featured images for property cards and single pages.',
            'No uploads, Media Library picker, external image API, or AI image generation is used.',
        ];

        if ( 'demo_pool' !== $source ) {
            $source = 'demo_pool';
            $notes[] = 'Used default image source.';
        }

        if ( 'round_robin' !== $mode ) {
            $mode = 'round_robin';
            $notes[] = 'Used default image assignment mode.';
        }

        $pools = [];
        $asset_pools = $blueprint['site']['assets']['property_images'] ?? [];

        if ( is_array( $asset_pools ) ) {
            foreach ( $asset_pools as $type => $sources ) {
                if ( ! is_string( $type ) || '' === trim( $type ) ) {
                    continue;
                }

                $pools[ $type ] = is_array( $sources )
                    ? count(
                        array_filter(
                            $sources,
                            function ( $source_path ) {
                                return is_string( $source_path ) && '' !== trim( $source_path );
                            }
                        )
                    )
                    : ( is_string( $sources ) && '' !== trim( $sources ) ? 1 : 0 );
            }
        }

        return [
            'context' => [
                'source' => $source,
                'mode'   => $mode,
                'pools'  => $pools,
            ],
            'notes'   => array_values( array_unique( $notes ) ),
        ];
    }

    function factory_rest_sanitize_preset_variable( $value, array $schema ): string {
        if ( is_array( $value ) || is_object( $value ) ) {
            return '';
        }

        $value = is_string( $value ) || is_numeric( $value ) ? (string) $value : '';
        $value = function_exists( 'wp_unslash' ) ? wp_unslash( $value ) : $value;
        $sanitizer = $schema['sanitizer'] ?? 'text';

        if ( 'textarea' === $sanitizer && function_exists( 'sanitize_textarea_field' ) ) {
            $value = sanitize_textarea_field( $value );
        } elseif ( 'email' === $sanitizer ) {
            $value = function_exists( 'sanitize_email' ) ? sanitize_email( $value ) : sanitize_text_field( $value );
            $value = function_exists( 'is_email' ) && ! is_email( $value ) ? '' : $value;
        } elseif ( 'phone' === $sanitizer ) {
            $value = sanitize_text_field( $value );
            $value = preg_replace( '/[^0-9+().\-\s]/', '', $value );
        } else {
            $value = sanitize_text_field( $value );
        }

        $value = trim( $value );
        $max   = max( 1, (int) ( $schema['max'] ?? 120 ) );

        if ( function_exists( 'mb_substr' ) ) {
            return mb_substr( $value, 0, $max );
        }

        return substr( $value, 0, $max );
    }

    function factory_rest_get_real_estate_variable_defaults( array $blueprint ): array {
        $home         = is_array( $blueprint['pages']['home'] ?? null ) ? $blueprint['pages']['home'] : [];
        $contact      = is_array( $blueprint['pages']['contact'] ?? null ) ? $blueprint['pages']['contact'] : [];
        $hero_section = factory_rest_find_real_estate_home_section( $home, 'hero' );

        return [
            'agency_name'   => (string) ( $blueprint['site']['name'] ?? $home['title'] ?? 'Kyiv Turquoise Realty' ),
            'hero_title'    => (string) ( $hero_section['title'] ?? $home['title'] ?? 'Kyiv Turquoise Realty' ),
            'hero_subtitle' => (string) ( $hero_section['subtitle'] ?? 'Find apartments, houses, and commercial spaces in Kyiv' ),
            'hero_cta_text' => (string) ( $hero_section['cta_label'] ?? 'Browse properties' ),
            'contact_title' => (string) ( $contact['title'] ?? 'Contact Kyiv Turquoise Realty' ),
            'contact_intro' => (string) ( $contact['text'] ?? 'Schedule a viewing or request more details about Kyiv properties.' ),
            'phone'         => (string) ( $contact['phone'] ?? '+380 44 000 0000' ),
            'email'         => (string) ( $contact['email'] ?? $blueprint['site']['forms']['request_viewing']['fallback_email'] ?? 'hello@example.com' ),
        ];
    }

    function factory_rest_find_real_estate_home_section( array $home, string $type ): array {
        foreach ( $home['sections'] ?? [] as $section ) {
            if ( is_array( $section ) && $type === ( $section['type'] ?? '' ) ) {
                return $section;
            }
        }

        return [];
    }

    function factory_rest_apply_real_estate_preset_variables( array $blueprint, array $variables ): array {
        if ( isset( $variables['agency_name'] ) ) {
            $blueprint['site']['name'] = $variables['agency_name'];
            $blueprint['pages']['home']['title'] = $variables['agency_name'];
        }

        foreach ( $blueprint['pages']['home']['sections'] ?? [] as $index => $section ) {
            if ( ! is_array( $section ) || 'hero' !== ( $section['type'] ?? '' ) ) {
                continue;
            }

            if ( isset( $variables['hero_title'] ) ) {
                $blueprint['pages']['home']['sections'][ $index ]['title'] = $variables['hero_title'];
            }

            if ( isset( $variables['hero_subtitle'] ) ) {
                $blueprint['pages']['home']['sections'][ $index ]['subtitle'] = $variables['hero_subtitle'];
            }

            if ( isset( $variables['hero_cta_text'] ) ) {
                $blueprint['pages']['home']['sections'][ $index ]['cta_label'] = $variables['hero_cta_text'];
            }

            break;
        }

        if ( isset( $variables['contact_title'] ) ) {
            $blueprint['pages']['contact']['title'] = $variables['contact_title'];
        }

        if ( isset( $variables['contact_intro'] ) ) {
            $blueprint['pages']['contact']['text'] = $variables['contact_intro'];
        }

        if ( isset( $variables['phone'] ) ) {
            $blueprint['pages']['contact']['phone'] = $variables['phone'];
        }

        if ( isset( $variables['email'] ) ) {
            $blueprint['pages']['contact']['email'] = $variables['email'];
            $blueprint['site']['forms']['request_viewing']['fallback_email'] = $variables['email'];
        }

        return $blueprint;
    }

    function factory_rest_apply_real_estate_style_tokens( array $blueprint, array $tokens ): array {
        $blueprint['site']['style'] = array_merge(
            is_array( $blueprint['site']['style'] ?? null ) ? $blueprint['site']['style'] : [],
            $tokens
        );

        return $blueprint;
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

    function factory_rest_build_real_estate_product_plan(
        array $blueprint,
        array $plan,
        array $dependencies,
        string $prompt = '',
        array $prompt_context = [],
        array $style_context = [],
        array $image_context = []
    ): array {
        $property_count = isset( $blueprint['content']['property'] ) && is_array( $blueprint['content']['property'] )
            ? count( $blueprint['content']['property'] )
            : 0;

        $asset_pools = $blueprint['site']['assets']['property_images'] ?? [];
        $asset_labels = [];

        if ( is_array( $asset_pools ) ) {
            foreach ( $asset_pools as $type => $sources ) {
                if ( ! is_string( $type ) || '' === trim( $type ) ) {
                    continue;
                }

                $count = is_array( $sources ) ? count( $sources ) : ( is_string( $sources ) && '' !== trim( $sources ) ? 1 : 0 );
                $asset_labels[] = sprintf( '%s image pool (%d)', $type, $count );
            }
        }

        $summary = $plan['summary'] ?? [];
        $dependency_items = [];

        foreach ( [ 'jet_engine' => 'JetEngine', 'kava' => 'Kava theme' ] as $key => $label ) {
            $dependency = $dependencies[ $key ] ?? [];
            $active = ! empty( $dependency['active'] );
            $installed = ! empty( $dependency['installed'] );

            $dependency_items[] = $active
                ? "{$label} active"
                : ( $installed ? "{$label} installed but inactive" : "{$label} missing" );
        }

        $jetformbuilder = $dependencies['jetformbuilder'] ?? [];
        $dependency_items[] = ! empty( $jetformbuilder['available'] )
            ? 'JetFormBuilder available for Request Viewing form'
            : 'JetFormBuilder optional: Request Viewing fallback will be used';

        $dependency_status = ! empty( $dependencies['ready'] )
            ? 'ready'
            : 'warning';
        $applied_variables = is_array( $prompt_context['applied_variables'] ?? null )
            ? $prompt_context['applied_variables']
            : [];
        $prompt_notes = is_array( $prompt_context['notes'] ?? null )
            ? $prompt_context['notes']
            : [];
        $style = is_array( $style_context['context'] ?? null ) ? $style_context['context'] : [];
        $style_tokens = is_array( $style_context['tokens'] ?? null ) ? $style_context['tokens'] : [];
        $style_items = [
            'Tone: ' . ucwords( str_replace( '_', ' ', (string) ( $style['tone'] ?? 'premium' ) ) ),
            'Primary preset: ' . ucwords( str_replace( '_', ' ', (string) ( $style['primary_preset'] ?? 'turquoise' ) ) ),
        ];

        foreach ( [ 'primary', 'accent', 'background', 'surface', 'text', 'muted', 'border' ] as $token_key ) {
            if ( isset( $style_tokens[ $token_key ] ) ) {
                $style_items[] = "{$token_key}: {$style_tokens[ $token_key ]}";
            }
        }

        $image = is_array( $image_context['context'] ?? null ) ? $image_context['context'] : [];
        $image_pools = is_array( $image['pools'] ?? null ) ? $image['pools'] : [];
        $image_items = [
            'Included demo image pools',
            'Source: ' . ( $image['source'] ?? 'demo_pool' ),
            'Mode: ' . ( $image['mode'] ?? 'round_robin' ),
        ];

        if ( ! empty( $image_pools ) ) {
            foreach ( $image_pools as $pool_label => $pool_count ) {
                $image_items[] = sprintf( '%s image pool: %d', $pool_label, (int) $pool_count );
            }
        } elseif ( ! empty( $asset_labels ) ) {
            foreach ( $asset_labels as $asset_label ) {
                $image_items[] = $asset_label;
            }
        }

        $image_items = array_merge(
            $image_items,
            [
                'Will assign bundled images to property cards and single property pages',
                'Will not upload user images',
                'Will not generate AI images',
                'Will not use external image APIs',
            ],
            is_array( $image_context['notes'] ?? null ) ? $image_context['notes'] : []
        );

        $variable_items = [];

        foreach ( $applied_variables as $key => $value ) {
            $label = ucwords( str_replace( '_', ' ', (string) $key ) );
            $variable_items[] = "{$label}: {$value}";
        }

        return [
            'title'    => 'Real Estate Demo Plan',
            'mode'     => 'Prepared Real Estate preset with safe copy variables',
            'summary'  => 'Generate a Kyiv real estate website with catalog, properties, images, filters, single pages, contact page, and validation proof. The prompt is captured in the run manifest; only explicit safe copy variables are overlaid onto the prepared preset.',
            'sections' => [
                [
                    'label'  => 'Prompt context',
                    'status' => 'ready',
                    'items'  => [
                        '' !== $prompt ? "Captured prompt: {$prompt}" : 'No custom prompt supplied',
                        'Prompt is recorded for this beta run',
                        'Free-prose prompt parsing is not enabled in Prompt Testing v1',
                    ],
                ],
                [
                    'label'  => 'Applied safe variables',
                    'status' => 'ready',
                    'items'  => empty( $variable_items )
                        ? [ 'No safe preset variables supplied' ]
                        : array_merge(
                            $variable_items,
                            $prompt_notes
                        ),
                ],
                [
                    'label'  => 'Style tokens',
                    'status' => 'ready',
                    'items'  => array_merge(
                        $style_items,
                        [
                            'Will update generated Factory component colors',
                            'Will not change Kava Customizer colors, Elementor Global Colors, typography, images, schema, filters, forms, content, or layout',
                        ]
                    ),
                ],
                [
                    'label'  => 'Image source',
                    'status' => empty( $asset_labels ) ? 'warning' : 'ready',
                    'items'  => $image_items,
                ],
                [
                    'label'  => 'Guardrails',
                    'status' => 'ready',
                    'items'  => [
                        'No CPT, taxonomy, meta, filter, form, query, listing, media, or property content schema changes',
                        'No property count, district, taxonomy term, image, native filter, or form schema changes',
                        'Prepared Real Estate preset remains the deterministic base',
                    ],
                ],
                [
                    'label'  => 'Site structure',
                    'status' => 'ready',
                    'items'  => [
                        'Home page',
                        'Properties catalog',
                        'Contact page',
                        'Navigation menu',
                    ],
                ],
                [
                    'label'  => 'Data model',
                    'status' => 'ready',
                    'items'  => [
                        'Property CPT',
                        'Purpose taxonomy',
                        'Property Type taxonomy',
                        'District taxonomy',
                        'Price/address/bedrooms/bathrooms/size fields',
                    ],
                ],
                [
                    'label'  => 'Content',
                    'status' => 'ready',
                    'items'  => [
                        "{$property_count} Kyiv properties",
                        'Sale and rent listings',
                        'Apartment, house, and commercial types',
                    ],
                ],
                [
                    'label'  => 'Media',
                    'status' => empty( $asset_labels ) ? 'warning' : 'ready',
                    'items'  => empty( $asset_labels )
                        ? [ 'Property image pools not configured' ]
                        : $asset_labels,
                ],
                [
                    'label'  => 'Frontend features',
                    'status' => 'ready',
                    'items'  => [
                        'Catalog cards',
                        'GET filters',
                        'Single property pages',
                        'Contact agency CTA',
                        'Request Viewing fallback/form section',
                    ],
                ],
                [
                    'label'  => 'Dependencies',
                    'status' => $dependency_status,
                    'items'  => $dependency_items,
                ],
                [
                    'label'  => 'Proof',
                    'status' => 'ready',
                    'items'  => [
                        'Execution trace',
                        'Validation checks',
                        'Run manifest',
                        sprintf(
                            'Current dry-run: %d create / %d update / %d unchanged',
                            (int) ( $summary['create'] ?? 0 ),
                            (int) ( $summary['update'] ?? 0 ),
                            (int) ( $summary['skip'] ?? 0 )
                        ),
                    ],
                ],
            ],
        ];
    }

    function factory_rest_get_real_estate_dependency_status(): array {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $plugins              = function_exists( 'get_plugins' ) ? get_plugins() : [];
        $jetengine_installed  = false;
        $jetengine_active     = false;
        $jfb_installed        = false;
        $jfb_active           = false;
        $jsf_installed        = false;
        $jsf_active           = false;
        $kava_theme           = wp_get_theme( 'kava' );
        $kava_installed       = $kava_theme && $kava_theme->exists();
        $current_theme        = wp_get_theme();
        $kava_active          = $current_theme && 'kava' === $current_theme->get_stylesheet();

        foreach ( $plugins as $file => $data ) {
            if ( str_starts_with( $file, 'jet-engine/' ) ) {
                $jetengine_installed = true;

                if ( function_exists( 'is_plugin_active' ) && is_plugin_active( $file ) ) {
                    $jetengine_active = true;
                }
            }

            if ( 'jet-form-builder/jet-form-builder.php' === $file || str_starts_with( $file, 'jet-form-builder/' ) ) {
                $jfb_installed = true;

                if ( function_exists( 'is_plugin_active' ) && is_plugin_active( $file ) ) {
                    $jfb_active = true;
                }
            }

            if ( 'jet-smart-filters/jet-smart-filters.php' === $file || str_starts_with( $file, 'jet-smart-filters/' ) ) {
                $jsf_installed = true;

                if ( function_exists( 'is_plugin_active' ) && is_plugin_active( $file ) ) {
                    $jsf_active = true;
                }
            }
        }

        $jfb_available = $jfb_active
            || function_exists( 'jet_form_builder' )
            || defined( 'JET_FORM_BUILDER_VERSION' );

        if ( $jfb_available && function_exists( 'post_type_exists' ) ) {
            $jfb_available = post_type_exists( 'jet-form-builder' );
        }

        $jsf_available = $jsf_active
            || function_exists( 'jet_smart_filters' )
            || '' !== (string) get_option( 'jet_smart_filters_version', '' );

        if ( $jsf_available && function_exists( 'post_type_exists' ) ) {
            $jsf_available = post_type_exists( 'jet-smart-filters' );
        }

        return [
            'ready'      => $jetengine_active && $kava_active,
            'jet_engine' => [
                'installed' => $jetengine_installed,
                'active'    => $jetengine_active,
                'status'    => $jetengine_active ? 'ok' : ( $jetengine_installed ? 'warning' : 'error' ),
            ],
            'kava'       => [
                'installed' => $kava_installed,
                'active'    => $kava_active,
                'status'    => $kava_active ? 'ok' : ( $kava_installed ? 'warning' : 'error' ),
            ],
            'jetformbuilder' => [
                'installed' => $jfb_installed,
                'active'    => $jfb_active,
                'available' => $jfb_available,
                'optional'  => true,
                'status'    => $jfb_available ? 'ok' : 'warning',
                'fallback'  => ! $jfb_available,
            ],
            'jetsmartfilters' => [
                'installed' => $jsf_installed,
                'active'    => $jsf_active,
                'available' => $jsf_available,
                'optional'  => true,
                'status'    => $jsf_available ? 'ok' : 'warning',
                'fallback'  => ! $jsf_available,
            ],
        ];
    }

    function factory_rest_build_real_estate_requirements_response( array $dependencies ): array {
        $items = [
            factory_rest_requirement_item(
                'kava',
                'Kava theme',
                true,
                $dependencies['kava'] ?? [],
                'Kava theme is active.',
                'Kava theme must be active before generation.'
            ),
            factory_rest_requirement_item(
                'jet_engine',
                'JetEngine',
                true,
                $dependencies['jet_engine'] ?? [],
                'JetEngine is active.',
                'JetEngine must be active before generation.'
            ),
            factory_rest_requirement_item(
                'jetsmartfilters',
                'JetSmartFilters',
                false,
                $dependencies['jetsmartfilters'] ?? [],
                'Native filters proof is available.',
                'Stable /properties/ catalog still works. Native filters proof requires JetSmartFilters.'
            ),
            factory_rest_requirement_item(
                'jetformbuilder',
                'JetFormBuilder',
                false,
                $dependencies['jetformbuilder'] ?? [],
                'Request Viewing form enhancements are available.',
                'Request Viewing form enhancements require JetFormBuilder.'
            ),
        ];
        $ready = ! empty( $dependencies['ready'] );
        $optional_missing = false;

        foreach ( $items as $item ) {
            if ( empty( $item['required'] ) && 'optional_missing' === $item['status'] ) {
                $optional_missing = true;
                break;
            }
        }

        $summary = 'Ready to generate.';

        if ( ! $ready ) {
            $summary = 'Required setup needed before generation.';
        } elseif ( $optional_missing ) {
            $summary = 'Ready to generate. Optional enhancements unavailable.';
        }

        return [
            'status'  => 'ok',
            'ready'   => $ready,
            'summary' => $summary,
            'items'   => $items,
        ];
    }

    function factory_rest_requirement_item(
        string $key,
        string $label,
        bool $required,
        array $dependency,
        string $active_message,
        string $missing_message
    ): array {
        $installed = ! empty( $dependency['installed'] );
        $active = ! empty( $dependency['active'] ) || ! empty( $dependency['available'] );
        $status = 'unknown';
        $message = "{$label} status is unknown.";

        if ( $active ) {
            $status = 'active';
            $message = $active_message;
        } elseif ( $installed ) {
            $status = 'inactive';
            $message = "{$label} is installed but inactive.";
        } elseif ( $required ) {
            $status = 'missing';
            $message = $missing_message;
        } else {
            $status = 'optional_missing';
            $message = $missing_message;
        }

        return [
            'key'       => $key,
            'label'     => $label,
            'required'  => $required,
            'installed' => $installed,
            'active'    => $active,
            'status'    => $status,
            'message'   => $message,
        ];
    }

    function factory_rest_beta_error_response( string $message, int $status = 500, array $extra = [] ): WP_REST_Response {
        return new WP_REST_Response(
            array_merge(
                [
                    'status'  => 'error',
                    'message' => $message,
                ],
                $extra
            ),
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

if ( did_action( 'rest_api_init' ) ) {
	factory_register_rest_routes();
}
