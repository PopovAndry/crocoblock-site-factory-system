<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_update_run_registry( array $manifest ): void {
	$dir = untrailingslashit( FACTORY_RUNS_DIR );

	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}

	if ( ! is_dir( $dir ) || ! is_writable( $dir ) ) {
		throw new RuntimeException( "Factory run registry directory is not writable: {$dir}" );
	}

	$registry_path = $dir . '/registry.json';

	$registry = [
		'latest' => null,
		'runs'   => [],
	];

	if ( file_exists( $registry_path ) ) {
		$decoded = json_decode(
			file_get_contents( $registry_path ),
			true
		);

		if ( is_array( $decoded ) ) {
			$registry = $decoded;
		}
	}

	$file = basename( $manifest['file'] ?? '' );

	if ( ! $file ) {
		return;
	}

	$plan_summary = $manifest['plan']['summary'] ?? [];

	if ( ! is_array( $plan_summary ) ) {
		$plan_summary = [];
	}

	$execution_items = $manifest['execution']['items'] ?? [];

	if ( ! is_array( $execution_items ) ) {
		$execution_items = [];
	}

	$validation_checks = $manifest['validation']['checks'] ?? [];

	if ( ! is_array( $validation_checks ) ) {
		$validation_checks = [];
	}

	$results_summary = $manifest['results']['summary'] ?? [];

	if ( ! is_array( $results_summary ) ) {
		$results_summary = [];
	}

	$entry = [
		'file'             => $file,
		'timestamp'        => $manifest['timestamp'] ?? '',
		'status'           => $manifest['status'] ?? 'unknown',
		'preset'           => $manifest['preset'] ?? null,
		'prompt'           => $manifest['prompt'] ?? '',
		'plan_summary'     => $plan_summary,
		'execution_count'  => count( $execution_items ),
		'validation_count' => count( $validation_checks ),
		'results_summary'  => $results_summary,
	];

	$registry['latest'] = $file;

	array_unshift( $registry['runs'], $entry );

	$registry['runs'] = array_slice( $registry['runs'], 0, 50 );

	$written = file_put_contents(
		$registry_path,
		wp_json_encode(
			$registry,
			JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
		)
	);

	if ( false === $written ) {
		throw new RuntimeException( "Factory run registry could not be written: {$registry_path}" );
	}
}
