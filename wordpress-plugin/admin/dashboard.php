<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'admin_menu', 'factory_register_admin_dashboard' );
add_action( 'admin_enqueue_scripts', 'factory_enqueue_admin_dashboard_assets' );

function factory_register_admin_dashboard(): void {
	add_menu_page(
		'Crocoblock Site Factory',
		'Site Factory',
		'manage_options',
		'factory-control-panel',
		'factory_render_admin_dashboard',
		'dashicons-admin-site-alt3',
		58
	);
}

function factory_enqueue_admin_dashboard_assets( string $hook ): void {
	if ( 'toplevel_page_factory-control-panel' !== $hook ) {
		return;
	}

	$asset_url  = FACTORY_PLUGIN_URL . 'admin/assets/';
	$asset_path = __DIR__ . '/assets/';

	wp_enqueue_style(
		'factory-admin-dashboard',
		$asset_url . 'dashboard.css',
		[],
		filemtime( $asset_path . 'dashboard.css' )
	);

	wp_enqueue_script(
		'factory-admin-dashboard',
		$asset_url . 'dashboard.js',
		[],
		filemtime( $asset_path . 'dashboard.js' ),
		true
	);

	wp_localize_script(
		'factory-admin-dashboard',
		'FactoryDashboardConfig',
		[
			'restBase'  => esc_url_raw( rest_url( 'factory/v1' ) ),
			'restNonce' => wp_create_nonce( 'wp_rest' ),
			'homeUrl'   => esc_url_raw( home_url( '/' ) ),
			'endpoints' => [
				'doctor'                 => esc_url_raw( rest_url( 'factory/v1/doctor' ) ),
				'runs'                   => esc_url_raw( add_query_arg( 'limit', 20, rest_url( 'factory/v1/runs' ) ) ),
				'latest'                 => esc_url_raw( rest_url( 'factory/v1/run/latest' ) ),
				'run'                    => esc_url_raw( rest_url( 'factory/v1/run/{file}' ) ),
				'adapters'               => esc_url_raw( rest_url( 'factory/v1/adapters' ) ),
				'previewBridge'          => esc_url_raw( rest_url( 'factory/v1/preview-bridge' ) ),
				'realEstatePlan'         => esc_url_raw( rest_url( 'factory/v1/beta/real-estate/plan' ) ),
				'realEstateRequirements' => esc_url_raw( rest_url( 'factory/v1/beta/real-estate/requirements' ) ),
				'realEstateApply'        => esc_url_raw( rest_url( 'factory/v1/beta/real-estate/apply' ) ),
				'aiSettings'             => esc_url_raw( rest_url( 'factory/v1/ai/settings' ) ),
				'aiEstimate'             => esc_url_raw( rest_url( 'factory/v1/ai/estimate' ) ),
				'aiInterpretPrompt'      => esc_url_raw( rest_url( 'factory/v1/ai/interpret-prompt' ) ),
				'aiSitePlan'             => esc_url_raw( rest_url( 'factory/v1/ai/site-plan' ) ),
				'aiBlueprintCandidate'   => esc_url_raw( rest_url( 'factory/v1/ai/blueprint-candidate' ) ),
				'aiPreviewDiff'          => esc_url_raw( rest_url( 'factory/v1/ai/preview-diff' ) ),
				'aiGenerateGate'         => esc_url_raw( rest_url( 'factory/v1/ai/generate-gate' ) ),
				'aiGeneratePreflight'    => esc_url_raw( rest_url( 'factory/v1/ai/generate-preflight' ) ),
				'aiGenerateConfirmation' => esc_url_raw( rest_url( 'factory/v1/ai/generate-confirmation' ) ),
				'aiControlledGenerate'   => esc_url_raw( rest_url( 'factory/v1/ai/controlled-generate' ) ),
			],
		]
	);
}

function factory_render_admin_dashboard(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to access this page.', 'factory' ) );
	}
	?>
	<div class="wrap factory-dashboard">
		<div id="factory-dashboard-root" class="factory-dashboard-root">
			<div class="factory-dashboard-loading">Loading Factory dashboard...</div>
		</div>
	</div>
	<?php
}
