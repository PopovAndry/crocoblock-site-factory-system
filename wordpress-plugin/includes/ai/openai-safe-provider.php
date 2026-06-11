<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_openai_safe_provider_request( array $payload ): array {
	$model_profile = factory_ai_sanitize_model_key( (string) ( $payload['model_profile'] ?? 'balanced' ) );
	$messages      = is_array( $payload['messages'] ?? null ) ? $payload['messages'] : [];
	$resolved      = factory_ai_resolve_api_key();
	$api_key       = (string) ( $resolved['key'] ?? '' );
	$model         = factory_ai_openai_model_for_profile( $model_profile );

	if ( '' === $api_key ) {
		return [
			'status'            => 'disabled',
			'code'              => 'missing_api_key',
			'message'           => 'No API key is configured for live AI suggestions.',
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => false,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No provider call was made.',
			],
			'usage'             => factory_ai_openai_usage_metadata( false, $model_profile, $model, [] ),
		];
	}

	if ( empty( $messages ) ) {
		return [
			'status'            => 'error',
			'code'              => 'invalid_provider_request',
			'message'           => 'Live AI request is missing provider messages.',
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => false,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No provider call was made.',
			],
			'usage'             => factory_ai_openai_usage_metadata( false, $model_profile, $model, [] ),
		];
	}

	$response = wp_remote_post(
		'https://api.openai.com/v1/chat/completions',
		[
			'timeout' => 25,
			'headers' => [
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $api_key,
			],
			'body'    => wp_json_encode(
				[
					'model'           => $model,
					'temperature'     => 0.2,
					'max_tokens'      => factory_ai_openai_max_tokens( $model_profile ),
					'response_format' => [
						'type' => 'json_object',
					],
					'messages'        => $messages,
				]
			),
		]
	);

	if ( is_wp_error( $response ) ) {
		return [
			'status'            => 'error',
			'code'              => 'provider_request_failed',
			'message'           => factory_ai_openai_redact_error_message( $response->get_error_message(), 'OpenAI request failed.' ),
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => true,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No site changes were applied.',
			],
			'usage'             => factory_ai_openai_usage_metadata( true, $model_profile, $model, [] ),
		];
	}

	$status_code = (int) wp_remote_retrieve_response_code( $response );
	$body        = wp_remote_retrieve_body( $response );
	$decoded     = json_decode( $body, true );

	if ( $status_code < 200 || $status_code >= 300 ) {
		$error_message = factory_ai_openai_extract_error_message( $decoded );

		return [
			'status'            => 'error',
			'code'              => factory_ai_openai_http_error_code( $status_code ),
			'message'           => factory_ai_openai_redact_error_message( $error_message, 'OpenAI returned an error response.' ),
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => true,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No site changes were applied.',
			],
			'usage'             => factory_ai_openai_usage_metadata( true, $model_profile, $model, is_array( $decoded['usage'] ?? null ) ? $decoded['usage'] : [] ),
		];
	}

	if ( ! is_array( $decoded ) ) {
		return [
			'status'            => 'error',
			'code'              => 'provider_invalid_json',
			'message'           => 'OpenAI returned an invalid JSON envelope.',
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => true,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No site changes were applied.',
			],
			'usage'             => factory_ai_openai_usage_metadata( true, $model_profile, $model, [] ),
		];
	}

	$content = factory_ai_openai_extract_content( $decoded );

	if ( '' === $content ) {
		return [
			'status'            => 'error',
			'code'              => 'provider_empty_content',
			'message'           => 'OpenAI returned an empty interpretation response.',
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => true,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No site changes were applied.',
			],
			'usage'             => factory_ai_openai_usage_metadata( true, $model_profile, $model, is_array( $decoded['usage'] ?? null ) ? $decoded['usage'] : [] ),
		];
	}

	$raw_interpretation = json_decode( factory_ai_openai_strip_json_fences( $content ), true );

	if ( ! is_array( $raw_interpretation ) ) {
		return [
			'status'            => 'error',
			'code'              => 'provider_invalid_content',
			'message'           => 'OpenAI returned content that could not be parsed as the safe interpretation contract.',
			'provider'          => 'openai',
			'model_profile'     => $model_profile,
			'model'             => $model,
			'provider_called'   => true,
			'raw_interpretation'=> [],
			'warnings'          => [
				'No site changes were applied.',
			],
			'usage'             => factory_ai_openai_usage_metadata( true, $model_profile, $model, is_array( $decoded['usage'] ?? null ) ? $decoded['usage'] : [] ),
		];
	}

	return [
		'status'            => 'ok',
		'code'              => 'provider_success',
		'message'           => 'OpenAI returned live safe suggestions.',
		'provider'          => 'openai',
		'model_profile'     => $model_profile,
		'model'             => $model,
		'provider_called'   => true,
		'raw_interpretation'=> $raw_interpretation,
		'warnings'          => [],
		'usage'             => factory_ai_openai_usage_metadata( true, $model_profile, $model, is_array( $decoded['usage'] ?? null ) ? $decoded['usage'] : [] ),
	];
}

function factory_ai_openai_model_for_profile( string $model_profile ): string {
	$model_profile = factory_ai_sanitize_model_key( $model_profile );
	$map = [
		'fast'      => 'gpt-4.1-mini',
		'balanced'  => 'gpt-4.1-mini',
		'reasoning' => 'gpt-4.1',
	];

	return $map[ $model_profile ] ?? $map['balanced'];
}

function factory_ai_openai_max_tokens( string $model_profile ): int {
	return max( 200, factory_ai_model_output_allowance( $model_profile ) );
}

function factory_ai_openai_strip_json_fences( string $content ): string {
	$content = trim( $content );

	if ( str_starts_with( $content, '```' ) ) {
		$content = preg_replace( '/^```(?:json)?\s*/i', '', $content );
		$content = preg_replace( '/\s*```$/', '', (string) $content );
	}

	return trim( (string) $content );
}

function factory_ai_openai_extract_content( array $response ): string {
	$content = $response['choices'][0]['message']['content'] ?? '';

	return is_string( $content ) ? trim( $content ) : '';
}

function factory_ai_openai_extract_error_message( $response ): string {
	if ( is_array( $response ) && is_array( $response['error'] ?? null ) ) {
		$message = $response['error']['message'] ?? '';

		if ( is_string( $message ) && '' !== trim( $message ) ) {
			return trim( $message );
		}
	}

	return 'OpenAI returned an unexpected error response.';
}

function factory_ai_openai_redact_error_message( string $message, string $fallback ): string {
	$message = trim( factory_ai_redact_string( $message ) );

	return '' !== $message ? $message : $fallback;
}

function factory_ai_openai_http_error_code( int $status_code ): string {
	if ( 401 === $status_code || 403 === $status_code ) {
		return 'provider_auth_failed';
	}

	if ( 408 === $status_code || 504 === $status_code ) {
		return 'provider_timeout';
	}

	if ( 429 === $status_code ) {
		return 'provider_rate_limited';
	}

	if ( $status_code >= 500 ) {
		return 'provider_unavailable';
	}

	return 'provider_http_error';
}

function factory_ai_openai_usage_metadata( bool $provider_called, string $model_profile, string $model, array $usage ): array {
	$input_tokens  = isset( $usage['prompt_tokens'] ) && is_numeric( $usage['prompt_tokens'] ) ? (int) $usage['prompt_tokens'] : null;
	$output_tokens = isset( $usage['completion_tokens'] ) && is_numeric( $usage['completion_tokens'] ) ? (int) $usage['completion_tokens'] : null;
	$total_tokens  = isset( $usage['total_tokens'] ) && is_numeric( $usage['total_tokens'] ) ? (int) $usage['total_tokens'] : null;

	return [
		'provider_called'   => $provider_called,
		'provider'          => 'openai',
		'model_profile'     => $model_profile,
		'model'             => $model,
		'input_tokens'      => $input_tokens,
		'output_tokens'     => $output_tokens,
		'total_tokens'      => $total_tokens,
		'cost'              => null,
		'cost_currency'     => 'USD',
		'cost_is_estimated' => false,
	];
}
