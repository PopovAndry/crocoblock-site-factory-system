<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FACTORY_AI_SETTINGS_OPTION = 'factory_ai_settings';

function factory_ai_default_settings(): array {
	return [
		'provider'          => 'openai',
		'selected_model'    => 'balanced',
		'encrypted_api_key' => '',
	];
}

function factory_ai_model_config(): array {
	return [
		'provider' => 'openai',
		'default'  => 'balanced',
		'models'   => [
			[
				'key'         => 'fast',
				'label'       => 'Fast / lower cost',
				'description' => 'Best for quick prompt review and short drafting tasks.',
			],
			[
				'key'         => 'balanced',
				'label'       => 'Balanced',
				'description' => 'Default choice for future guided generation assistance.',
			],
			[
				'key'         => 'reasoning',
				'label'       => 'Reasoning',
				'description' => 'Reserved for deeper planning and validation assistance later.',
			],
		],
	];
}

function factory_ai_get_settings(): array {
	$stored = get_option( FACTORY_AI_SETTINGS_OPTION, [] );

	if ( ! is_array( $stored ) ) {
		$stored = [];
	}

	$settings = array_merge( factory_ai_default_settings(), $stored );
	$settings['provider'] = 'openai';
	$settings['selected_model'] = factory_ai_sanitize_model_key( $settings['selected_model'] ?? '' );

	return $settings;
}

function factory_ai_save_settings( array $settings ): void {
	$current = factory_ai_get_settings();
	$next = array_merge( $current, $settings );

	$next['provider'] = 'openai';
	$next['selected_model'] = factory_ai_sanitize_model_key( $next['selected_model'] ?? '' );

	update_option( FACTORY_AI_SETTINGS_OPTION, $next, false );
}

function factory_ai_sanitize_model_key( string $model ): string {
	$model = sanitize_key( $model );
	$allowed = array_map(
		function ( array $model_config ): string {
			return $model_config['key'];
		},
		factory_ai_model_config()['models']
	);

	return in_array( $model, $allowed, true ) ? $model : factory_ai_model_config()['default'];
}

function factory_ai_model_output_allowance( string $model ): int {
	$model = factory_ai_sanitize_model_key( $model );
	$output_by_model = [
		'fast'      => 600,
		'balanced'  => 1200,
		'reasoning' => 2000,
	];

	return $output_by_model[ $model ] ?? $output_by_model['balanced'];
}

function factory_ai_storage_available(): bool {
	return function_exists( 'sodium_crypto_secretbox' )
		&& function_exists( 'sodium_crypto_secretbox_open' )
		&& function_exists( 'random_bytes' )
		&& defined( 'SODIUM_CRYPTO_SECRETBOX_KEYBYTES' )
		&& defined( 'SODIUM_CRYPTO_SECRETBOX_NONCEBYTES' );
}

function factory_ai_encryption_key(): string {
	$material = wp_salt( 'auth' ) . wp_salt( 'secure_auth' ) . wp_salt( 'logged_in' ) . wp_salt( 'nonce' );

	return substr( hash( 'sha256', $material, true ), 0, SODIUM_CRYPTO_SECRETBOX_KEYBYTES );
}

function factory_ai_encrypt_secret( string $secret ): string {
	if ( ! factory_ai_storage_available() || '' === $secret ) {
		return '';
	}

	try {
		$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
	} catch ( Throwable $e ) {
		return '';
	}

	$cipher = sodium_crypto_secretbox( $secret, $nonce, factory_ai_encryption_key() );

	return base64_encode( $nonce . $cipher );
}

function factory_ai_decrypt_secret( string $encrypted ): string {
	if ( ! factory_ai_storage_available() || '' === $encrypted ) {
		return '';
	}

	$raw = base64_decode( $encrypted, true );

	if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
		return '';
	}

	$nonce = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
	$cipher = substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
	$secret = sodium_crypto_secretbox_open( $cipher, $nonce, factory_ai_encryption_key() );

	return is_string( $secret ) ? $secret : '';
}

function factory_ai_resolve_api_key(): array {
	if ( defined( 'FACTORY_OPENAI_API_KEY' ) && is_string( FACTORY_OPENAI_API_KEY ) && '' !== trim( FACTORY_OPENAI_API_KEY ) ) {
		return [
			'key'    => trim( FACTORY_OPENAI_API_KEY ),
			'source' => 'constant',
		];
	}

	$env_key = getenv( 'OPENAI_API_KEY' );

	if ( is_string( $env_key ) && '' !== trim( $env_key ) ) {
		return [
			'key'    => trim( $env_key ),
			'source' => 'env',
		];
	}

	$settings = factory_ai_get_settings();
	$key = factory_ai_decrypt_secret( (string) ( $settings['encrypted_api_key'] ?? '' ) );

	if ( '' !== $key ) {
		return [
			'key'    => $key,
			'source' => 'option',
		];
	}

	return [
		'key'    => '',
		'source' => 'none',
	];
}

function factory_ai_get_key_source(): string {
	return factory_ai_resolve_api_key()['source'];
}

function factory_ai_mask_secret( string $secret ): string {
	$secret = trim( $secret );

	if ( '' === $secret ) {
		return '';
	}

	$prefix = 0 === strpos( $secret, 'sk-' ) ? 'sk-' : '';
	$suffix = substr( $secret, -4 );

	return $prefix . '...' . $suffix;
}

function factory_ai_redact_string( string $value ): string {
	$resolved = factory_ai_resolve_api_key();
	$key = $resolved['key'] ?? '';

	if ( '' === $key ) {
		return $value;
	}

	return str_replace( $key, factory_ai_mask_secret( $key ), $value );
}

function factory_ai_estimate_tokens( string $text, int $estimated_output_tokens = 1200, string $model_profile = 'balanced' ): array {
	$model_profile = factory_ai_sanitize_model_key( $model_profile );
	$prompt_tokens = (int) ceil( strlen( $text ) / 4 );
	$output_tokens = max( 0, $estimated_output_tokens );
	$total_tokens = $prompt_tokens + $output_tokens;
	$warnings = [
		'Local estimate only. No provider call was made.',
		'Cost estimate unavailable until model pricing is configured.',
	];

	return [
		'status'                  => 'ok',
		'provider'                => 'openai',
		'model_profile'           => $model_profile,
		'model'                   => null,
		'currency'                => 'USD',
		'estimate'                => [
			'input_tokens'  => $prompt_tokens,
			'output_tokens' => $output_tokens,
			'total_tokens'  => $total_tokens,
			'cost_min'      => null,
			'cost_max'      => null,
			'is_rough'      => true,
			'method'        => 'character_count_divided_by_4',
		],
		'budget'                  => [
			'limit'      => null,
			'over_limit' => false,
		],
		'warnings'                => $warnings,
		'estimated_prompt_tokens' => $prompt_tokens,
		'estimated_output_tokens' => $output_tokens,
		'estimated_total_tokens'  => $total_tokens,
		'approximate'             => true,
		'method'                  => 'character_count_divided_by_4',
		'selected_model'          => $model_profile,
	];
}

function factory_ai_public_settings(): array {
	$settings = factory_ai_get_settings();
	$resolved = factory_ai_resolve_api_key();
	$key = $resolved['key'] ?? '';
	$key_source = $resolved['source'] ?? 'none';
	$warnings = [];
	$notices = [
		'AI assistance is configured for future workflows. The Real Estate demo generator is deterministic and does not call external AI providers in this beta.',
	];

	if ( ! factory_ai_storage_available() ) {
		$warnings[] = 'Saved API key storage is unavailable because Sodium encryption is not available. Constants or environment variables can still be used.';
	}

	if ( in_array( $key_source, [ 'constant', 'env' ], true ) ) {
		$notices[] = 'API key is provided by server configuration and cannot be edited from this screen.';
	}

	return [
		'provider'          => 'openai',
		'available_models'  => factory_ai_model_config()['models'],
		'selected_model'    => $settings['selected_model'],
		'has_key'           => '' !== $key,
		'key_source'        => $key_source,
		'masked_key'        => factory_ai_mask_secret( $key ),
		'storage_available' => factory_ai_storage_available(),
		'warnings'          => $warnings,
		'notices'           => $notices,
	];
}
