<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Blueprint_Preset_Manager {

	private string $presets_dir = '/var/www/blueprints/presets';
	private string $target_dir  = '/var/www/blueprints/generated';

	public function load_preset( string $preset_slug ): array {
		$preset_slug = sanitize_key( $preset_slug );
		$path        = $this->presets_dir . '/' . $preset_slug . '.json';

		if ( ! file_exists( $path ) ) {
			throw new RuntimeException( "Preset not found: {$preset_slug}" );
		}

		$blueprint = json_decode( file_get_contents( $path ), true );

		if ( ! is_array( $blueprint ) ) {
			throw new RuntimeException( "Invalid preset JSON: {$preset_slug}" );
		}

		$normalizer = new Factory_Blueprint_Normalizer();

		return $normalizer->normalize( $blueprint );
	}

	public function save_generated( string $preset_slug, array $blueprint ): string {
		$preset_slug = sanitize_key( $preset_slug );

		if ( ! is_dir( $this->target_dir ) ) {
			wp_mkdir_p( $this->target_dir );
		}

		$target_path = $this->target_dir . '/' . $preset_slug . '.json';

		file_put_contents(
			$target_path,
			json_encode( $blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
		);

		return $target_path;
	}

	public function list_presets(): array {
		if ( ! is_dir( $this->presets_dir ) ) {
			return [];
		}

		$files = glob( $this->presets_dir . '/*.json' );

		return array_map(
			fn( $file ) => basename( $file, '.json' ),
			$files ?: []
		);
	}
}