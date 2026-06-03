<?php
/**
 * Plugin Name: Crocoblock Site Factory
 * Plugin URI: https://github.com/PopovAndry/crocoblock-site-factory-plugin
 * Description: Installable beta of the Crocoblock Site Factory engine with a Real Estate demo flow.
 * Version: 0.1.0-beta
 * Author: PopovAndry
 * Text Domain: crocoblock-site-factory
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FACTORY_PLUGIN_FILE', __FILE__ );
define( 'FACTORY_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FACTORY_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'FACTORY_PLUGIN_VERSION', '0.1.0-beta' );

$factory_upload_dir = wp_upload_dir();
$factory_uploads_dir = trailingslashit( $factory_upload_dir['basedir'] ) . 'crocoblock-site-factory/';
$factory_uploads_url = trailingslashit( $factory_upload_dir['baseurl'] ) . 'crocoblock-site-factory/';

define( 'FACTORY_UPLOADS_DIR', $factory_uploads_dir );
define( 'FACTORY_UPLOADS_URL', $factory_uploads_url );
define( 'FACTORY_BLUEPRINTS_DIR', FACTORY_UPLOADS_DIR . 'blueprints/' );
define( 'FACTORY_PRESETS_DIR', FACTORY_PLUGIN_DIR . 'presets/' );
define( 'FACTORY_GENERATED_BLUEPRINTS_DIR', FACTORY_BLUEPRINTS_DIR . 'generated/' );
define( 'FACTORY_BLUEPRINT_CACHE_DIR', FACTORY_BLUEPRINTS_DIR . 'cache/' );
define( 'FACTORY_RUNS_DIR', FACTORY_UPLOADS_DIR . 'runs/' );
define( 'FACTORY_REPORTS_DIR', FACTORY_UPLOADS_DIR . 'reports/' );
define( 'FACTORY_ASSETS_DIR', FACTORY_PLUGIN_DIR . 'assets/' );
define( 'FACTORY_ASSETS_URL', FACTORY_PLUGIN_URL . 'assets/' );
define( 'FACTORY_BLUEPRINT_PATH', FACTORY_PRESETS_DIR . 'real-estate.json' );
define( 'FACTORY_BLUEPRINT_OPTION', 'factory_blueprint' );

function factory_activate_plugin(): void {
	foreach (
		[
			FACTORY_UPLOADS_DIR,
			FACTORY_BLUEPRINTS_DIR,
			FACTORY_GENERATED_BLUEPRINTS_DIR,
			FACTORY_BLUEPRINT_CACHE_DIR,
			FACTORY_RUNS_DIR,
			FACTORY_REPORTS_DIR,
		] as $dir
	) {
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
	}
}

register_activation_hook( __FILE__, 'factory_activate_plugin' );

require_once FACTORY_PLUGIN_DIR . 'includes/bootstrap.php';
