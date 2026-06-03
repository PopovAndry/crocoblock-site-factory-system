<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'admin_menu', 'factory_register_ai_settings_page' );
add_action( 'admin_enqueue_scripts', 'factory_enqueue_ai_settings_assets' );

function factory_register_ai_settings_page(): void {
	add_submenu_page(
		'factory-control-panel',
		'AI Settings',
		'AI Settings',
		'manage_options',
		'factory-ai-settings',
		'factory_render_ai_settings_page'
	);
}

function factory_enqueue_ai_settings_assets( string $hook ): void {
	if ( false === strpos( $hook, 'factory-ai-settings' ) ) {
		return;
	}

	$asset_url  = FACTORY_PLUGIN_URL . 'admin/assets/';
	$asset_path = __DIR__ . '/assets/';

	wp_enqueue_style(
		'factory-ai-settings',
		$asset_url . 'ai-settings.css',
		[],
		filemtime( $asset_path . 'ai-settings.css' )
	);

	wp_enqueue_script(
		'factory-ai-settings',
		$asset_url . 'ai-settings.js',
		[],
		filemtime( $asset_path . 'ai-settings.js' ),
		true
	);

	wp_localize_script(
		'factory-ai-settings',
		'FactoryAISettingsConfig',
		[
			'restBase'  => esc_url_raw( rest_url( 'factory/v1' ) ),
			'restNonce' => wp_create_nonce( 'wp_rest' ),
			'endpoints' => [
				'settings' => esc_url_raw( rest_url( 'factory/v1/ai/settings' ) ),
				'estimate' => esc_url_raw( rest_url( 'factory/v1/ai/estimate' ) ),
			],
		]
	);
}

function factory_render_ai_settings_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to access this page.', 'factory' ) );
	}
	?>
	<div class="wrap factory-ai-settings">
		<div id="factory-ai-settings-root" class="factory-ai-settings-root">
			<div class="factory-ai-settings-loading">Loading AI settings...</div>
		</div>
	</div>
	<?php
}
