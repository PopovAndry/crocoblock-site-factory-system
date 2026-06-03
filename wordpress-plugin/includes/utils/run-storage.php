<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_get_runs_dir(): string {

	return untrailingslashit( FACTORY_RUNS_DIR );
}

function factory_get_runs_registry_path(): string {

	return factory_get_runs_dir() .
		'/registry.json';
}

function factory_get_runs_registry(): array {

	$path = factory_get_runs_registry_path();

	if ( ! file_exists( $path ) ) {
		return [];
	}

	$data = json_decode(
		file_get_contents( $path ),
		true
	);

	return is_array( $data )
		? $data
		: [];
}

function factory_get_latest_run_name(): ?string {

	$registry = factory_get_runs_registry();

	$latest = $registry['latest'] ?? '';

	return $latest ?: null;
}

function factory_get_run_manifest_path(
	string $file
): string {

	return factory_get_runs_dir() .
		'/' . $file;
}

function factory_get_run_manifest(
	string $file
): ?array {

	$path = factory_get_run_manifest_path(
		$file
	);

	if ( ! file_exists( $path ) ) {
		return null;
	}

	$data = json_decode(
		file_get_contents( $path ),
		true
	);

	return is_array( $data )
		? $data
		: null;
}

function factory_get_latest_run_manifest(): ?array {

	$latest = factory_get_latest_run_name();

	if ( ! $latest ) {
		return null;
	}

	return factory_get_run_manifest(
		$latest
	);
}
