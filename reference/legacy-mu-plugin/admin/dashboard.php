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

	$asset_url  = plugin_dir_url( __FILE__ ) . 'assets/';
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
				'doctor'  => '/doctor',
				'runs'    => '/runs?limit=20',
				'latest'  => '/run/latest',
				'run'     => '/run/{file}',
				'adapters' => '/adapters',
				'realEstatePlan'  => '/beta/real-estate/plan',
				'realEstateApply' => '/beta/real-estate/apply',
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
