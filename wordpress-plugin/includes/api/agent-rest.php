<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_agent_rest_routes' );
add_filter( 'wp_is_application_passwords_available', 'factory_rest_agent_enable_local_application_passwords' );

function factory_rest_agent_enable_local_application_passwords( $available ) {
	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	$host = is_string( $host ) ? strtolower( $host ) : '';

	if ( in_array( $host, [ '127.0.0.1', 'localhost' ], true ) ) {
		return true;
	}

	return $available;
}

function factory_register_agent_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/agent/health',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_agent_health',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/capabilities',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_agent_capabilities',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);

	register_rest_route(
		'factory/v1',
		'/agent/dependencies',
		[
			'methods'             => 'GET',
			'callback'            => 'factory_rest_agent_dependencies',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_agent_health(): WP_REST_Response {
	$theme = wp_get_theme();
	$latest_run = function_exists( 'factory_get_latest_run_name' ) ? factory_get_latest_run_name() : null;
	$stored_blueprint = defined( 'FACTORY_BLUEPRINT_OPTION' ) ? get_option( FACTORY_BLUEPRINT_OPTION ) : null;
	$generated_site_present = null;

	if ( is_array( $stored_blueprint ) ) {
		$generated_site_present = ! empty( $stored_blueprint );
	} elseif ( null !== $latest_run ) {
		$generated_site_present = true;
	}

	return new WP_REST_Response(
		[
			'status'                 => 'ok',
			'code'                   => 'agent_ready',
			'plugin_slug'            => 'crocoblock-site-factory',
			'plugin_version'         => defined( 'FACTORY_PLUGIN_VERSION' ) ? FACTORY_PLUGIN_VERSION : null,
			'wp_version'             => get_bloginfo( 'version' ),
			'php_version'            => PHP_VERSION,
			'site_url'               => site_url(),
			'home_url'               => home_url(),
			'active_theme'           => $theme instanceof WP_Theme ? $theme->get_stylesheet() : null,
			'rest_namespace'         => 'factory/v1',
			'generated_site_present' => $generated_site_present,
			'last_run_id'            => $latest_run,
			'auth_mode'              => 'wp_application_password_or_admin_context_alpha',
		]
	);
}

function factory_rest_agent_capabilities(): WP_REST_Response {
	$fields = function_exists( 'factory_frontend_safe_edit_mutable_save_fields' )
		? factory_frontend_safe_edit_mutable_save_fields()
		: [ 'hero_title', 'hero_subtitle', 'hero_cta_text', 'hero_cta_destination' ];

	return new WP_REST_Response(
		[
			'status'                    => 'ok',
			'code'                      => 'agent_capabilities_ready',
			'capabilities'              => [
				'dependency_status'  => true,
				'ai_read_only_chain' => true,
				'controlled_generate' => true,
				'frontend_safe_edit' => true,
				'proof_manifest'     => true,
				'rollback_alpha'     => false,
			],
			'frontend_safe_edit_fields' => array_values( $fields ),
			'supported_verticals'       => [ 'real_estate' ],
		]
	);
}

function factory_rest_agent_dependencies(): WP_REST_Response {
	$dependencies = factory_rest_agent_dependency_items( 'real_estate' );
	$blockers = [];

	foreach ( $dependencies as $dependency ) {
		if ( ! empty( $dependency['blocking'] ) ) {
			$blockers[] = $dependency['name'] . ': ' . ( $dependency['notes'] ?: 'Required dependency is not ready.' );
		}
	}

	return new WP_REST_Response(
		[
			'status'     => 'ok',
			'code'       => 'dependencies_ready',
			'site_type'  => 'real_estate',
			'dependencies' => $dependencies,
			'blockers'   => array_values( $blockers ),
			'can_generate' => empty( $blockers ),
		]
	);
}

function factory_rest_agent_dependency_items( string $site_type ): array {
	if ( ! function_exists( 'get_plugins' ) || ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$definitions = function_exists( 'factory_console_dependency_definitions' )
		? factory_console_dependency_definitions()
		: [];
	$capability_model = function_exists( 'factory_console_dependency_capability_model' )
		? factory_console_dependency_capability_model()
		: [
			'site_type_capabilities' => [
				'real_estate' => [ 'real_estate_catalog', 'property_filters' ],
			],
		];
	$required_capabilities = array_values( $capability_model['site_type_capabilities'][ $site_type ] ?? [] );
	$dependencies = [];

	foreach ( $definitions as $definition ) {
		if ( 'jet-plugins-wizard' === (string) ( $definition['slug'] ?? '' ) ) {
			continue;
		}

		$item = 'theme' === ( $definition['type'] ?? '' )
			? factory_console_theme_dependency_status( $definition )
			: factory_console_plugin_dependency_status( $definition );
		$capabilities = function_exists( 'factory_console_dependency_capabilities' )
			? factory_console_dependency_capabilities( (string) $item['slug'] )
			: [];
		$capability = isset( $capabilities[0] ) ? (string) $capabilities[0] : '';
		$required = ! empty( array_intersect( $required_capabilities, $capabilities ) );
		$status = (string) ( $item['status'] ?? 'missing' );

		$dependencies[] = [
			'slug'            => (string) ( $item['slug'] ?? '' ),
			'name'            => (string) ( $item['name'] ?? '' ),
			'type'            => (string) ( $item['type'] ?? 'plugin' ),
			'required'        => $required,
			'capability'      => $capability ?: null,
			'installed'       => ! empty( $item['installed'] ),
			'active'          => ! empty( $item['active'] ),
			'version'         => isset( $item['version'] ) ? (string) $item['version'] : null,
			'minimum_version' => isset( $item['minimum_version'] ) ? $item['minimum_version'] : null,
			'source_policy'   => factory_rest_agent_dependency_source_policy( (string) ( $item['slug'] ?? '' ) ),
			'blocking'        => $required && 'ok' !== $status,
			'notes'           => factory_rest_agent_dependency_note( (string) ( $item['slug'] ?? '' ), $required, $status ),
		];
	}

	return $dependencies;
}

function factory_rest_agent_dependency_source_policy( string $slug ): string {
	switch ( $slug ) {
		case 'kava':
		case 'jet-engine':
		case 'jet-smart-filters':
			return 'official_crocoblock';
		case 'jet-form-builder':
		case 'woocommerce':
		case 'elementor':
			return 'wordpress_org';
		default:
			return 'manual';
	}
}

function factory_rest_agent_dependency_note( string $slug, bool $required, string $status ): string {
	$label = str_replace( '-', ' ', $slug );

	if ( 'ok' === $status ) {
		return ucfirst( $label ) . ' is available.';
	}

	if ( $required ) {
		if ( in_array( $slug, [ 'kava', 'jet-engine', 'jet-smart-filters' ], true ) ) {
			return 'Install via the official Crocoblock Wizard or upload the official ZIP manually.';
		}

		return 'Required dependency is not ready yet.';
	}

	if ( in_array( $slug, [ 'woocommerce', 'elementor', 'jet-form-builder' ], true ) ) {
		return 'Optional dependency. Install only if the project needs this capability.';
	}

	return 'Dependency is optional in the current alpha flow.';
}
