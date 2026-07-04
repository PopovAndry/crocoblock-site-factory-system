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
