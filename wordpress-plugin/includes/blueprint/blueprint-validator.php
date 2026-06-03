<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Blueprint_Validator {

	private array $allowed_root_keys = [
		'version',
		'site',
		'theme',
		'plugins',
		'cpt',
		'taxonomies',
		'listings',
		'pages',
		'single',
		'content',
	];

	private array $required_root_keys = [
		'site',
		'cpt',
		'content',
	];

	private array $allowed_meta_types = [
		'text',
		'number',
		'date',
		'boolean',
		'checkbox',
		'textarea',
		'select',
		'media',
		'email',
		'url',
	];

	public function validate( array $blueprint ): array {
		$errors = [];

		$this->validate_root_keys( $blueprint, $errors );
		$this->validate_required_sections( $blueprint, $errors );
		$this->validate_site( $blueprint, $errors );
		$this->validate_theme( $blueprint, $errors );
		$this->validate_plugins( $blueprint, $errors );
		$this->validate_cpt( $blueprint, $errors );
		$this->validate_taxonomies( $blueprint, $errors );
		$this->validate_listings( $blueprint, $errors );
		$this->validate_pages( $blueprint, $errors );
		$this->validate_single( $blueprint, $errors );
		$this->validate_content( $blueprint, $errors );

		return $errors;
	}

	private function validate_root_keys( array $blueprint, array &$errors ): void {
		foreach ( array_keys( $blueprint ) as $key ) {
			if ( ! in_array( $key, $this->allowed_root_keys, true ) ) {
				$errors[] = "Unknown root section: {$key}.";
			}
		}
	}

	private function validate_required_sections( array $blueprint, array &$errors ): void {
		foreach ( $this->required_root_keys as $key ) {
			if ( ! array_key_exists( $key, $blueprint ) ) {
				$errors[] = "Missing required root section: {$key}.";
			}
		}
	}

	private function validate_site( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['site'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['site'] ) ) {
			$errors[] = 'Site section must be an object.';
			return;
		}

		$site = $blueprint['site'];

		$this->require_string( $site, 'name', 'site', $errors );
		$this->require_string( $site, 'language', 'site', $errors );
		$this->require_string( $site, 'permalink', 'site', $errors );
	}

	private function validate_theme( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['theme'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['theme'] ) ) {
			$errors[] = 'Theme section must be an object.';
			return;
		}

		$this->require_string( $blueprint['theme'], 'slug', 'theme', $errors );

		if ( isset( $blueprint['theme']['path'] ) ) {
			$this->require_string( $blueprint['theme'], 'path', 'theme', $errors );
		}
	}

	private function validate_plugins( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['plugins'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['plugins'] ) ) {
			$errors[] = 'Plugins section must be an array.';
			return;
		}

		foreach ( $blueprint['plugins'] as $index => $plugin ) {
			$path = "plugins[{$index}]";

			if ( ! is_array( $plugin ) ) {
				$errors[] = "{$path} must be an object.";
				continue;
			}

			$this->require_string( $plugin, 'slug', $path, $errors );

			if ( isset( $plugin['path'] ) ) {
				$this->require_string( $plugin, 'path', $path, $errors );
			}

			if ( isset( $plugin['activate'] ) && ! is_bool( $plugin['activate'] ) ) {
				$errors[] = "{$path}.activate must be boolean.";
			}
		}
	}

	private function validate_cpt( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['cpt'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['cpt'] ) || empty( $blueprint['cpt'] ) ) {
			$errors[] = 'CPT section must be a non-empty array.';
			return;
		}

		foreach ( $blueprint['cpt'] as $index => $cpt ) {
			$path = "cpt[{$index}]";

			if ( ! is_array( $cpt ) ) {
				$errors[] = "{$path} must be an object.";
				continue;
			}

			$this->require_string( $cpt, 'slug', $path, $errors );
			$this->require_string( $cpt, 'label', $path, $errors );
			$this->require_string( $cpt, 'singular', $path, $errors );

			if ( isset( $cpt['supports'] ) && ! is_array( $cpt['supports'] ) ) {
				$errors[] = "{$path}.supports must be an array.";
			}

			if ( empty( $cpt['meta'] ) || ! is_array( $cpt['meta'] ) ) {
				$slug     = $cpt['slug'] ?? "#{$index}";
				$errors[] = "CPT {$slug} missing meta.";
				continue;
			}

			foreach ( $cpt['meta'] as $meta_index => $field ) {
				$field_path = "{$path}.meta[{$meta_index}]";

				if ( ! is_array( $field ) ) {
					$errors[] = "{$field_path} must be an object.";
					continue;
				}

				$this->require_string( $field, 'key', $field_path, $errors );
				$this->require_string( $field, 'type', $field_path, $errors );
				$this->require_string( $field, 'label', $field_path, $errors );

				if (
					isset( $field['type'] ) &&
					is_string( $field['type'] ) &&
					! in_array( $field['type'], $this->allowed_meta_types, true )
				) {
					$errors[] = "{$field_path}.type has unsupported value: {$field['type']}.";
				}
			}
		}
	}

	private function validate_taxonomies( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['taxonomies'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['taxonomies'] ) ) {
			$errors[] = 'Taxonomies section must be an array.';
			return;
		}

		foreach ( $blueprint['taxonomies'] as $index => $taxonomy ) {
			$path = "taxonomies[{$index}]";

			if ( ! is_array( $taxonomy ) ) {
				$errors[] = "{$path} must be an object.";
				continue;
			}

			$this->require_string( $taxonomy, 'slug', $path, $errors );
			$this->require_string( $taxonomy, 'post_type', $path, $errors );

			$this->optional_string( $taxonomy, 'label', $path, $errors );
			$this->optional_string( $taxonomy, 'singular', $path, $errors );

			if ( isset( $taxonomy['terms'] ) && ! is_array( $taxonomy['terms'] ) ) {
				$errors[] = "{$path}.terms must be an array.";
			}
		}
	}

	private function validate_listings( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['listings'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['listings'] ) ) {
			$errors[] = 'Listings section must be an array.';
			return;
		}

		foreach ( $blueprint['listings'] as $index => $listing ) {
			$path = "listings[{$index}]";

			if ( ! is_array( $listing ) ) {
				$errors[] = "{$path} must be an object.";
				continue;
			}

			$this->require_string( $listing, 'slug', $path, $errors );
			$this->require_string( $listing, 'title', $path, $errors );
			$this->require_string( $listing, 'post_type', $path, $errors );

			$has_fields = ! empty( $listing['fields'] ) && is_array( $listing['fields'] );
			$has_layout = ! empty( $listing['layout'] ) && is_array( $listing['layout'] );

			if ( ! $has_fields && ! $has_layout ) {
				$errors[] = "{$path} must have non-empty fields or layout array.";
			}
		}
	}

	private function validate_pages( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['pages'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['pages'] ) ) {
			$errors[] = 'Pages section must be an object.';
			return;
		}

		if ( isset( $blueprint['pages']['archive'] ) ) {
			if ( ! is_array( $blueprint['pages']['archive'] ) ) {
				$errors[] = 'pages.archive must be an object.';
				return;
			}

			$archive = $blueprint['pages']['archive'];

			$this->require_string( $archive, 'post_type', 'pages.archive', $errors );
			$this->require_string( $archive, 'slug', 'pages.archive', $errors );
			$this->require_string( $archive, 'title', 'pages.archive', $errors );
		}
	}

	private function validate_single( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['single'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['single'] ) ) {
			$errors[] = 'Single section must be an object.';
			return;
		}

		foreach ( $blueprint['single'] as $post_type => $single ) {
			$path = "single.{$post_type}";

			if ( ! is_string( $post_type ) || '' === trim( $post_type ) ) {
				$errors[] = 'Single post type key must be a non-empty string.';
				continue;
			}

			if ( ! is_array( $single ) ) {
				$errors[] = "{$path} must be an object.";
				continue;
			}

			if ( isset( $single['layout'] ) && ! is_array( $single['layout'] ) ) {
				$errors[] = "{$path}.layout must be an array.";
			}
		}
	}

	private function validate_content( array $blueprint, array &$errors ): void {
		if ( ! isset( $blueprint['content'] ) ) {
			return;
		}

		if ( ! is_array( $blueprint['content'] ) || empty( $blueprint['content'] ) ) {
			$errors[] = 'Content section must be a non-empty object.';
			return;
		}

		foreach ( $blueprint['content'] as $post_type => $items ) {
			if ( ! is_string( $post_type ) || '' === trim( $post_type ) ) {
				$errors[] = 'Content post type key must be a non-empty string.';
				continue;
			}

			if ( ! is_array( $items ) || empty( $items ) ) {
				$errors[] = "Content for {$post_type} must be a non-empty array.";
				continue;
			}

			foreach ( $items as $index => $item ) {
				$path = "content.{$post_type}[{$index}]";

				if ( ! is_array( $item ) ) {
					$errors[] = "{$path} must be an object.";
					continue;
				}

				$this->require_string( $item, 'title', $path, $errors );
				$this->require_string( $item, 'content', $path, $errors );

				if ( empty( $item['meta'] ) || ! is_array( $item['meta'] ) ) {
					$errors[] = "{$path}.meta must be a non-empty object.";
				}

				if ( isset( $item['terms'] ) && ! is_array( $item['terms'] ) ) {
					$errors[] = "{$path}.terms must be an object.";
				}
			}
		}
	}

	private function require_string( array $data, string $key, string $path, array &$errors ): void {
		if ( ! array_key_exists( $key, $data ) ) {
			$errors[] = "{$path}.{$key} is required.";
			return;
		}

		if ( ! is_string( $data[ $key ] ) || '' === trim( $data[ $key ] ) ) {
			$errors[] = "{$path}.{$key} must be a non-empty string.";
		}
	}

	private function optional_string( array $data, string $key, string $path, array &$errors ): void {
		if ( ! array_key_exists( $key, $data ) ) {
			return;
		}

		if ( ! is_string( $data[ $key ] ) || '' === trim( $data[ $key ] ) ) {
			$errors[] = "{$path}.{$key} must be a non-empty string.";
		}
	}
}