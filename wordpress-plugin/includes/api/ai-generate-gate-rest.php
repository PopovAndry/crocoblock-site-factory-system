<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_ai_generate_gate_rest_routes' );

function factory_register_ai_generate_gate_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/ai/generate-gate',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_ai_generate_gate',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_ai_generate_gate( WP_REST_Request $request ): WP_REST_Response {
	$prompt = $request->get_param( 'prompt' );
	$site_plan = $request->get_param( 'site_plan' );
	$blueprint_candidate = $request->get_param( 'blueprint_candidate' );
	$preview_diff = $request->get_param( 'preview_diff' );
	$site_type = $request->get_param( 'site_type' );
	$vertical = $request->get_param( 'vertical' );
	$context = $request->get_param( 'context' );

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';
	$site_plan = is_array( $site_plan ) ? $site_plan : [];
	$blueprint_candidate = is_array( $blueprint_candidate ) ? $blueprint_candidate : [];
	$preview_diff = is_array( $preview_diff ) ? $preview_diff : [];

	if ( is_array( $site_type ) || is_object( $site_type ) ) {
		$site_type = '';
	}

	if ( is_array( $vertical ) || is_object( $vertical ) ) {
		$vertical = '';
	}

	$site_type = is_string( $site_type ) || is_numeric( $site_type ) ? (string) $site_type : '';
	$vertical = is_string( $vertical ) || is_numeric( $vertical ) ? (string) $vertical : '';
	$context = is_array( $context ) ? $context : [];

	$response = factory_ai_build_generate_gate(
		[
			'prompt'              => $prompt,
			'site_plan'           => $site_plan,
			'blueprint_candidate' => $blueprint_candidate,
			'preview_diff'        => $preview_diff,
			'site_type'           => '' !== trim( $site_type ) ? $site_type : $vertical,
			'vertical'            => $vertical,
			'context'             => $context,
		]
	);

	return new WP_REST_Response( $response );
}
