<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_ai_site_plan_rest_routes' );

function factory_register_ai_site_plan_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/ai/site-plan',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_ai_site_plan',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_ai_site_plan( WP_REST_Request $request ) {
	$prompt = $request->get_param( 'prompt' );
	$site_type = $request->get_param( 'site_type' );
	$context = $request->get_param( 'context' );
	$warnings = [];

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';

	if ( is_array( $site_type ) || is_object( $site_type ) ) {
		$site_type = '';
	}

	$site_type = is_string( $site_type ) || is_numeric( $site_type ) ? (string) $site_type : '';

	if ( ! is_array( $context ) ) {
		$context = [];
	}

	$context = factory_rest_ai_site_plan_sanitize_context( $context );

	if ( '' === trim( $prompt ) ) {
		return new WP_REST_Response(
			factory_ai_build_site_plan(
				$prompt,
				$context,
				[
					'site_type' => $site_type,
				]
			)
		);
	}

	$plan = factory_ai_build_site_plan(
		$prompt,
		$context,
		[
			'site_type' => $site_type,
		]
	);

	if ( '' !== trim( $site_type ) && 'unknown' === ( $plan['site_type'] ?? 'unknown' ) ) {
		$warnings[] = 'Requested site type is not recognized in Site Plan v1.';
	}

	if ( ! empty( $warnings ) ) {
		$plan['warnings'] = array_values(
			array_unique(
				array_merge(
					is_array( $plan['warnings'] ?? null ) ? $plan['warnings'] : [],
					$warnings
				)
			)
		);

		if ( 'ok' === ( $plan['status'] ?? 'ok' ) ) {
			$plan['status'] = 'warning';
			$plan['code'] = 'site_plan_supported_with_warnings';
		}
	}

	return new WP_REST_Response( $plan );
}

function factory_rest_ai_site_plan_sanitize_context( array $context ): array {
	if ( function_exists( 'factory_rest_ai_sanitize_interpret_context' ) ) {
		return factory_rest_ai_sanitize_interpret_context( $context );
	}

	$preset_variables = is_array( $context['preset_variables'] ?? null ) ? $context['preset_variables'] : [];
	$style_context = is_array( $context['style_context'] ?? null ) ? $context['style_context'] : [];
	$image_context = is_array( $context['image_context'] ?? null ) ? $context['image_context'] : [];

	return [
		'preset'           => 'real-estate',
		'preset_variables' => [
			'agency_name'   => factory_ai_sanitize_safe_variable( $preset_variables['agency_name'] ?? '', 'text', 80 ),
			'hero_title'    => factory_ai_sanitize_safe_variable( $preset_variables['hero_title'] ?? '', 'text', 120 ),
			'hero_subtitle' => factory_ai_sanitize_safe_variable( $preset_variables['hero_subtitle'] ?? '', 'textarea', 240 ),
			'hero_cta_text' => factory_ai_sanitize_safe_variable( $preset_variables['hero_cta_text'] ?? '', 'text', 60 ),
			'contact_title' => factory_ai_sanitize_safe_variable( $preset_variables['contact_title'] ?? '', 'text', 120 ),
			'contact_intro' => factory_ai_sanitize_safe_variable( $preset_variables['contact_intro'] ?? '', 'textarea', 400 ),
			'phone'         => factory_ai_sanitize_safe_variable( $preset_variables['phone'] ?? '', 'phone', 60 ),
			'email'         => factory_ai_sanitize_safe_variable( $preset_variables['email'] ?? '', 'email', 120 ),
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
