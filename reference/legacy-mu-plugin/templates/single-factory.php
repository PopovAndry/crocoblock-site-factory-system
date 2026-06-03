<?php
/**
 * Factory Single Template
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

if ( function_exists( 'factory_render_single_template' ) ) {
	factory_render_single_template();
}

get_footer();