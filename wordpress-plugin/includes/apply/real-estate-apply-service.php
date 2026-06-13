<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_apply_real_estate_preset_internal( array $args = [] ): array {
	$source = sanitize_key( (string) ( $args['source'] ?? 'internal' ) );
	$base_blueprint = is_array( $args['base_blueprint'] ?? null ) ? $args['base_blueprint'] : [];

	if ( empty( $base_blueprint ) ) {
		$base_blueprint = factory_rest_load_real_estate_blueprint();
	}

	$prompt_context = factory_real_estate_apply_service_normalize_prompt_context(
		$args['prompt_context'] ?? [],
		$base_blueprint,
		(string) ( $args['fallback_prompt'] ?? 'Internal apply: real-estate' )
	);
	$style_context = factory_real_estate_apply_service_normalize_style_context( $args['style_context'] ?? [] );
	$image_context = factory_real_estate_apply_service_normalize_image_context( $args['image_context'] ?? [], $base_blueprint );
	$blueprint = factory_rest_apply_real_estate_preset_variables( $base_blueprint, $prompt_context['applied_variables'] );
	$blueprint = factory_rest_apply_real_estate_style_tokens( $blueprint, $style_context['tokens'] );
	$prompt = $prompt_context['prompt'];
	$dependencies = factory_rest_get_real_estate_dependency_status();

	if ( empty( $dependencies['ready'] ) ) {
		return [
			'ok'           => false,
			'error_code'   => 'dependencies_not_ready',
			'error_message'=> 'Real Estate dependencies are missing or inactive.',
			'http_status'  => 409,
			'dependencies' => $dependencies,
			'source'       => $source,
		];
	}

	if ( function_exists( 'factory_reset_diff_report' ) ) {
		factory_reset_diff_report();
	}

	$execution = factory_apply_blueprint( $blueprint );
	$plan      = factory_rest_build_plan( $blueprint );
	$report    = factory_validate_blueprint_state( $blueprint, false );
	$manifest_metadata = [
		'prompt_context' => $prompt_context,
		'style_context'  => $style_context,
		'image_context'  => $image_context,
		'apply_source'   => $source,
	];

	if ( is_array( $args['manifest_metadata'] ?? null ) ) {
		$manifest_metadata = array_merge( $manifest_metadata, $args['manifest_metadata'] );
	}

	$manifest_path = factory_save_run_manifest(
		$prompt,
		'real-estate',
		$blueprint,
		$plan,
		$report,
		$report['status'] ?? 'error',
		$execution,
		$manifest_metadata
	);

	$results = function_exists( 'factory_build_manifest_results' )
		? factory_build_manifest_results( $report )
		: [
			'summary' => [
				'ok'      => 0,
				'warning' => 0,
				'error'   => 0,
			],
		];

	return [
		'ok'             => true,
		'source'         => $source,
		'dependencies'   => $dependencies,
		'blueprint'      => $blueprint,
		'prompt_context' => $prompt_context,
		'style_context'  => $style_context,
		'image_context'  => $image_context,
		'prompt'         => $prompt,
		'plan'           => $plan,
		'report'         => $report,
		'execution'      => $execution,
		'manifest_path'  => $manifest_path,
		'results'        => $results,
		'response'       => [
			'status'            => $report['status'] ?? 'error',
			'message'           => 'Real Estate preset applied.',
			'preset'            => 'real-estate',
			'prompt'            => $prompt,
			'preset_variables'  => $prompt_context['preset_variables'],
			'applied_variables' => $prompt_context['applied_variables'],
			'prompt_notes'      => $prompt_context['notes'],
			'style_context'     => $style_context['context'],
			'style_tokens'      => $style_context['tokens'],
			'image_context'     => $image_context['context'],
			'image_notes'       => $image_context['notes'],
			'file'              => basename( $manifest_path ),
			'plan_summary'      => $plan['summary'] ?? [],
			'execution_count'   => count( $execution ),
			'validation_count'  => count( $report['checks'] ?? [] ),
			'results_summary'   => $results['summary'] ?? [],
		],
	];
}

function factory_real_estate_apply_service_normalize_prompt_context( $prompt_context, array $base_blueprint, string $fallback_prompt ): array {
	if ( ! is_array( $prompt_context ) ) {
		$prompt_context = [];
	}

	$defaults = factory_rest_get_real_estate_variable_defaults( $base_blueprint );
	$allowed  = factory_rest_get_real_estate_variable_schema();
	$received_sanitized = is_array( $prompt_context['preset_variables'] ?? null ) ? $prompt_context['preset_variables'] : [];
	$received_applied   = is_array( $prompt_context['applied_variables'] ?? null ) ? $prompt_context['applied_variables'] : [];
	$notes              = factory_real_estate_apply_service_text_list(
		$prompt_context['notes'] ?? [
			'Prepared Real Estate preset is used as the base.',
			'Only whitelisted copy fields are overlaid.',
			'No schema, filters, forms, property data, media, or page topology changes are applied.',
		],
		220
	);
	$sanitized = [];
	$applied   = [];

	foreach ( $allowed as $key => $schema ) {
		$default = $defaults[ $key ] ?? '';
		$sanitized_value = factory_rest_sanitize_preset_variable( $received_sanitized[ $key ] ?? $default, $schema );
		$applied_value   = factory_rest_sanitize_preset_variable( $received_applied[ $key ] ?? $sanitized_value, $schema );

		if ( '' === $sanitized_value ) {
			$sanitized_value = $default;
		}

		if ( '' === $applied_value ) {
			$applied_value = $sanitized_value;
		}

		$sanitized[ $key ] = $sanitized_value;
		$applied[ $key ]   = $applied_value;
	}

	$prompt = $prompt_context['prompt'] ?? $fallback_prompt;

	if ( is_array( $prompt ) || is_object( $prompt ) ) {
		$prompt = $fallback_prompt;
	}

	$prompt = is_string( $prompt ) || is_numeric( $prompt ) ? sanitize_textarea_field( wp_unslash( (string) $prompt ) ) : $fallback_prompt;
	$prompt = trim( $prompt );

	if ( '' === $prompt ) {
		$prompt = $fallback_prompt;
	}

	return [
		'prompt'            => $prompt,
		'preset_variables'  => $sanitized,
		'applied_variables' => $applied,
		'notes'             => $notes,
	];
}

function factory_real_estate_apply_service_normalize_style_context( $style_context ): array {
	if ( ! is_array( $style_context ) ) {
		$style_context = [];
	}

	$context = is_array( $style_context['context'] ?? null ) ? $style_context['context'] : [];
	$tokens  = is_array( $style_context['tokens'] ?? null ) ? $style_context['tokens'] : [];
	$tones   = [ 'premium', 'minimal', 'modern', 'corporate', 'warm' ];
	$presets = [ 'turquoise', 'blue', 'green', 'beige' ];
	$tone    = sanitize_key( (string) ( $context['tone'] ?? $tokens['tone'] ?? 'premium' ) );
	$primary_preset = sanitize_key( (string) ( $context['primary_preset'] ?? $tokens['primary_preset'] ?? 'turquoise' ) );
	$notes = factory_real_estate_apply_service_text_list(
		$style_context['notes'] ?? [
			'Factory design tokens are deterministic; no AI palette generation is used.',
			'No Kava Customizer, Elementor Global Colors, typography, image, schema, filter, form, or layout changes are applied.',
		],
		220
	);

	if ( ! in_array( $tone, $tones, true ) ) {
		$tone = 'premium';
	}

	if ( ! in_array( $primary_preset, $presets, true ) ) {
		$primary_preset = 'turquoise';
	}

	$context = [
		'tone'           => $tone,
		'primary_preset' => $primary_preset,
	];

	return [
		'context' => $context,
		'tokens'  => factory_rest_derive_real_estate_style_tokens( $context ),
		'notes'   => $notes,
	];
}

function factory_real_estate_apply_service_normalize_image_context( $image_context, array $base_blueprint ): array {
	if ( ! is_array( $image_context ) ) {
		$image_context = [];
	}

	$context = is_array( $image_context['context'] ?? null ) ? $image_context['context'] : [];
	$source  = sanitize_key( (string) ( $context['source'] ?? 'demo_pool' ) );
	$mode    = sanitize_key( (string) ( $context['mode'] ?? 'round_robin' ) );
	$notes   = factory_real_estate_apply_service_text_list(
		$image_context['notes'] ?? [
			'Using bundled real estate image pools.',
			'Images are assigned as featured images for property cards and single pages.',
			'No uploads, Media Library picker, external image API, or AI image generation is used.',
		],
		220
	);

	if ( 'demo_pool' !== $source ) {
		$source = 'demo_pool';
	}

	if ( 'round_robin' !== $mode ) {
		$mode = 'round_robin';
	}

	$pools = [];
	$asset_pools = $base_blueprint['site']['assets']['property_images'] ?? [];

	if ( is_array( $asset_pools ) ) {
		foreach ( $asset_pools as $type => $sources ) {
			if ( ! is_string( $type ) || '' === trim( $type ) ) {
				continue;
			}

			$pools[ $type ] = is_array( $sources )
				? count(
					array_filter(
						$sources,
						static function ( $source_path ) {
							return is_string( $source_path ) && '' !== trim( $source_path );
						}
					)
				)
				: ( is_string( $sources ) && '' !== trim( $sources ) ? 1 : 0 );
		}
	}

	return [
		'context' => [
			'source' => $source,
			'mode'   => $mode,
			'pools'  => $pools,
		],
		'notes'   => $notes,
	];
}

function factory_real_estate_apply_service_text_list( $items, int $max ): array {
	$items = is_array( $items ) ? $items : [];
	$normalized = [];

	foreach ( $items as $item ) {
		if ( is_array( $item ) || is_object( $item ) ) {
			continue;
		}

		$text = sanitize_text_field( wp_unslash( (string) $item ) );
		$text = trim( $text );

		if ( '' === $text ) {
			continue;
		}

		if ( function_exists( 'mb_substr' ) ) {
			$text = mb_substr( $text, 0, $max );
		} else {
			$text = substr( $text, 0, $max );
		}

		$normalized[] = $text;
	}

	return array_values( array_unique( $normalized ) );
}
