<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Explain_Command {

	public function __invoke(
		array $args = [],
		array $assoc_args = []
	): void {

		$file = $args[0] ?? 'latest';

		if ( 'latest' === $file ) {
			$file = factory_get_latest_run_name();

			if ( ! $file ) {
				WP_CLI::error(
					'Latest run not found.'
				);
			}
		}

		$run = factory_get_run_manifest( $file );

		if ( ! is_array( $run ) ) {
			WP_CLI::error(
				"Run file not found or invalid: {$file}"
			);
		}

		$blueprint = $run['blueprint'] ?? [];
        $format  = $assoc_args['format'] ?? 'text';
        $is_json = 'json' === $format;

        if ( $is_json ) {

	$result = [
		'site'        => $blueprint['site']['name'] ?? '',
		'cpt'         => [],
		'taxonomies'  => [],
		'listings'    => [],
		'archive'     => null,
		'demo_content'=> [],
	];

	foreach ( $blueprint['cpt'] ?? [] as $cpt ) {

		$item = [
			'slug'  => $cpt['slug'] ?? '',
			'meta'  => [],
		];

		foreach ( $cpt['meta'] ?? [] as $field ) {

			if ( empty( $field['key'] ) ) {
				continue;
			}

			$item['meta'][] = $field['key'];
		}

		$result['cpt'][] = $item;
	}

	foreach ( $blueprint['taxonomies'] ?? [] as $taxonomy ) {

		if ( empty( $taxonomy['slug'] ) ) {
			continue;
		}

		$result['taxonomies'][] =
			$taxonomy['slug'];
	}

	foreach ( $blueprint['listings'] ?? [] as $listing ) {

		if ( empty( $listing['title'] ) ) {
			continue;
		}

		$result['listings'][] =
			$listing['title'];
	}

	$archive =
		$blueprint['pages']['archive']['slug']
		?? '';

	if ( $archive ) {

		$result['archive'] =
			"/{$archive}/";
	}

	foreach ( $blueprint['content'] ?? [] as $items ) {

		if ( ! is_array( $items ) ) {
			continue;
		}

		foreach ( $items as $item ) {

			if ( empty( $item['title'] ) ) {
				continue;
			}

			$result['demo_content'][] =
				$item['title'];
		}
	}

	WP_CLI::line(
		wp_json_encode(
			$result,
			JSON_PRETTY_PRINT |
			JSON_UNESCAPED_UNICODE
		)
	);

	return;
}

		WP_CLI::log( '' );
		WP_CLI::log( 'Factory Explain' );
		WP_CLI::log( '' );

		$site_name =
			$blueprint['site']['name'] ?? 'Unnamed Site';

		WP_CLI::log(
			"This factory run generated:"
		);

		WP_CLI::log( '' );

		WP_CLI::log(
			"- {$site_name}"
		);

		$cpts = $blueprint['cpt'] ?? [];

		foreach ( $cpts as $cpt ) {

			$slug = $cpt['slug'] ?? '';

			if ( ! $slug ) {
				continue;
			}

			WP_CLI::log(
				"- CPT: {$slug}"
			);

			$meta = $cpt['meta'] ?? [];

			if ( ! empty( $meta ) ) {

				WP_CLI::log(
					'  Meta fields:'
				);

				foreach ( $meta as $field ) {

					$key = $field['key'] ?? '';

					if ( ! $key ) {
						continue;
					}

					WP_CLI::log(
						"    - {$key}"
					);
				}
			}
		}

		$taxonomies =
			$blueprint['taxonomies'] ?? [];

		if ( ! empty( $taxonomies ) ) {

			WP_CLI::log( '' );
			WP_CLI::log( 'Taxonomies:' );

			foreach ( $taxonomies as $taxonomy ) {

				$slug =
					$taxonomy['slug'] ?? '';

				if ( ! $slug ) {
					continue;
				}

				WP_CLI::log(
					"- {$slug}"
				);
			}
		}

		$listings =
			$blueprint['listings'] ?? [];

		if ( ! empty( $listings ) ) {

			WP_CLI::log( '' );
			WP_CLI::log( 'Listings:' );

			foreach ( $listings as $listing ) {

				$title =
					$listing['title'] ?? '';

				if ( ! $title ) {
					continue;
				}

				WP_CLI::log(
					"- {$title}"
				);
			}
		}

		$archive =
			$blueprint['pages']['archive'] ?? [];

		if ( ! empty( $archive ) ) {

			$slug =
				$archive['slug'] ?? '';

			if ( $slug ) {

				WP_CLI::log( '' );
				WP_CLI::log(
					'Archive page:'
				);

				WP_CLI::log(
					"- /{$slug}/"
				);
			}
		}

		$content =
			$blueprint['content'] ?? [];

		if ( ! empty( $content ) ) {

			WP_CLI::log( '' );
			WP_CLI::log(
				'Demo content:'
			);

			foreach ( $content as $items ) {

				if ( ! is_array( $items ) ) {
					continue;
				}

				foreach ( $items as $item ) {

					$title =
						$item['title'] ?? '';

					if ( ! $title ) {
						continue;
					}

					WP_CLI::log(
						"- {$title}"
					);
				}
			}
		}
	}
}