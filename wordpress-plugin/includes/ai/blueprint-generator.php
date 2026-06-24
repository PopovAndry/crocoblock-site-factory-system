<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'factory_legacy_ai_blueprint_generator_enabled' ) ) {
	/**
	 * Keep the legacy prompt-to-blueprint generator behind an explicit developer opt-in.
	 *
	 * This path performs direct provider calls and writes legacy artifacts, so it stays
	 * disabled by default while the safe provider and contract-first flow are active.
	 */
	function factory_legacy_ai_blueprint_generator_enabled(): bool {
		return defined( 'FACTORY_ENABLE_LEGACY_AI_BLUEPRINT_GENERATOR' )
			&& true === FACTORY_ENABLE_LEGACY_AI_BLUEPRINT_GENERATOR;
	}
}

class Factory_AI_Blueprint_Generator {

	private string $source_path;
	private string $target_path;
	private string $cache_dir;
	private bool $last_from_cache = false;

	public function __construct(
		?string $source_path = null,
		?string $target_path = null
	) {
		$this->source_path = $source_path ?? FACTORY_PRESETS_DIR . 'real-estate.json';
		$this->target_path = $target_path ?? FACTORY_GENERATED_BLUEPRINTS_DIR . 'real-estate-ai.json';
		$this->cache_dir   = FACTORY_BLUEPRINT_CACHE_DIR;
	}

	public function generate(): array {
		if ( ! file_exists( $this->source_path ) ) {
			throw new RuntimeException( "Example blueprint not found: {$this->source_path}" );
		}

		$blueprint = json_decode( file_get_contents( $this->source_path ), true );

		if ( ! is_array( $blueprint ) ) {
			throw new RuntimeException( 'Invalid generated blueprint JSON.' );
		}

		$normalizer = new Factory_Blueprint_Normalizer();
		$blueprint  = $normalizer->normalize( $blueprint );

		$this->save_blueprint( $blueprint );

		return $blueprint;
	}

public function generate_from_prompt( string $user_prompt ): array {
	if ( ! factory_legacy_ai_blueprint_generator_enabled() ) {
		throw new RuntimeException(
			'Legacy AI blueprint generation is disabled. Define FACTORY_ENABLE_LEGACY_AI_BLUEPRINT_GENERATOR as true to opt in explicitly.'
		);
	}

	$cached = $this->get_cached_blueprint( $user_prompt );

	if ( is_array( $cached ) ) {
		$this->last_from_cache = true;

		$this->save_blueprint( $cached );

		return $cached;
	}

	$this->last_from_cache = false;

	$api_key = getenv( 'OPENAI_API_KEY' );

	if ( ! $api_key ) {
		throw new RuntimeException( 'OPENAI_API_KEY not set.' );
	}

	$payload = [
		'model'           => 'gpt-4.1-mini',
		'response_format' => [
			'type' => 'json_object',
		],
		'messages'        => [
			[
				'role'    => 'system',
				'content' => $this->get_system_prompt(),
			],
			[
				'role'    => 'user',
				'content' => $user_prompt,
			],
		],
	];

	$response = wp_remote_post(
		'https://api.openai.com/v1/chat/completions',
		[
			'headers' => [
				'Authorization' => 'Bearer ' . $api_key,
				'Content-Type'  => 'application/json',
			],
			'body'    => wp_json_encode( $payload ),
			'timeout' => 60,
		]
	);

	if ( is_wp_error( $response ) ) {
		throw new RuntimeException( $response->get_error_message() );
	}

	$body = json_decode( wp_remote_retrieve_body( $response ), true );

	if ( isset( $body['error'] ) ) {
		throw new RuntimeException(
			'OpenAI API error: ' . ( $body['error']['message'] ?? 'Unknown error' )
		);
	}

	$content = $body['choices'][0]['message']['content'] ?? '';

	$this->ensure_directory( FACTORY_REPORTS_DIR );

	file_put_contents(
		FACTORY_REPORTS_DIR . 'last-ai-response.txt',
		$content
	);

	$content = trim( $content );

	// remove possible ```json
	$content = preg_replace( '/^```json\s*|\s*```$/', '', $content );

	$blueprint = json_decode( $content, true );

	if ( ! is_array( $blueprint ) ) {
		throw new RuntimeException( 'AI returned invalid JSON: ' . $content );
	}

	$normalizer = new Factory_Blueprint_Normalizer();
	$blueprint  = $normalizer->normalize( $blueprint );

	$this->save_cached_blueprint( $user_prompt, $blueprint );
	$this->save_blueprint( $blueprint );

	return $blueprint;
}

public function was_loaded_from_cache(): bool {
	return $this->last_from_cache;
}

	public function get_target_path(): string {
		return $this->target_path;
	}

	private function save_blueprint( array $blueprint ): void {
		$this->ensure_directory( dirname( $this->target_path ) );

		file_put_contents(
			$this->target_path,
			json_encode( $blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
		);
	}

	private function get_cache_path( string $prompt ): string {
		$hash = md5( trim( strtolower( $prompt ) ) );

		return $this->cache_dir . '/' . $hash . '.json';
	}

	private function get_cached_blueprint( string $prompt ): ?array {
		$cache_path = $this->get_cache_path( $prompt );

		if ( ! file_exists( $cache_path ) ) {
			return null;
		}

		$blueprint = json_decode( file_get_contents( $cache_path ), true );

		return is_array( $blueprint ) ? $blueprint : null;
	}

	private function save_cached_blueprint( string $prompt, array $blueprint ): void {
		$this->ensure_directory( $this->cache_dir );

		file_put_contents(
			$this->get_cache_path( $prompt ),
			json_encode( $blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
		);
	}

	private function get_system_prompt(): string {
		return <<<PROMPT
You generate JSON blueprints for Crocoblock Site Factory.

Return ONLY valid JSON.
Do not include markdown.
Return strictly valid JSON.
Do not wrap in markdown.
Do not include explanations.
Do not include comments.

Supported structure:
{
  "version": "0.2",
  "site": {
    "name": "Site Name",
    "language": "en",
    "permalink": "/%postname%/"
  },
  "theme": {
    "slug": "kava"
  },
  "plugins": [
    {
      "slug": "jet-engine",
      "activate": true
    }
  ],
  "taxonomies": [
	{
		"slug": "property_type",
		"post_type": "property",
		"terms": ["Apartment", "House", "Villa"]
	}
	],
  "pages": {
    "archive": {
      "post_type": "property",
      "slug": "properties",
      "title": "Properties"
    }
  },
  "cpt": [
    {
      "slug": "property",
      "label": "Properties",
      "singular": "Property",
      "supports": ["title", "editor", "thumbnail"],
      "meta": [
        {
          "key": "price",
          "type": "number",
          "label": "Price"
        }
      ]
    }
  ],
  "content": {
    "property": [
      {
        "title": "Demo Property",
        "content": "Demo description.",
        "meta": {
          "price": 120000
        }
      }
    ]
  },
  "listings": [
    {
      "slug": "property-card",
      "title": "Property Card",
      "post_type": "property",
      "layout": [
        {
          "type": "title"
        },
        {
          "type": "meta",
          "key": "price",
          "label": "Price",
          "format": "currency"
        }
      ]
    }
  ],
  "single": {
    "property": {
      "layout": [
        {
          "type": "meta",
          "key": "price",
          "label": "Price",
          "format": "currency"
        },
        {
          "type": "content"
        }
      ]
    }
  }
}

Rules:
- Use "content", not "demo_content".
- Use "layout", not "fields".
- Supported layout types: title, meta, content.
- Supported meta types: text, number, boolean, date.
- Supported meta format: currency.
- Every content meta key must exist in the related CPT meta list.
- Do not invent unsupported fields.
- Keep slugs lowercase.
- Use snake_case for meta keys.
PROMPT;
	}

	private function ensure_directory( string $path ): void {
		if ( is_dir( $path ) ) {
			return;
		}

		wp_mkdir_p( $path );
	}
}
