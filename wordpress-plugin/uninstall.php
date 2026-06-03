<?php
/**
 * Conservative uninstall for Crocoblock Site Factory.
 *
 * Generated content, media attachments, run manifests, and reports are kept so
 * an uninstall does not accidentally delete a user's generated site.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'factory_blueprint' );
