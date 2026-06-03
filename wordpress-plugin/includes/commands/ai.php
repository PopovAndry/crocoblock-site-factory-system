<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_AI_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {
		$cache_enabled = (bool) WP_CLI\Utils\get_flag_value( $assoc_args, 'cache', true );
		$no_cache      = ! $cache_enabled || $this->get_bool_flag( $assoc_args, 'no-cache' );
		$debug_cache   = $this->get_bool_flag( $assoc_args, 'debug-cache' );

		$prompt = trim( implode( ' ', $args ) );

		if ( empty( $prompt ) ) {
			WP_CLI::error( 'Please provide a prompt.' );
		}

		$preset = $this->detect_preset( $prompt );

		$cache_version = 'v3';
		$model         = 'gpt-4.1-mini';
		$cache_key     = md5( $cache_version . '|' . $model . '|' . ( $preset ?? 'no-preset' ) . '|' . $prompt );
		$cache_dir     = FACTORY_BLUEPRINT_CACHE_DIR;
		$cache_path    = "{$cache_dir}/{$cache_key}.json";

		if ( $debug_cache ) {
			WP_CLI::log( 'Cache debug enabled.' );
			WP_CLI::log( 'Cache mode: ' . ( $no_cache ? 'disabled' : 'enabled' ) );
			WP_CLI::log( "Cache key: {$cache_key}" );
			WP_CLI::log( "Cache path: {$cache_path}" );
		}

		$blueprint      = null;
		$base_blueprint = null;

		if ( ! $no_cache && file_exists( $cache_path ) ) {
			WP_CLI::log( 'Blueprint loaded from cache.' );

			if ( $debug_cache ) {
				WP_CLI::log( 'Cache status: hit' );
			}

			$cached_blueprint = json_decode( file_get_contents( $cache_path ), true );

			if ( is_array( $cached_blueprint ) ) {
				$blueprint = $cached_blueprint;
			} else {
				WP_CLI::warning( 'Invalid cache, regenerating...' );
			}
		}

		if ( $debug_cache && ! is_array( $blueprint ) ) {
			WP_CLI::log(
				$no_cache
					? 'Cache status: bypassed by --no-cache'
					: 'Cache status: miss'
			);
		}

		if ( ! is_array( $blueprint ) && $preset ) {
			WP_CLI::log( "Detected preset: {$preset}" );

			try {
				$manager        = new Factory_Blueprint_Preset_Manager();
				$base_blueprint = $manager->load_preset( $preset );

				if ( ! is_array( $base_blueprint ) ) {
					WP_CLI::warning( 'Preset did not return a valid blueprint. Fallback to AI generation.' );
					$base_blueprint = null;
				} else {
					WP_CLI::log( 'Preset loaded as base blueprint.' );
				}
			} catch ( Throwable $e ) {
				WP_CLI::warning( 'Preset load failed, fallback to AI: ' . $e->getMessage() );
				$base_blueprint = null;
			}
		}

		if ( ! is_array( $blueprint ) ) {
			WP_CLI::log(
				is_array( $base_blueprint )
					? 'Enhancing preset blueprint via AI...'
					: 'Generating blueprint via AI...'
			);

			$api_key = getenv( 'OPENAI_API_KEY' );

			if ( ! $api_key ) {
				WP_CLI::error( 'OPENAI_API_KEY not set.' );
			}

			$system_prompt = <<<SYS
You work with WordPress blueprints for Crocoblock Site Factory.

Return ONLY valid JSON. No markdown. No explanation.

If the user provides an existing blueprint, modify it according to the user request and return the resulting blueprint JSON.

If no existing blueprint is provided, generate a full blueprint from scratch.

The blueprint must follow this structure:

{
  "version": "0.2",
  "site": {
    "name": "Site name",
    "language": "en",
    "permalink": "/%postname%/"
  },
  "cpt": [
    {
      "slug": "job",
      "label": "Jobs",
      "singular": "Job",
      "supports": ["title", "editor"],
      "meta": [
        { "key": "salary", "type": "number", "label": "Salary" },
        { "key": "location", "type": "text", "label": "Location" }
      ]
    }
  ],
  "taxonomies": [
    {
      "slug": "job_type",
      "label": "Job Types",
      "singular": "Job Type",
      "post_type": "job",
      "terms": ["Full-time", "Part-time", "Remote"]
    }
  ],
  "listings": [
    {
      "slug": "job-card",
      "title": "Job Card",
      "post_type": "job",
      "fields": ["title", "salary", "location"]
    }
  ],
  "pages": {
    "archive": {
      "post_type": "job",
      "slug": "jobs",
      "title": "Jobs"
    }
  },
  "content": {
    "job": [
      {
        "title": "Frontend Developer",
        "content": "We are looking for a frontend developer.",
        "meta": {
          "salary": 3000,
          "location": "Berlin"
        },
        "terms": {
          "job_type": ["Full-time"]
        }
      },
      {
        "title": "Backend Developer",
        "content": "We are looking for a backend developer.",
        "meta": {
          "salary": 4000,
          "location": "Munich"
        },
        "terms": {
          "job_type": ["Full-time"]
        }
      }
    ]
  }
}

Rules:
- Use lowercase slugs.
- Use snake_case for meta keys and taxonomy slugs.
- Always include site, cpt, content.
- If the site needs archive output, include pages.archive.
- If the site uses repeatable cards, include listings.
- If content has categories or types, include taxonomies and terms.
- If modifying an existing blueprint, preserve existing CPTs, meta fields, taxonomies, listings, pages, and content unless the user explicitly asks to remove them.
- If the user asks to add a field, add it to CPT meta, listings fields, and demo content meta.
- If the user asks to customize a job board, preserve salary and location unless explicitly asked to remove them.

Hard requirements:
- Never return empty content arrays.
- For every CPT, generate at least 2 demo content items.
- Every content item must include title, content, meta values for all declared meta fields.
- If taxonomies are defined, every content item must include matching terms.
- Always include listings for each CPT.
- Always include pages.archive for the main CPT.
- For job board requests, include job_type taxonomy with Full-time, Part-time, Remote terms.
- For job board requests, include at least Frontend Developer and Backend Developer demo jobs.
SYS;

			$user_content = $prompt;

			if ( is_array( $base_blueprint ) ) {
				$user_content =
					"Modify this existing blueprint:\n\n" .
					json_encode( $base_blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ) .
					"\n\nUser request:\n" .
					$prompt;
			}

			$payload = [
				'model'       => $model,
				'messages'    => [
					[
						'role'    => 'system',
						'content' => $system_prompt,
					],
					[
						'role'    => 'user',
						'content' => $user_content,
					],
				],
				'temperature' => 0.2,
			];

			$response = wp_remote_post(
				'https://api.openai.com/v1/chat/completions',
				[
					'headers' => [
						'Authorization' => 'Bearer ' . $api_key,
						'Content-Type'  => 'application/json',
					],
					'body'    => json_encode( $payload ),
					'timeout' => 60,
				]
			);

			if ( is_wp_error( $response ) ) {
				WP_CLI::error( $response->get_error_message() );
			}

			$status_code = wp_remote_retrieve_response_code( $response );
			$raw_body    = wp_remote_retrieve_body( $response );
			$body        = json_decode( $raw_body, true );

			if ( $status_code < 200 || $status_code >= 300 ) {
				$message = $body['error']['message'] ?? $raw_body;
				WP_CLI::error( "OpenAI API error: {$message}" );
			}

			$content = $body['choices'][0]['message']['content'] ?? '';

			if ( ! $content ) {
				WP_CLI::error( 'Empty response from AI.' );
			}

			$content      = $this->clean_json_response( $content );
			$ai_blueprint = json_decode( $content, true );

			if ( ! is_array( $ai_blueprint ) ) {
				WP_CLI::log( 'Raw AI response:' );
				WP_CLI::log( $content );
				WP_CLI::error( 'Invalid JSON returned from AI.' );
			}

			if ( is_array( $base_blueprint ) ) {
				$blueprint = $this->merge_blueprints( $base_blueprint, $ai_blueprint );
				WP_CLI::log( 'Preset blueprint merged with AI result.' );
			} else {
				$blueprint = $ai_blueprint;
			}

			$this->cache_blueprint(
				$blueprint,
				$cache_dir,
				$cache_path,
				$no_cache,
				$debug_cache
			);
		}

		$this->validate_blueprint_before_apply( $blueprint );

		if ( ! is_dir( FACTORY_GENERATED_BLUEPRINTS_DIR ) ) {
			wp_mkdir_p( FACTORY_GENERATED_BLUEPRINTS_DIR );
		}

		$path = FACTORY_GENERATED_BLUEPRINTS_DIR . 'ai-blueprint.json';

		file_put_contents(
			$path,
			json_encode( $blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE )
		);

		WP_CLI::success( "Blueprint saved: {$path}" );

		WP_CLI::log( 'Creating pre-apply snapshot...' );

		$snapshot = new Factory_Snapshot_Command();
		$snapshot->create(
			[],
			[
				'type'   => 'pre_apply',
				'source' => 'ai',
			]
		);

		factory_reset_diff_report();

		WP_CLI::log( 'Applying blueprint...' );
		$execution = factory_apply_blueprint( $blueprint );

		factory_log_diff_report();

		WP_CLI::success( "Factory AI blueprint applied: {$path}" );

		WP_CLI::log( '' );
		WP_CLI::log( 'Running dry-run...' );

		if ( ! is_dir( FACTORY_REPORTS_DIR ) ) {
			wp_mkdir_p( FACTORY_REPORTS_DIR );
		}

		$plan_path = FACTORY_REPORTS_DIR . 'factory-plan.json';

		$dry_run = new Factory_Dry_Run_Command();

		$dry_run->__invoke(
			[ $path ],
			[
				'format'      => 'json',
				'output-file' => $plan_path,
			]
		);

		WP_CLI::success(
			"Execution plan saved: {$plan_path}"
		);

		WP_CLI::log( '' );
		WP_CLI::log( 'Running validation...' );

		$report = factory_validate_blueprint_state(
			$blueprint,
			true
		);
		$plan = json_decode(
		file_get_contents( $plan_path ),
		true
		);

		$manifest_path = factory_save_run_manifest(
			$prompt,
			$preset,
			$blueprint,
			$plan,
			$report,
			'ok',
			$execution
		);

		WP_CLI::success(
			"Run manifest saved: {$manifest_path}"
		);

		if ( ( $report['status'] ?? 'error' ) !== 'ok' ) {
			WP_CLI::warning(
				'Validation failed after apply. Starting auto-rollback...'
			);

			$rollback = new Factory_Rollback_Command();

			$rollback->__invoke(
				[ 'latest' ],
				[]
			);

			WP_CLI::error(
				'AI apply failed. System rolled back to latest snapshot.'
			);
		}

		WP_CLI::success(
			'AI pipeline completed: apply → plan → validate'
		);
	}

	private function get_bool_flag( array $assoc_args, string $flag ): bool {
		if ( ! array_key_exists( $flag, $assoc_args ) ) {
			return false;
		}

		$value = WP_CLI\Utils\get_flag_value( $assoc_args, $flag, true );

		if ( is_bool( $value ) ) {
			return $value;
		}

		if ( is_string( $value ) ) {
			$value = strtolower( trim( $value ) );

			return ! in_array( $value, [ '0', 'false', 'no', 'off' ], true );
		}

		return (bool) $value;
	}

	private function detect_preset( string $prompt ): ?string {
		if ( stripos( $prompt, 'job' ) !== false ) {
			return 'job-board';
		}

		if (
			stripos( $prompt, 'real estate' ) !== false ||
			stripos( $prompt, 'property' ) !== false ||
			stripos( $prompt, 'properties' ) !== false
		) {
			return 'real-estate';
		}

		return null;
	}

	private function clean_json_response( string $content ): string {
		$content = trim( $content );
		$content = preg_replace( '/^```json\s*/', '', $content );
		$content = preg_replace( '/^```\s*/', '', $content );
		$content = preg_replace( '/\s*```$/', '', $content );

		return trim( $content );
	}

	private function merge_blueprints( array $base, array $override ): array {
		$merged = $base;

		foreach ( [ 'version', 'site', 'theme', 'pages', 'single' ] as $key ) {
			if ( array_key_exists( $key, $override ) ) {
				$merged[ $key ] = is_array( $override[ $key ] ) && isset( $merged[ $key ] ) && is_array( $merged[ $key ] )
					? array_replace_recursive( $merged[ $key ], $override[ $key ] )
					: $override[ $key ];
			}
		}

		if ( isset( $override['plugins'] ) && is_array( $override['plugins'] ) ) {
			$merged['plugins'] = $this->merge_list_by_key(
				$base['plugins'] ?? [],
				$override['plugins'],
				'slug'
			);
		}

		if ( isset( $override['cpt'] ) && is_array( $override['cpt'] ) ) {
			$merged['cpt'] = $this->merge_list_by_key(
				$base['cpt'] ?? [],
				$override['cpt'],
				'slug',
				[ $this, 'merge_cpt_item' ]
			);
		}

		if ( isset( $override['taxonomies'] ) && is_array( $override['taxonomies'] ) ) {
			$merged['taxonomies'] = $this->merge_list_by_key(
				$base['taxonomies'] ?? [],
				$override['taxonomies'],
				'slug',
				[ $this, 'merge_taxonomy_item' ]
			);
		}

		if ( isset( $override['listings'] ) && is_array( $override['listings'] ) ) {
			$merged['listings'] = $this->merge_list_by_key(
				$base['listings'] ?? [],
				$override['listings'],
				'slug'
			);
		}

		if ( isset( $override['content'] ) && is_array( $override['content'] ) ) {
			$merged['content'] = $this->merge_content(
				$base['content'] ?? [],
				$override['content']
			);
		}

		return $merged;
	}

	private function merge_cpt_item( array $base, array $override ): array {
		$merged = array_replace_recursive( $base, $override );

		if ( isset( $override['meta'] ) && is_array( $override['meta'] ) ) {
			$merged['meta'] = $this->merge_list_by_key(
				$base['meta'] ?? [],
				$override['meta'],
				'key'
			);
		}

		return $merged;
	}

	private function merge_taxonomy_item( array $base, array $override ): array {
		$merged = array_replace_recursive( $base, $override );

		if ( isset( $override['terms'] ) && is_array( $override['terms'] ) ) {
			$terms = array_values(
				array_unique(
					array_merge(
						$this->normalize_string_list( $base['terms'] ?? [] ),
						$this->normalize_string_list( $override['terms'] )
					)
				)
			);

			$merged['terms'] = $terms;
		}

		return $merged;
	}

	private function merge_content( array $base, array $override ): array {
		$merged = $base;

		foreach ( $override as $post_type => $items ) {
			if ( ! is_array( $items ) ) {
				$merged[ $post_type ] = $items;
				continue;
			}

			$merged[ $post_type ] = $this->merge_list_by_key(
				$base[ $post_type ] ?? [],
				$items,
				'title',
				[ $this, 'merge_content_item' ]
			);
		}

		return $merged;
	}

	private function merge_content_item( array $base, array $override ): array {
		$merged = array_replace_recursive( $base, $override );

		if ( isset( $override['meta'] ) && is_array( $override['meta'] ) ) {
			$merged['meta'] = array_replace_recursive(
				$base['meta'] ?? [],
				$override['meta']
			);
		}

		if ( isset( $override['terms'] ) && is_array( $override['terms'] ) ) {
			$merged['terms'] = array_replace_recursive(
				$base['terms'] ?? [],
				$override['terms']
			);
		}

		return $merged;
	}

	private function merge_list_by_key(
		array $base,
		array $override,
		string $key,
		?callable $item_merger = null
	): array {
		$indexed = [];
		$order   = [];

		foreach ( $base as $item ) {
			if ( ! is_array( $item ) || empty( $item[ $key ] ) ) {
				$order[]   = null;
				$indexed[] = $item;
				continue;
			}

			$id = (string) $item[ $key ];

			if ( ! array_key_exists( $id, $indexed ) ) {
				$order[] = $id;
			}

			$indexed[ $id ] = $item;
		}

		foreach ( $override as $item ) {
			if ( ! is_array( $item ) || empty( $item[ $key ] ) ) {
				$order[]   = null;
				$indexed[] = $item;
				continue;
			}

			$id = (string) $item[ $key ];

			if ( array_key_exists( $id, $indexed ) && is_array( $indexed[ $id ] ) ) {
				$indexed[ $id ] = $item_merger
					? call_user_func( $item_merger, $indexed[ $id ], $item )
					: array_replace_recursive( $indexed[ $id ], $item );
			} else {
				$order[]        = $id;
				$indexed[ $id ] = $item;
			}
		}

		$result = [];

		foreach ( $order as $id ) {
			if ( null === $id ) {
				continue;
			}

			if ( array_key_exists( $id, $indexed ) ) {
				$result[] = $indexed[ $id ];
			}
		}

		foreach ( $indexed as $id => $item ) {
			if ( is_int( $id ) ) {
				$result[] = $item;
			}
		}

		return $result;
	}

	private function normalize_string_list( $value ): array {
		if ( is_string( $value ) ) {
			return [ $value ];
		}

		if ( ! is_array( $value ) ) {
			return [];
		}

		return array_values(
			array_filter(
				$value,
				static fn( $item ) => is_string( $item ) && '' !== trim( $item )
			)
		);
	}

	private function validate_blueprint_before_apply( array $blueprint ): void {
		$validator = new Factory_Blueprint_Validator();
		$errors    = $validator->validate( $blueprint );

		if ( empty( $errors ) ) {
			WP_CLI::success( 'Blueprint contract is valid.' );
			return;
		}

		WP_CLI::warning( 'Blueprint validation failed:' );

		foreach ( $errors as $error ) {
			WP_CLI::log( "- {$error}" );
		}

		WP_CLI::error( 'AI returned invalid blueprint. Apply aborted.' );
	}

	private function cache_blueprint(
		array $blueprint,
		string $cache_dir,
		string $cache_path,
		bool $no_cache,
		bool $debug_cache
	): void {
		if ( $no_cache ) {
			return;
		}

		if ( ! is_dir( $cache_dir ) ) {
			mkdir( $cache_dir, 0755, true );
		}

		file_put_contents(
			$cache_path,
			json_encode( $blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE )
		);

		WP_CLI::log( 'Blueprint cached.' );

		if ( $debug_cache ) {
			WP_CLI::log( "Cache saved: {$cache_path}" );
		}
	}
}
