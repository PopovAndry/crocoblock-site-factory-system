<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ai_live_interpret_prompt( string $prompt, array $current_context = [], array $options = [] ): array {
	$prompt        = trim( sanitize_textarea_field( wp_unslash( $prompt ) ) );
	$model_profile = factory_ai_sanitize_model_key( (string) ( $options['model_profile'] ?? factory_ai_get_settings()['selected_model'] ?? 'balanced' ) );

	if ( '' === $prompt ) {
		return factory_ai_live_response(
			[
				'status'        => 'error',
				'code'          => 'empty_prompt',
				'message'       => 'Enter a prompt before requesting live AI suggestions.',
				'model_profile' => $model_profile,
				'warnings'      => [
					'No provider call was made.',
				],
			]
		);
	}

	$provider_result = factory_ai_openai_safe_provider_request(
		[
			'model_profile' => $model_profile,
			'messages'      => factory_ai_live_prompt_messages( $prompt, $current_context ),
		]
	);

	if ( 'ok' !== (string) ( $provider_result['status'] ?? '' ) ) {
		return factory_ai_live_response(
			[
				'status'          => (string) ( $provider_result['status'] ?? 'error' ),
				'code'            => (string) ( $provider_result['code'] ?? 'provider_error' ),
				'message'         => (string) ( $provider_result['message'] ?? 'Live AI suggestions are unavailable.' ),
				'model_profile'   => (string) ( $provider_result['model_profile'] ?? $model_profile ),
				'model'           => (string) ( $provider_result['model'] ?? '' ),
				'provider_called' => (bool) ( $provider_result['provider_called'] ?? false ),
				'warnings'        => array_values( array_unique( array_merge( [ 'No site changes were applied.' ], factory_ai_live_string_list( $provider_result['warnings'] ?? [] ) ) ) ),
				'usage'           => is_array( $provider_result['usage'] ?? null ) ? $provider_result['usage'] : factory_ai_live_default_usage( false, $model_profile, '' ),
			]
		);
	}

	$validated = factory_ai_validate_safe_prompt_interpretation(
		is_array( $provider_result['raw_interpretation'] ?? null ) ? $provider_result['raw_interpretation'] : []
	);

	$warnings = factory_ai_live_string_list( $validated['warnings'] ?? [] );
	$warnings = array_values( array_unique( array_merge( $warnings, factory_ai_live_string_list( $provider_result['warnings'] ?? [] ) ) ) );

	if ( factory_ai_live_suggestions_empty( $validated['preset_variables'] ?? [] ) ) {
		$warnings[] = 'OpenAI returned no safe variable suggestions.';
	}

	return factory_ai_live_response(
		[
			'status'               => factory_ai_live_suggestions_empty( $validated['preset_variables'] ?? [] ) ? 'warning' : 'ok',
			'code'                 => factory_ai_live_suggestions_empty( $validated['preset_variables'] ?? [] ) ? 'safe_suggestions_empty' : 'ok',
			'message'              => factory_ai_live_suggestions_empty( $validated['preset_variables'] ?? [] )
				? 'Live AI returned no safe variables that could be applied to this beta flow.'
				: 'Live AI suggestions are ready for review.',
			'model_profile'        => (string) ( $provider_result['model_profile'] ?? $model_profile ),
			'model'                => (string) ( $provider_result['model'] ?? '' ),
			'provider_called'      => (bool) ( $provider_result['provider_called'] ?? true ),
			'preset_variables'     => $validated['preset_variables'] ?? factory_ai_empty_safe_preset_variables(),
			'suggestions'          => $validated['preset_variables'] ?? factory_ai_empty_safe_preset_variables(),
			'unsupported_requests' => $validated['unsupported_requests'] ?? [],
			'confidence'           => $validated['confidence'] ?? [ 'overall' => 0.0, 'fields' => [] ],
			'warnings'             => $warnings,
			'usage'                => is_array( $provider_result['usage'] ?? null ) ? $provider_result['usage'] : factory_ai_live_default_usage( true, $model_profile, (string) ( $provider_result['model'] ?? '' ) ),
		]
	);
}

function factory_ai_live_prompt_messages( string $prompt, array $current_context = [] ): array {
	$context_summary = [
		'preset'           => 'real-estate',
		'preset_variables' => is_array( $current_context['preset_variables'] ?? null ) ? $current_context['preset_variables'] : factory_ai_empty_safe_preset_variables(),
		'style_context'    => is_array( $current_context['style_context'] ?? null ) ? $current_context['style_context'] : [],
		'image_context'    => is_array( $current_context['image_context'] ?? null ) ? $current_context['image_context'] : [],
	];

	return [
		[
			'role'    => 'system',
			'content' => implode(
				"\n",
				[
					'You are the OpenAI safe suggestion layer for Crocoblock Site Factory.',
					'Return JSON only. Do not wrap JSON in markdown fences.',
					'This is safe_variables_only mode.',
					'Supported vertical: real_estate.',
					'Supported preset: real-estate.',
					'Set applies_changes to false.',
					'Only these preset_variables are allowed: agency_name, hero_title, hero_subtitle, hero_cta_text, contact_title, contact_intro, phone, email.',
					'Do not output HTML, CSS, JavaScript, PHP, WordPress commands, plugin code, blueprint sections, BlueprintCandidate data, BlueprintPatch data, image prompts, property records, CPT changes, taxonomy changes, filter changes, form changes, query changes, layout instructions, or apply instructions.',
					'If the user asks for unsupported things, list them in unsupported_requests with label, reason, and safe_alternative.',
					'Unknown keys must be omitted.',
					'Output JSON with version, mode, applies_changes, vertical, recommended_preset, preset_variables, unsupported_requests, warnings, and confidence.',
				]
			),
		],
		[
			'role'    => 'user',
			'content' => wp_json_encode(
				[
					'task'            => 'Interpret this prompt into safe Real Estate beta copy suggestions only.',
					'prompt'          => $prompt,
					'current_context' => $context_summary,
				],
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
			),
		],
	];
}

function factory_ai_live_response( array $overrides = [] ): array {
	$model_profile = factory_ai_sanitize_model_key( (string) ( $overrides['model_profile'] ?? 'balanced' ) );
	$model         = isset( $overrides['model'] ) && is_string( $overrides['model'] ) ? $overrides['model'] : '';
	$preset_vars   = is_array( $overrides['preset_variables'] ?? null ) ? $overrides['preset_variables'] : factory_ai_empty_safe_preset_variables();

	return [
		'status'               => (string) ( $overrides['status'] ?? 'disabled' ),
		'code'                 => (string) ( $overrides['code'] ?? 'live_ai_not_implemented' ),
		'message'              => (string) ( $overrides['message'] ?? 'Live AI suggestions are not implemented yet. Local safe suggestions are available.' ),
		'provider'             => 'openai',
		'mode'                 => 'safe_variables_only',
		'model_profile'        => $model_profile,
		'model'                => $model,
		'applies_changes'      => false,
		'provider_called'      => (bool) ( $overrides['provider_called'] ?? false ),
		'vertical'             => 'real_estate',
		'recommended_preset'   => 'real-estate',
		'preset_variables'     => $preset_vars,
		'suggestions'          => is_array( $overrides['suggestions'] ?? null ) ? $overrides['suggestions'] : $preset_vars,
		'unsupported_requests' => is_array( $overrides['unsupported_requests'] ?? null ) ? $overrides['unsupported_requests'] : [],
		'warnings'             => factory_ai_live_string_list( $overrides['warnings'] ?? [] ),
		'confidence'           => is_array( $overrides['confidence'] ?? null ) ? $overrides['confidence'] : [ 'overall' => 0.0, 'fields' => factory_ai_live_empty_field_confidence() ],
		'usage'                => is_array( $overrides['usage'] ?? null ) ? $overrides['usage'] : factory_ai_live_default_usage( (bool) ( $overrides['provider_called'] ?? false ), $model_profile, $model ),
	];
}

function factory_ai_empty_safe_preset_variables(): array {
	return [
		'agency_name'   => '',
		'hero_title'    => '',
		'hero_subtitle' => '',
		'hero_cta_text' => '',
		'contact_title' => '',
		'contact_intro' => '',
		'phone'         => '',
		'email'         => '',
	];
}

function factory_ai_live_empty_field_confidence(): array {
	$confidence = [];

	foreach ( array_keys( factory_ai_empty_safe_preset_variables() ) as $field ) {
		$confidence[ $field ] = 0.0;
	}

	return $confidence;
}

function factory_ai_live_default_usage( bool $provider_called, string $model_profile, string $model ): array {
	return [
		'provider_called'   => $provider_called,
		'provider'          => 'openai',
		'model_profile'     => factory_ai_sanitize_model_key( $model_profile ),
		'model'             => $model,
		'input_tokens'      => null,
		'output_tokens'     => null,
		'total_tokens'      => null,
		'cost'              => null,
		'cost_currency'     => 'USD',
		'cost_is_estimated' => false,
	];
}

function factory_ai_live_suggestions_empty( array $preset_variables ): bool {
	foreach ( factory_ai_empty_safe_preset_variables() as $key => $unused ) {
		if ( '' !== trim( (string) ( $preset_variables[ $key ] ?? '' ) ) ) {
			return false;
		}
	}

	return true;
}

function factory_ai_live_string_list( $items ): array {
	$items = is_array( $items ) ? $items : [];
	$list  = [];

	foreach ( $items as $item ) {
		if ( is_string( $item ) && '' !== trim( $item ) ) {
			$list[] = sanitize_text_field( $item );
		}
	}

	return array_values( array_unique( $list ) );
}
