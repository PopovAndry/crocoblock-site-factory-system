<?php

require __DIR__ . '/../../wordpress-plugin/includes/runtime-binding.php';

function runtime_binding_case( $raw ): array {
	return is_string( $raw )
		? factory_runtime_binding_v1_parse( $raw )
		: [ 'ok' => false, 'code' => 'runtime_binding_invalid' ];
}

$valid = [
	'schema_version' => 1,
	'binding_kind'   => 'server_owned_runtime_binding',
	'project_id'     => '123e4567-e89b-12d3-a456-426614174000',
	'project_slug'   => 'runtime-binding-test',
];

$extra = $valid;
$extra['unexpected'] = true;
$invalid_uuid = $valid;
$invalid_uuid['project_id'] = 'not-a-project-id';

echo json_encode( [
	'valid'        => runtime_binding_case( json_encode( $valid ) ),
	'extra'        => runtime_binding_case( json_encode( $extra ) ),
	'invalid_uuid' => runtime_binding_case( json_encode( $invalid_uuid ) ),
	'malformed'    => runtime_binding_case( '{not-json' ),
	'oversize'     => runtime_binding_case( str_repeat( 'x', FACTORY_RUNTIME_BINDING_V1_MAX_BYTES + 1 ) ),
	'non_string'   => runtime_binding_case( [ 'not' => 'a string' ] ),
] );
