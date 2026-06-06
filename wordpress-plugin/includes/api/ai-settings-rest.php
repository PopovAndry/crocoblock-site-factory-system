<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'factory_register_ai_settings_rest_routes' );

function factory_register_ai_settings_rest_routes(): void {
	register_rest_route(
		'factory/v1',
		'/ai/settings',
		[
			[
				'methods'             => 'GET',
				'callback'            => 'factory_rest_ai_get_settings',
				'permission_callback' => 'factory_rest_require_manage_options',
			],
			[
				'methods'             => 'POST',
				'callback'            => 'factory_rest_ai_save_settings',
				'permission_callback' => 'factory_rest_require_manage_options',
			],
		]
	);

	register_rest_route(
		'factory/v1',
		'/ai/estimate',
		[
			'methods'             => 'POST',
			'callback'            => 'factory_rest_ai_estimate',
			'permission_callback' => 'factory_rest_require_manage_options',
		]
	);
}

function factory_rest_ai_get_settings(): WP_REST_Response {
	return new WP_REST_Response( factory_ai_public_settings() );
}

function factory_rest_ai_save_settings( WP_REST_Request $request ): WP_REST_Response {
	$selected_model = factory_ai_sanitize_model_key( (string) $request->get_param( 'selected_model' ) );
	$remove_key = filter_var( $request->get_param( 'remove_key' ), FILTER_VALIDATE_BOOLEAN );
	$api_key = $request->get_param( 'api_key' );
	$settings = factory_ai_get_settings();
	$warnings = [];

	$settings['provider'] = 'openai';
	$settings['selected_model'] = $selected_model;

	if ( $remove_key ) {
		$settings['encrypted_api_key'] = '';
	}

	if ( is_string( $api_key ) && '' !== trim( $api_key ) ) {
		$api_key = trim( sanitize_text_field( wp_unslash( $api_key ) ) );

		if ( factory_ai_storage_available() ) {
			$encrypted = factory_ai_encrypt_secret( $api_key );

			if ( '' !== $encrypted ) {
				$settings['encrypted_api_key'] = $encrypted;
			} else {
				$warnings[] = 'API key could not be encrypted. Saved key was not changed.';
			}
		} else {
			$warnings[] = 'Saved API key storage is unavailable because Sodium encryption is not available.';
		}
	}

	factory_ai_save_settings( $settings );

	$response = factory_ai_public_settings();
	$response['warnings'] = array_values(
		array_unique(
			array_merge(
				$response['warnings'] ?? [],
				$warnings
			)
		)
	);

	return new WP_REST_Response( $response );
}

function factory_rest_ai_estimate( WP_REST_Request $request ): WP_REST_Response {
	$text = $request->get_param( 'text' );
	$model = factory_ai_sanitize_model_key( (string) $request->get_param( 'selected_model' ) );

	return new WP_REST_Response(
		factory_ai_estimate_tokens(
			is_string( $text ) ? sanitize_textarea_field( wp_unslash( $text ) ) : '',
			factory_ai_model_output_allowance( $model ),
			$model
		)
	);
}
