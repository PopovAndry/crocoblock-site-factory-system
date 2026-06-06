<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_ai_live_rest_routes' );

function factory_register_ai_live_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/ai/interpret-live',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_ai_interpret_live',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_ai_interpret_live( WP_REST_Request $request ): WP_REST_Response {
	$prompt = $request->get_param( 'prompt' );

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';

	return new WP_REST_Response(
		[
			'status'             => 'disabled',
			'code'               => 'live_ai_not_implemented',
			'message'            => 'Live AI suggestions are not implemented yet. Local safe suggestions are available.',
			'provider'           => 'openai',
			'mode'               => 'safe_variables_only',
			'applies_changes'    => false,
			'vertical'           => 'real_estate',
			'recommended_preset' => 'real-estate',
			'preset_variables'   => [
				'agency_name'   => '',
				'hero_title'    => '',
				'hero_subtitle' => '',
				'hero_cta_text' => '',
				'contact_title' => '',
				'contact_intro' => '',
				'phone'         => '',
				'email'         => '',
			],
			'unsupported_requests' => [],
			'warnings'           => [
				'No provider call was made.',
				'No site changes were applied.',
			],
			'usage'              => [
				'provider_called' => false,
				'input_tokens'    => null,
				'output_tokens'   => null,
				'total_tokens'    => null,
				'cost'           => null,
			],
		]
	);
}
