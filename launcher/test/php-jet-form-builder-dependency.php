<?php

define( 'ABSPATH', __DIR__ );

$fixture_plugins = [];
$fixture_active  = [];

function get_plugins(): array {
	global $fixture_plugins;

	return $fixture_plugins;
}

function is_plugin_active( string $basename ): bool {
	global $fixture_active;

	return ! empty( $fixture_active[ $basename ] );
}

require_once dirname( __DIR__, 2 ) . '/wordpress-plugin/includes/console/dependency-status.php';

$definition = null;
foreach ( factory_console_dependency_definitions() as $candidate ) {
	if ( 'jet-form-builder' === $candidate['slug'] ) {
		$definition = $candidate;
		break;
	}
}

if ( ! is_array( $definition ) ) {
	fwrite( STDERR, "JetFormBuilder definition is missing.\n" );
	exit( 1 );
}

function fixture_status( array $plugins, array $active, array $definition ): array {
	global $fixture_plugins, $fixture_active;

	$fixture_plugins = $plugins;
	$fixture_active  = $active;
	$status          = factory_console_plugin_dependency_status( $definition );

	return [
		'installed' => $status['installed'],
		'active'    => $status['active'],
		'version'   => $status['version'],
		'status'    => $status['status'],
	];
}

$native_basename = 'jetformbuilder/jet-form-builder.php';

echo json_encode(
	[
		'definition'   => [
			'slug'                     => $definition['slug'],
			'required_for_real_estate' => $definition['required_for_real_estate'],
			'plugin_basenames'         => $definition['plugin_basenames'],
			'plugin_dirs'              => $definition['plugin_dirs'],
		],
		'active'       => fixture_status( [ $native_basename => [ 'Version' => '3.6.5.1' ] ], [ $native_basename => true ], $definition ),
		'inactive'     => fixture_status( [ $native_basename => [ 'Version' => '3.6.5.1' ] ], [], $definition ),
		'missing'      => fixture_status( [], [], $definition ),
		'legacy_alias' => fixture_status( [ 'jet-form-builder/jet-form-builder.php' => [ 'Version' => '3.6.5.1' ] ], [ 'jet-form-builder/jet-form-builder.php' => true ], $definition ),
	],
	JSON_UNESCAPED_SLASHES
);
