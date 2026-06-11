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
	$current_context = $request->get_param( 'current_context' );
	$warnings = [];

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = '';
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : '';

	if ( ! is_array( $current_context ) ) {
		$current_context = [];
	}

	$current_context = factory_rest_ai_sanitize_interpret_context( $current_context );
	$model_profile = factory_ai_sanitize_model_key( (string) $request->get_param( 'model_profile' ) );
	$confirm_live_call = factory_rest_ai_live_boolean_param( $request->get_param( 'confirm_live_call' ) );
	$key = factory_ai_resolve_api_key();
	$has_key = ! empty( $key['key'] );

	if ( '' === trim( $prompt ) ) {
		$warnings[] = 'Prompt is empty, so no live suggestions were requested.';
	}

	if ( ! $has_key ) {
		return new WP_REST_Response(
			factory_rest_ai_live_response(
				[
					'status'        => 'disabled',
					'code'          => 'missing_api_key',
					'message'       => 'No API key is configured for live AI interpretation.',
					'prompt'        => $prompt,
					'current_context' => $current_context,
					'warnings'      => array_merge(
						$warnings,
						[
							'No provider call was made.',
							'No site changes were applied.',
						]
					),
					'model_profile' => $model_profile,
				]
			)
		);
	}

	if ( ! $confirm_live_call ) {
		return new WP_REST_Response(
			factory_rest_ai_live_response(
				[
					'status'        => 'disabled',
					'code'          => 'live_call_confirmation_required',
					'message'       => 'Live AI interpretation is available, but an explicit confirmation flag is required before calling the provider.',
					'prompt'        => $prompt,
					'current_context' => $current_context,
					'warnings'      => array_merge(
						$warnings,
						[
							'No provider call was made.',
							'No site changes were applied.',
						]
					),
					'model_profile' => $model_profile,
				]
			)
		);
	}

	$result = factory_ai_live_interpret_prompt(
		$prompt,
		$current_context,
		[
			'model_profile' => $model_profile,
		]
	);

	return new WP_REST_Response(
		factory_rest_ai_live_response(
			[
				'status'          => $result['status'] ?? 'error',
				'code'            => $result['code'] ?? 'live_interpretation_failed',
				'message'         => $result['message'] ?? 'Live AI interpretation failed.',
				'prompt'          => $prompt,
				'current_context' => $current_context,
				'warnings'        => array_merge( $warnings, factory_rest_ai_live_string_list( $result['warnings'] ?? [] ) ),
				'model_profile'   => $result['model_profile'] ?? $model_profile,
				'model'           => $result['model'] ?? '',
				'provider_called' => ! empty( $result['provider_called'] ),
				'preset_variables' => is_array( $result['preset_variables'] ?? null ) ? $result['preset_variables'] : ( $result['suggestions'] ?? [] ),
				'unsupported_requests' => $result['unsupported_requests'] ?? [],
				'usage'           => is_array( $result['usage'] ?? null ) ? $result['usage'] : [],
				'confidence'      => $result['confidence'] ?? [],
			]
		)
	);
}

function factory_rest_ai_live_response( array $payload ): array {
	$context = is_array( $payload['current_context'] ?? null ) ? $payload['current_context'] : [];
	$validated = factory_ai_validate_safe_prompt_interpretation(
		[
			'preset_variables'     => is_array( $payload['preset_variables'] ?? null ) ? $payload['preset_variables'] : [],
			'unsupported_requests' => $payload['unsupported_requests'] ?? [],
			'warnings'             => $payload['warnings'] ?? [],
			'confidence'           => $payload['confidence'] ?? [],
		]
	);
	$preset_variables = $validated['preset_variables'] ?? factory_ai_empty_safe_preset_variables();
	$warnings = factory_rest_ai_live_string_list( $payload['warnings'] ?? [] );
	$usage = is_array( $payload['usage'] ?? null ) ? $payload['usage'] : [];
	$provider_called = ! empty( $payload['provider_called'] ) || ! empty( $usage['provider_called'] );

	return [
		'status'               => factory_rest_ai_live_status( (string) ( $payload['status'] ?? 'error' ) ),
		'code'                 => sanitize_key( (string) ( $payload['code'] ?? 'live_interpretation_failed' ) ),
		'message'              => factory_ai_redact_string( (string) ( $payload['message'] ?? '' ), 280 ),
		'provider'             => 'openai',
		'mode'                 => 'safe_variables_only',
		'applies_changes'      => false,
		'provider_called'      => $provider_called,
		'model_profile'        => factory_ai_sanitize_model_key( (string) ( $payload['model_profile'] ?? '' ) ),
		'model'                => sanitize_text_field( (string) ( $payload['model'] ?? '' ) ),
		'vertical'             => 'real_estate',
		'recommended_preset'   => 'real-estate',
		'prompt'               => factory_ai_redact_string( (string) ( $payload['prompt'] ?? '' ), 1200 ),
		'current_context'      => $context,
		'preset_variables'     => $preset_variables,
		'suggestions'          => $preset_variables,
		'unsupported_requests' => array_values( $validated['unsupported_requests'] ?? [] ),
		'warnings'             => array_values( array_unique( array_merge( $warnings, $validated['warnings'] ?? [] ) ) ),
		'confidence'           => is_array( $validated['confidence'] ?? null ) ? $validated['confidence'] : [],
		'usage'                => [
			'provider_called' => $provider_called,
			'input_tokens'    => isset( $usage['input_tokens'] ) ? (int) $usage['input_tokens'] : null,
			'output_tokens'   => isset( $usage['output_tokens'] ) ? (int) $usage['output_tokens'] : null,
			'total_tokens'    => isset( $usage['total_tokens'] ) ? (int) $usage['total_tokens'] : null,
			'cost'            => isset( $usage['cost'] ) ? sanitize_text_field( (string) $usage['cost'] ) : null,
		],
	];
}

function factory_rest_ai_live_boolean_param( $value ): bool {
	if ( is_bool( $value ) ) {
		return $value;
	}

	if ( is_numeric( $value ) ) {
		return (int) $value === 1;
	}

	if ( ! is_string( $value ) ) {
		return false;
	}

	$value = strtolower( trim( $value ) );

	return in_array( $value, [ '1', 'true', 'yes', 'on' ], true );
}

function factory_rest_ai_live_string_list( $items ): array {
	if ( ! is_array( $items ) ) {
		return [];
	}

	$normalized = [];

	foreach ( $items as $item ) {
		if ( is_array( $item ) ) {
			$label = sanitize_text_field( (string) ( $item['label'] ?? '' ) );
			$reason = sanitize_text_field( (string) ( $item['reason'] ?? '' ) );
			$alternative = sanitize_text_field( (string) ( $item['safe_alternative'] ?? '' ) );
			$parts = array_filter( [ $label, $reason, $alternative ] );

			if ( ! empty( $parts ) ) {
				$normalized[] = implode( ' - ', $parts );
			}

			continue;
		}

		if ( is_scalar( $item ) ) {
			$text = sanitize_text_field( (string) $item );

			if ( '' !== $text ) {
				$normalized[] = $text;
			}
		}
	}

	return array_values( array_unique( $normalized ) );
}

function factory_rest_ai_live_status( string $status ): string {
	if ( in_array( $status, [ 'ok', 'warning', 'disabled' ], true ) ) {
		return $status;
	}

	return 'error';
}
