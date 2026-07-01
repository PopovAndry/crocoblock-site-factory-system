<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/dependency-status.php';

add_action( 'template_redirect', 'factory_console_maybe_render' );
add_action( 'wp_enqueue_scripts', 'factory_console_enqueue_assets' );
add_filter( 'show_admin_bar', 'factory_console_filter_admin_bar' );

function factory_console_is_request(): bool {
	if ( is_admin() ) {
		return false;
	}

	if ( ! isset( $_GET['factory_console'] ) ) {
		return false;
	}

	$value = wp_unslash( (string) $_GET['factory_console'] );
	$value = sanitize_text_field( $value );

	return '' !== $value && '0' !== $value;
}

function factory_console_url(): string {
	return add_query_arg( 'factory_console', '1', home_url( '/' ) );
}

function factory_console_request_mode(): string {
	if ( ! factory_console_is_request() ) {
		return '';
	}

	if ( ! is_user_logged_in() ) {
		return 'login';
	}

	if ( ! current_user_can( 'manage_options' ) ) {
		return 'forbidden';
	}

	return 'app';
}

function factory_console_filter_admin_bar( bool $show ): bool {
	return factory_console_is_request() ? false : $show;
}

function factory_console_enqueue_assets(): void {
	if ( ! factory_console_is_request() || 'app' !== factory_console_request_mode() ) {
		return;
	}

	$asset_url  = FACTORY_PLUGIN_URL . 'frontend/assets/';
	$asset_path = FACTORY_PLUGIN_DIR . 'frontend/assets/';

	wp_enqueue_style(
		'factory-console',
		$asset_url . 'factory-console.css',
		[],
		file_exists( $asset_path . 'factory-console.css' ) ? filemtime( $asset_path . 'factory-console.css' ) : FACTORY_PLUGIN_VERSION
	);

	wp_enqueue_script(
		'factory-console',
		$asset_url . 'factory-console.js',
		[],
		file_exists( $asset_path . 'factory-console.js' ) ? filemtime( $asset_path . 'factory-console.js' ) : FACTORY_PLUGIN_VERSION,
		true
	);

	wp_localize_script(
		'factory-console',
		'FactoryConsoleConfig',
		factory_console_build_client_config()
	);
}

function factory_console_build_client_config(): array {
	$settings = function_exists( 'factory_ai_public_settings' )
		? factory_ai_public_settings()
		: [
			'provider'         => 'openai',
			'available_models' => [],
			'selected_model'   => 'balanced',
			'has_key'          => false,
			'key_source'       => 'none',
			'masked_key'       => '',
			'warnings'         => [],
			'notices'          => [],
		];

	return [
		'restBase'         => esc_url_raw( rest_url( 'factory/v1' ) ),
		'restNonce'        => wp_create_nonce( 'wp_rest' ),
		'consoleMode'      => 'alpha_read_only',
		'currentUser'      => [
			'can_manage_factory' => current_user_can( 'manage_options' ),
		],
		'siteTypeOptions'  => [
			[
				'value'    => 'real_estate',
				'label'    => 'Real Estate',
				'disabled' => false,
			],
		],
		'endpoints'        => [
			'aiSettings'             => esc_url_raw( rest_url( 'factory/v1/ai/settings' ) ),
			'aiEstimate'             => esc_url_raw( rest_url( 'factory/v1/ai/estimate' ) ),
			'aiSitePlan'             => esc_url_raw( rest_url( 'factory/v1/ai/site-plan' ) ),
			'aiBlueprintCandidate'   => esc_url_raw( rest_url( 'factory/v1/ai/blueprint-candidate' ) ),
			'aiPreviewDiff'          => esc_url_raw( rest_url( 'factory/v1/ai/preview-diff' ) ),
			'aiGenerateGate'         => esc_url_raw( rest_url( 'factory/v1/ai/generate-gate' ) ),
			'aiGeneratePreflight'    => esc_url_raw( rest_url( 'factory/v1/ai/generate-preflight' ) ),
			'aiGenerateConfirmation' => esc_url_raw( rest_url( 'factory/v1/ai/generate-confirmation' ) ),
		],
		'siteLinks'        => factory_console_site_links(),
		'aiSettings'       => $settings,
		'dependencyStatus' => factory_console_dependency_status_data(),
	];
}

function factory_console_site_links(): array {
	$blueprint = factory_get_blueprint();
	$home      = is_array( $blueprint['pages']['home'] ?? null ) ? $blueprint['pages']['home'] : [];
	$archive   = is_array( $blueprint['pages']['archive'] ?? null ) ? $blueprint['pages']['archive'] : [];
	$contact   = is_array( $blueprint['pages']['contact'] ?? null ) ? $blueprint['pages']['contact'] : [];

	$home_slug    = is_string( $home['slug'] ?? null ) ? trim( (string) $home['slug'] ) : '';
	$archive_slug = is_string( $archive['slug'] ?? null ) && '' !== trim( (string) $archive['slug'] ) ? trim( (string) $archive['slug'] ) : 'properties';
	$contact_slug = is_string( $contact['slug'] ?? null ) && '' !== trim( (string) $contact['slug'] ) ? trim( (string) $contact['slug'] ) : 'contact';

	return [
		'console'            => esc_url_raw( factory_console_url() ),
		'home'               => esc_url_raw( home_url( '' === $home_slug ? '/' : '/' . ltrim( $home_slug, '/' ) . '/' ) ),
		'properties'         => esc_url_raw( home_url( '/' . ltrim( $archive_slug, '/' ) . '/' ) ),
		'contact'            => esc_url_raw( home_url( '/' . ltrim( $contact_slug, '/' ) . '/' ) ),
		'manage_properties'  => esc_url_raw( admin_url( 'edit.php?post_type=property' ) ),
		'frontend_edit'      => esc_url_raw( home_url( '' === $home_slug ? '/' : '/' . ltrim( $home_slug, '/' ) . '/' ) ),
		'dashboard'          => esc_url_raw( admin_url( 'admin.php?page=factory-control-panel' ) ),
		'ai_settings'        => esc_url_raw( admin_url( 'admin.php?page=factory-ai-settings' ) ),
		'plugins'            => esc_url_raw( admin_url( 'plugins.php' ) ),
		'themes'             => esc_url_raw( admin_url( 'themes.php' ) ),
		'wizard'             => esc_url_raw( admin_url( 'admin.php?page=jet-plugins-wizard' ) ),
	];
}

function factory_console_maybe_render(): void {
	if ( ! factory_console_is_request() ) {
		return;
	}

	$mode = factory_console_request_mode();

	if ( 'login' === $mode ) {
		wp_safe_redirect( wp_login_url( factory_console_url() ) );
		exit;
	}

	if ( '' === $mode ) {
		return;
	}

	status_header( 'forbidden' === $mode ? 403 : 200 );
	nocache_headers();
	factory_console_render_document( $mode );
	exit;
}

function factory_console_render_document( string $mode ): void {
	$factory_console_mode = $mode;
	$factory_console_context = [
		'login_url'    => wp_login_url( factory_console_url() ),
		'home_url'     => home_url( '/' ),
		'dashboard_url'=> admin_url( 'admin.php?page=factory-control-panel' ),
	];

	require FACTORY_PLUGIN_DIR . 'includes/templates/factory-console.php';
}
