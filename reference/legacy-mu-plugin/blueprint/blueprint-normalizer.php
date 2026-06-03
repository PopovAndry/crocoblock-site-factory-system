<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Blueprint_Normalizer {

	public function normalize( array $blueprint ): array {

		$blueprint['version'] = $blueprint['version'] ?? '0.2';

		$blueprint['site'] = $blueprint['site'] ?? [
			'name'      => 'Factory Site',
			'language'  => 'en',
			'permalink' => '/%postname%/',
		];

		$blueprint['plugins'] = $blueprint['plugins'] ?? [];

		$blueprint['cpt'] = $this->normalize_cpt( $blueprint['cpt'] ?? [] );

		$blueprint['taxonomies'] = $this->normalize_taxonomies( $blueprint['taxonomies'] ?? [] );

		$blueprint['content'] = $blueprint['content'] ?? [];

		$blueprint['listings'] = $this->normalize_listings( $blueprint['listings'] ?? [] );

		$blueprint['single'] = $this->normalize_single( $blueprint['single'] ?? [] );

		return $blueprint;
	}

	private function normalize_cpt( array $cpts ): array {

		foreach ( $cpts as &$cpt ) {

			$cpt['slug'] = sanitize_key( $cpt['slug'] ?? '' );

			$cpt['label']    = $cpt['label'] ?? ucfirst( $cpt['slug'] );
			$cpt['singular'] = $cpt['singular'] ?? ucfirst( $cpt['slug'] );

			$cpt['supports'] = $cpt['supports'] ?? [ 'title', 'editor' ];

			$cpt['meta'] = array_map( function ( $meta ) {

				$type = $meta['type'] ?? 'text';

				$type = match ( $type ) {
					'integer' => 'number',
					'bool'    => 'boolean',
					default   => $type,
				};

				return [
					'key'   => sanitize_key( $meta['key'] ?? '' ),
					'type'  => $type,
					'label' => $meta['label'] ?? ucfirst( $meta['key'] ?? '' ),
				];

			}, $cpt['meta'] ?? [] );
		}

		return $cpts;
	}

	private function normalize_taxonomies( array $taxonomies ): array {

	foreach ( $taxonomies as &$tax ) {
		$tax['slug']      = sanitize_key( $tax['slug'] ?? '' );
		$tax['post_type'] = sanitize_key( $tax['post_type'] ?? '' );

		$tax['label']    = $tax['label'] ?? ucfirst( $tax['slug'] );
		$tax['singular'] = $tax['singular'] ?? ucfirst( $tax['slug'] );

		$tax['terms'] = array_values(
			array_filter(
				$tax['terms'] ?? [],
				fn( $term ) => is_string( $term ) && trim( $term ) !== ''
			)
		);
	}

		return $taxonomies;
	}

	private function normalize_listings( array $listings ): array {

		foreach ( $listings as &$listing ) {

			$listing['slug'] = sanitize_title( $listing['slug'] ?? '' );

			$listing['layout'] = $this->normalize_layout( $listing['layout'] ?? [] );
		}

		return $listings;
	}

	private function normalize_single( array $single ): array {

		foreach ( $single as &$config ) {
			$config['layout'] = $this->normalize_layout( $config['layout'] ?? [] );
		}

		return $single;
	}

	private function normalize_layout( array $layout ): array {

		$allowed_types = [ 'title', 'meta', 'content' ];

		$result = [];

		foreach ( $layout as $item ) {

			$type = $item['type'] ?? '';

			if ( ! in_array( $type, $allowed_types, true ) ) {
				continue;
			}

			if ( $type === 'meta' && empty( $item['key'] ) ) {
				continue;
			}

			$result[] = $item;
		}

		return $result;
	}
}