<?php

const FACTORY_RUNTIME_BINDING_V1_PATH = '/run/csf/project-binding.json';
const FACTORY_RUNTIME_BINDING_V1_MAX_BYTES = 16384;

function factory_runtime_binding_v1_result( bool $ok, string $code, array $binding = [] ): array {
	return $ok ? [ 'ok' => true, 'binding' => $binding ] : [ 'ok' => false, 'code' => $code ];
}

function factory_runtime_binding_v1_exact_keys( array $value, array $expected ): bool {
	$actual = array_keys( $value );
	sort( $actual );
	sort( $expected );
	return $actual === $expected;
}

function factory_runtime_binding_v1_parse( string $raw ): array {
	if ( '' === $raw || strlen( $raw ) > FACTORY_RUNTIME_BINDING_V1_MAX_BYTES ) {
		return factory_runtime_binding_v1_result( false, 'runtime_binding_invalid' );
	}

	try {
		$binding = json_decode( $raw, true, 16, JSON_THROW_ON_ERROR );
	} catch ( Throwable $error ) {
		return factory_runtime_binding_v1_result( false, 'runtime_binding_invalid' );
	}

	if ( ! is_array( $binding )
		|| ! factory_runtime_binding_v1_exact_keys( $binding, [ 'schema_version', 'binding_kind', 'project_id', 'project_slug' ] )
		|| 1 !== $binding['schema_version']
		|| 'server_owned_runtime_binding' !== $binding['binding_kind']
		|| ! is_string( $binding['project_id'] )
		|| ! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $binding['project_id'] )
		|| ! is_string( $binding['project_slug'] )
		|| ! preg_match( '/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $binding['project_slug'] ) ) {
		return factory_runtime_binding_v1_result( false, 'runtime_binding_invalid' );
	}

	return factory_runtime_binding_v1_result( true, 'runtime_binding_ready', [
		'schema_version' => 1,
		'binding_kind'   => 'server_owned_runtime_binding',
		'project_id'     => $binding['project_id'],
		'project_slug'   => $binding['project_slug'],
	] );
}

function factory_runtime_binding_v1_read(): array {
	$size = @filesize( FACTORY_RUNTIME_BINDING_V1_PATH );
	if ( false === $size ) {
		return factory_runtime_binding_v1_result( false, 'runtime_binding_missing' );
	}
	if ( $size < 1 || $size > FACTORY_RUNTIME_BINDING_V1_MAX_BYTES ) {
		return factory_runtime_binding_v1_result( false, 'runtime_binding_invalid' );
	}

	$raw = @file_get_contents( FACTORY_RUNTIME_BINDING_V1_PATH );
	if ( ! is_string( $raw ) || strlen( $raw ) !== $size ) {
		return factory_runtime_binding_v1_result( false, 'runtime_binding_invalid' );
	}

	return factory_runtime_binding_v1_parse( $raw );
}
