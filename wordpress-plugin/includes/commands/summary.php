<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Summary_Command {

	public function __invoke(
		array $args = [],
		array $assoc_args = []
	): void {

		$latest =
			factory_get_latest_run_name();

		if ( ! $latest ) {

			WP_CLI::warning(
				'No factory runs found.'
			);

			return;
		}

		$run =
			factory_get_run_manifest(
				$latest
			);

		if ( ! is_array( $run ) ) {

			WP_CLI::error(
				'Invalid latest run.'
			);
		}

		$blueprint =
			$run['blueprint'] ?? [];

		$current =
			factory_validate_blueprint_state(
				$blueprint,
				false
			);
            $format  = $assoc_args['format'] ?? 'text';
            $is_json = 'json' === $format;

		$state =
			( $current['status'] ?? 'error' )
			=== 'ok'
				? 'IN SYNC'
				: 'DRIFT';

		$cpt_count =
			count(
				$blueprint['cpt'] ?? []
			);

		$taxonomy_count =
			count(
				$blueprint['taxonomies'] ?? []
			);

		$listing_count =
			count(
				$blueprint['listings'] ?? []
			);

		$content_count = 0;

		foreach (
			$blueprint['content'] ?? []
			as $items
		) {

			if ( is_array( $items ) ) {

				$content_count +=
					count( $items );
			}
		}

        if ( $is_json ) {

            WP_CLI::line(
                wp_json_encode(
                    [
                        'status'        => $state,
                        'latest_run'    => $latest,
                        'site'          => $blueprint['site']['name'] ?? '-',
                        'cpt_count'     => $cpt_count,
                        'taxonomy_count'=> $taxonomy_count,
                        'listing_count' => $listing_count,
                        'content_count' => $content_count,
                        'doctor'        => (
                            $state === 'IN SYNC'
                                ? 'healthy'
                                : 'issues detected'
                        ),
                    ],
                    JSON_PRETTY_PRINT |
                    JSON_UNESCAPED_UNICODE
                )
            );

            return;
        }

		WP_CLI::log( '' );
		WP_CLI::log( 'Factory Summary' );
		WP_CLI::log( '' );

		WP_CLI::log(
			'Status: ' . $state
		);

		WP_CLI::log(
			'Latest run: ' . $latest
		);

		WP_CLI::log(
			'Site: ' .
			( $blueprint['site']['name'] ?? '-' )
		);

		WP_CLI::log(
			'CPTs: ' . $cpt_count
		);

		WP_CLI::log(
			'Taxonomies: ' .
			$taxonomy_count
		);

		WP_CLI::log(
			'Listings: ' .
			$listing_count
		);

		WP_CLI::log(
			'Content items: ' .
			$content_count
		);

		WP_CLI::log(
			'Doctor: ' .
			(
				$state === 'IN SYNC'
					? 'healthy'
					: 'issues detected'
			)
		);
	}
}