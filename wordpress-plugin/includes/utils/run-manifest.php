<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_save_run_manifest(
	string $prompt,
	?string $preset,
	array $blueprint,
	array $plan,
	array $validation,
	string $status = 'success',
	array $execution = [],
	array $context = []
): string {

	$status = factory_resolve_run_status_from_validation( $validation );

	$dir = untrailingslashit( FACTORY_RUNS_DIR );

	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}

	$timestamp = current_time( 'Ymd-His' );

	$path = trailingslashit( $dir ) .
		"run-{$timestamp}.json";

	$data = [
		'timestamp'  => current_time( 'mysql' ),
		'prompt'     => $prompt,
		'preset'     => $preset,
		'status'     => $status,

		'blueprint'  => $blueprint,
		'plan'       => $plan,
		'validation' => $validation,
		'results'    => factory_build_manifest_results( $validation ),
		'execution'  => factory_build_manifest_execution( $execution ),
	];

	if ( ! empty( $context ) ) {
		$data = array_merge( $data, $context );
	}

	file_put_contents(
		$path,
		wp_json_encode(
			$data,
			JSON_PRETTY_PRINT |
			JSON_UNESCAPED_UNICODE
		)
	);

	$manifest = $data;
	$manifest['file'] = $path;

	if ( function_exists( 'factory_update_run_registry' ) ) {
		factory_update_run_registry( $manifest );
	}

	return $path;
}

function factory_resolve_run_status_from_validation( array $validation ): string {
	$checks = $validation['checks'] ?? null;

	if ( ! is_array( $checks ) ) {
		return 'error';
	}

	if ( empty( $checks ) ) {
		return 'warning';
	}

	$has_warning = false;

	foreach ( $checks as $check ) {
		if ( ! is_array( $check ) ) {
			$has_warning = true;
			continue;
		}

		$status = $check['status'] ?? null;

		if ( 'error' === $status ) {
			return 'error';
		}

		if ( 'warning' === $status ) {
			$has_warning = true;
			continue;
		}

		if ( 'ok' === $status ) {
			continue;
		}

		$has_warning = true;
	}

	return $has_warning ? 'warning' : 'ok';
}

function factory_build_manifest_results( array $validation ): array {
	$results = [
		'version' => 1,
		'source'  => 'validation',
		'summary' => [
			'ok'      => 0,
			'warning' => 0,
			'error'   => 0,
		],
		'items'   => [],
	];

	$checks = $validation['checks'] ?? [];

	if ( ! is_array( $checks ) ) {
		return $results;
	}

	foreach ( $checks as $check ) {
		if ( ! is_array( $check ) ) {
			continue;
		}

		$status = $check['status'] ?? '';

		if ( ! in_array( $status, [ 'ok', 'warning', 'error' ], true ) ) {
			continue;
		}

		$results['summary'][ $status ]++;
		$results['items'][] = [
			'stage'   => 'validation',
			'status'  => $status,
			'type'    => 'validation',
			'entity'  => '',
			'message' => $check['message'] ?? '',
			'details' => [],
		];
	}

	return $results;
}

function factory_build_manifest_execution( array $items ): array {
	return [
		'version' => 1,
		'items'   => array_values( $items ),
	];
}
