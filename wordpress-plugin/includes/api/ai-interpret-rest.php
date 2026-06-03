<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_ai_interpret_rest_routes' );

function factory_register_ai_interpret_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/ai/interpret-prompt',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_ai_interpret_prompt',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_ai_interpret_prompt( WP_REST_Request $request ): WP_REST_Response {
	$mode = sanitize_key( (string) $request->get_param( 'mode' ) );
	$prompt = $request->get_param( 'prompt' );
	$current_context = $request->get_param( 'current_context' );
	$warnings = [];

	if ( 'local_mock' !== $mode ) {
		$mode = 'local_mock';
		$warnings[] = 'Unsupported interpretation mode was ignored. Local mock interpretation was used.';
	}

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? (string) $prompt : '';
	$prompt = sanitize_textarea_field( wp_unslash( $prompt ) );

	if ( '' === trim( $prompt ) ) {
		$warnings[] = 'Prompt is empty, so suggestions use current dashboard defaults.';
	}

	if ( ! is_array( $current_context ) ) {
		$current_context = [];
	}

	$interpretation = factory_ai_interpret_prompt_local(
		$prompt,
		factory_rest_ai_sanitize_interpret_context( $current_context )
	);

	return new WP_REST_Response(
		[
			'status'         => 'ok',
			'interpretation' => $interpretation,
			'warnings'       => array_values( array_unique( $warnings ) ),
			'notices'        => [
				'Interpretation only. No blueprint or preset changes were applied.',
			],
		]
	);
}

function factory_rest_ai_sanitize_interpret_context( array $context ): array {
	$preset = sanitize_key( (string) ( $context['preset'] ?? 'real-estate' ) );
	$preset_variables = is_array( $context['preset_variables'] ?? null ) ? $context['preset_variables'] : [];
	$style_context = is_array( $context['style_context'] ?? null ) ? $context['style_context'] : [];
	$image_context = is_array( $context['image_context'] ?? null ) ? $context['image_context'] : [];

	return [
		'preset'           => 'real-estate' === $preset ? 'real-estate' : 'real-estate',
		'preset_variables' => [
			'agency_name'   => factory_ai_clamp_prompt_string( $preset_variables['agency_name'] ?? '', 80 ),
			'hero_title'    => factory_ai_clamp_prompt_string( $preset_variables['hero_title'] ?? '', 120 ),
			'hero_subtitle' => factory_ai_clamp_prompt_string( $preset_variables['hero_subtitle'] ?? '', 240 ),
			'contact_title' => factory_ai_clamp_prompt_string( $preset_variables['contact_title'] ?? '', 120 ),
			'contact_intro' => factory_ai_clamp_prompt_string( $preset_variables['contact_intro'] ?? '', 400 ),
		],
		'style_context'    => [
			'tone'           => factory_ai_normalize_enum( $style_context['tone'] ?? 'premium', [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ], 'premium' ),
			'primary_preset' => factory_ai_normalize_enum( $style_context['primary_preset'] ?? 'turquoise', [ 'turquoise', 'blue', 'green', 'beige' ], 'turquoise' ),
		],
		'image_context'    => [
			'source' => 'demo_pool',
			'mode'   => 'round_robin',
		],
	];
}
