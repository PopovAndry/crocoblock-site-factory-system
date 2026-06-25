<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Render_Adapter {

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		add_shortcode( 'factory_listing', [ $this, 'render_listing_shortcode' ] );
		add_shortcode( 'factory_request_viewing', [ $this, 'render_request_viewing_shortcode' ] );
		add_action( 'template_redirect', [ $this, 'redirect_property_archive' ] );
		add_filter( 'body_class', [ $this, 'add_contact_page_body_class' ] );
		add_action( 'wp_head', [ $this, 'print_contact_page_title_styles' ] );
	}

	public function redirect_property_archive(): void {
		if ( is_admin() || ! is_post_type_archive( 'property' ) ) {
			return;
		}

		wp_safe_redirect( home_url( '/properties/' ), 302 );
		exit;
	}

	public function add_contact_page_body_class( array $classes ): array {
		if ( $this->is_generated_contact_page_request() ) {
			$classes[] = 'factory-generated-contact-page';
		}

		if ( $this->is_generated_archive_page_request() ) {
			$classes[] = 'factory-generated-properties-page';
		}

		if ( $this->is_generated_home_page_request() ) {
			$classes[] = 'factory-generated-home-page';
		}

		if ( is_singular( 'property' ) ) {
			$classes[] = 'factory-generated-property-single-page';
		}

		return $classes;
	}

	public function print_contact_page_title_styles(): void {
		$blueprint    = factory_get_blueprint();
		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$primary      = esc_attr( $style_tokens['primary'] );
		$accent       = esc_attr( $style_tokens['accent'] );
		$button       = esc_attr( $style_tokens['button'] );
		$button_text  = esc_attr( $style_tokens['button_text'] );
		$styles       = [];

		if ( $this->is_generated_contact_page_request() ) {
			$styles[] = '.factory-generated-contact-page .entry-title,.factory-generated-contact-page .page-title,.factory-generated-contact-page .post-title,.factory-generated-contact-page .page-header,.factory-generated-contact-page .entry-header,.factory-generated-contact-page .site-main > h1,.factory-generated-contact-page main > h1{display:none!important;}';
		}

		if ( $this->is_generated_archive_page_request() ) {
			$styles[] = '.factory-generated-properties-page .entry-title,.factory-generated-properties-page .page-title,.factory-generated-properties-page .post-title,.factory-generated-properties-page .page-header,.factory-generated-properties-page .entry-header,.factory-generated-properties-page .site-main > h1,.factory-generated-properties-page main > h1{display:none!important;}';
		}

		if ( $this->is_generated_home_page_request() || $this->is_generated_archive_page_request() || $this->is_generated_contact_page_request() || is_singular( 'property' ) ) {
			$styles[] = '.factory-generated-home-page .site-title,.factory-generated-home-page .site-title a,.factory-generated-home-page .site-logo,.factory-generated-home-page .site-logo a,.factory-generated-home-page .site-logo__link,.factory-generated-home-page .site-branding a,.factory-generated-home-page .custom-logo-link,.factory-generated-properties-page .site-title,.factory-generated-properties-page .site-title a,.factory-generated-properties-page .site-logo,.factory-generated-properties-page .site-logo a,.factory-generated-properties-page .site-logo__link,.factory-generated-properties-page .site-branding a,.factory-generated-properties-page .custom-logo-link,.factory-generated-contact-page .site-title,.factory-generated-contact-page .site-title a,.factory-generated-contact-page .site-logo,.factory-generated-contact-page .site-logo a,.factory-generated-contact-page .site-logo__link,.factory-generated-contact-page .site-branding a,.factory-generated-contact-page .custom-logo-link,.factory-generated-property-single-page .site-title,.factory-generated-property-single-page .site-title a,.factory-generated-property-single-page .site-logo,.factory-generated-property-single-page .site-logo a,.factory-generated-property-single-page .site-logo__link,.factory-generated-property-single-page .site-branding a,.factory-generated-property-single-page .custom-logo-link{color:' . $primary . '!important;}';
			$styles[] = '.factory-generated-home-page .main-navigation a,.factory-generated-home-page .menu a,.factory-generated-home-page nav a,.factory-generated-properties-page .main-navigation a,.factory-generated-properties-page .menu a,.factory-generated-properties-page nav a,.factory-generated-contact-page .main-navigation a,.factory-generated-contact-page .menu a,.factory-generated-contact-page nav a,.factory-generated-property-single-page .main-navigation a,.factory-generated-property-single-page .menu a,.factory-generated-property-single-page nav a{color:' . $primary . '!important;}';
			$styles[] = '.factory-generated-home-page .main-navigation a:hover,.factory-generated-home-page .menu a:hover,.factory-generated-home-page nav a:hover,.factory-generated-home-page .current-menu-item > a,.factory-generated-properties-page .main-navigation a:hover,.factory-generated-properties-page .menu a:hover,.factory-generated-properties-page nav a:hover,.factory-generated-properties-page .current-menu-item > a,.factory-generated-contact-page .main-navigation a:hover,.factory-generated-contact-page .menu a:hover,.factory-generated-contact-page nav a:hover,.factory-generated-contact-page .current-menu-item > a,.factory-generated-property-single-page .main-navigation a:hover,.factory-generated-property-single-page .menu a:hover,.factory-generated-property-single-page nav a:hover,.factory-generated-property-single-page .current-menu-item > a{color:' . $accent . '!important;}';
			$styles[] = '.factory-generated-home-page button,.factory-generated-home-page input[type="submit"],.factory-generated-properties-page button,.factory-generated-properties-page input[type="submit"],.factory-generated-contact-page button,.factory-generated-contact-page input[type="submit"],.factory-generated-property-single-page button,.factory-generated-property-single-page input[type="submit"]{background:' . $button . '!important;border-color:' . $button . '!important;color:' . $button_text . '!important;}';
			$styles[] = '.factory-generated-home-page button:hover,.factory-generated-home-page button:focus-visible,.factory-generated-home-page input[type="submit"]:hover,.factory-generated-home-page input[type="submit"]:focus-visible,.factory-generated-properties-page button:hover,.factory-generated-properties-page button:focus-visible,.factory-generated-properties-page input[type="submit"]:hover,.factory-generated-properties-page input[type="submit"]:focus-visible,.factory-generated-contact-page button:hover,.factory-generated-contact-page button:focus-visible,.factory-generated-contact-page input[type="submit"]:hover,.factory-generated-contact-page input[type="submit"]:focus-visible,.factory-generated-property-single-page button:hover,.factory-generated-property-single-page button:focus-visible,.factory-generated-property-single-page input[type="submit"]:hover,.factory-generated-property-single-page input[type="submit"]:focus-visible{background:' . $primary . '!important;color:' . $button_text . '!important;outline:0;}';
			$styles[] = '.factory-generated-home-page .site-content,.factory-generated-properties-page .site-content,.factory-generated-contact-page .site-content,.factory-generated-property-single-page .site-content{margin-bottom:0!important;padding-bottom:0!important}.factory-generated-home-page .site-main,.factory-generated-properties-page .site-main,.factory-generated-contact-page .site-main,.factory-generated-property-single-page .site-main{margin-bottom:0!important}.factory-generated-home-page button,.factory-generated-home-page input[type="submit"],.factory-generated-home-page .factory-button-link,.factory-generated-properties-page button,.factory-generated-properties-page input[type="submit"],.factory-generated-properties-page .factory-button-link,.factory-generated-properties-page .factory-property-action,.factory-generated-properties-page .factory-property-pagination a,.factory-generated-contact-page button,.factory-generated-contact-page input[type="submit"],.factory-generated-contact-page .factory-button-link,.factory-generated-property-single-page button,.factory-generated-property-single-page input[type="submit"],.factory-generated-property-single-page .factory-button-link{transition:background-color .16s ease,color .16s ease}.factory-generated-home-page .factory-button-link:hover,.factory-generated-home-page .factory-button-link:focus-visible,.factory-generated-properties-page .factory-button-link:hover,.factory-generated-properties-page .factory-button-link:focus-visible,.factory-generated-properties-page .factory-property-action:hover,.factory-generated-properties-page .factory-property-action:focus-visible,.factory-generated-properties-page .factory-property-pagination a:hover,.factory-generated-properties-page .factory-property-pagination a:focus-visible,.factory-generated-contact-page .factory-button-link:hover,.factory-generated-contact-page .factory-button-link:focus-visible,.factory-generated-property-single-page .factory-button-link:hover,.factory-generated-property-single-page .factory-button-link:focus-visible{color:' . $accent . '!important;outline:0;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px}.factory-generated-home-page .factory-button-link[style*="background"]:hover,.factory-generated-home-page .factory-button-link[style*="background"]:focus-visible,.factory-generated-properties-page .factory-button-link[style*="background"]:hover,.factory-generated-properties-page .factory-button-link[style*="background"]:focus-visible,.factory-generated-properties-page .factory-property-action[style*="background"]:hover,.factory-generated-properties-page .factory-property-action[style*="background"]:focus-visible,.factory-generated-contact-page .factory-button-link[style*="background"]:hover,.factory-generated-contact-page .factory-button-link[style*="background"]:focus-visible,.factory-generated-property-single-page .factory-button-link[style*="background"]:hover,.factory-generated-property-single-page .factory-button-link[style*="background"]:focus-visible{background:' . $primary . '!important;color:' . $button_text . '!important;text-decoration:none}.factory-generated-properties-page .factory-property-card{transition:background-color .16s ease}.factory-generated-properties-page .factory-property-card:hover{background:#fff!important}.factory-generated-properties-page .factory-property-card h2 a{transition:color .16s ease}.factory-generated-properties-page .factory-property-card h2 a:hover,.factory-generated-properties-page .factory-property-card h2 a:focus-visible{color:' . $accent . '!important;outline:0;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px}.factory-generated-footer a{transition:color .16s ease,text-decoration-color .16s ease}.factory-generated-footer a:hover,.factory-generated-footer a:focus-visible{color:' . $accent . '!important;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px;outline:0}';
			$styles[] = '.factory-generated-properties-page .breadcrumbs,.factory-generated-properties-page .breadcrumb,.factory-generated-properties-page .breadcrumb-trail,.factory-generated-contact-page .breadcrumbs,.factory-generated-contact-page .breadcrumb,.factory-generated-contact-page .breadcrumb-trail,.factory-generated-property-single-page .breadcrumbs,.factory-generated-property-single-page .breadcrumb,.factory-generated-property-single-page .breadcrumb-trail{margin-bottom:12px!important;padding-bottom:0!important}.factory-generated-properties-page .breadcrumbs a,.factory-generated-properties-page .breadcrumb a,.factory-generated-contact-page .breadcrumbs a,.factory-generated-contact-page .breadcrumb a,.factory-generated-property-single-page .breadcrumbs a,.factory-generated-property-single-page .breadcrumb a{color:' . $primary . '!important;}';
			$styles[] = '.factory-generated-home-page .site-footer,.factory-generated-home-page footer.site-footer,.factory-generated-properties-page .site-footer,.factory-generated-properties-page footer.site-footer,.factory-generated-contact-page .site-footer,.factory-generated-contact-page footer.site-footer,.factory-generated-property-single-page .site-footer,.factory-generated-property-single-page footer.site-footer{display:none!important;}';
			$styles[] = '@media(max-width:900px){.factory-property-search-layout{grid-template-columns:1fr!important}.factory-property-search-layout aside{position:static!important}}@media(max-width:760px){.factory-property-card-row{grid-template-columns:1fr!important}.factory-property-card-row img{min-height:220px!important}.factory-generated-footer [style*="grid-template-columns"]{grid-template-columns:1fr!important}}';
		}

		if ( empty( $styles ) ) {
			return;
		}

		echo '<style id="factory-generated-page-style">' . implode( '', $styles ) . '</style>' . "\n";
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];

		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			$result = $this->upsert_listing_page( $listing );

			if ( is_array( $result ) ) {
				$this->execution_results[] = $result;
			}
		}

		foreach ( [ 'home', 'native_filters', 'contact' ] as $page_key ) {
			$result = $this->upsert_configured_page( $blueprint, $page_key );

			if ( is_array( $result ) ) {
				$this->execution_results[] = $result;
			}
		}

		$front_page_result = $this->sync_front_page( $blueprint );

		if ( is_array( $front_page_result ) ) {
			$this->execution_results[] = $front_page_result;
		}

		$navigation_result = $this->sync_navigation_menu( $blueprint );

		if ( is_array( $navigation_result ) ) {
			$this->execution_results[] = $navigation_result;
		}

		$request_viewing_result = $this->upsert_request_viewing_form( $blueprint );

		if ( is_array( $request_viewing_result ) ) {
			$this->execution_results[] = $request_viewing_result;
		}
	}

	public function get_execution_results(): array {
		return $this->execution_results;
	}

	public function plan( array $blueprint ): array {
		$plan = [];

		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			$slug      = $listing['slug'] ?? '';
			$post_type = $listing['post_type'] ?? '';

			if ( ! $slug || ! $post_type ) {
				continue;
			}

			$page_config = $this->get_archive_page_config( $post_type );

			$page_slug  = $page_config['slug'] ?? $post_type . 's';
			$page_title = $page_config['title'] ?? ucwords( str_replace( '-', ' ', $page_slug ) );

			$content = sprintf(
				'[factory_listing slug="%s"]',
				esc_attr( $slug )
			);

			$target_state = [
				'post_title'   => $page_title,
				'post_name'    => $page_slug,
				'post_status'  => 'publish',
				'post_content' => $content,
			];

			$existing = get_page_by_path( $page_slug );

			if ( ! $existing ) {
				$plan[] = [
					'action'  => 'create',
					'type'    => 'render',
					'entity'  => $page_slug,
					'message' => "Create render page: {$page_slug}",
				];

				continue;
			}

			$current_state = $this->get_current_page_state( $existing );

			if ( factory_is_post_user_modified( $existing->ID, $current_state, $target_state ) ) {
				$plan[] = [
					'action'  => 'warning',
					'type'    => 'render',
					'entity'  => $page_slug,
					'message' => "Manual edits detected; this generated page will be preserved: {$existing->post_title}",
					'diff'    => factory_diff_arrays( $current_state, $target_state ),
				];

				continue;
			}

			$diff = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$plan[] = [
					'action'  => 'skip',
					'type'    => 'render',
					'entity'  => $page_slug,
					'message' => "Render page up-to-date: {$page_slug}",
				];

				continue;
			}

			$plan[] = [
				'action'  => 'update',
				'type'    => 'render',
				'entity'  => $page_slug,
				'message' => "Update render page: {$page_slug}",
				'diff'    => $diff,
			];
		}

		foreach ( [ 'home', 'native_filters', 'contact' ] as $page_key ) {
			$page_plan = $this->get_configured_page_plan_item( $blueprint, $page_key );

			if ( is_array( $page_plan ) ) {
				$plan[] = $page_plan;
			}
		}

		$front_page_plan = $this->get_front_page_plan_item( $blueprint );

		if ( is_array( $front_page_plan ) ) {
			$plan[] = $front_page_plan;
		}

		$navigation_plan = $this->get_navigation_plan_item( $blueprint );

		if ( is_array( $navigation_plan ) ) {
			$plan[] = $navigation_plan;
		}

		$request_viewing_plan = $this->get_request_viewing_form_plan_item( $blueprint );

		if ( is_array( $request_viewing_plan ) ) {
			$plan[] = $request_viewing_plan;
		}

		return $plan;
	}

	public function validate( array $blueprint ): array {
		$results = [];

		$page = $blueprint['pages']['archive'] ?? null;

		if ( $page ) {
			$slug  = $page['slug'] ?? '';
			$title = $page['title'] ?? $slug;
			$content = sprintf(
				'[factory_listing slug="%s"]',
				esc_attr( $this->get_listing_slug_for_post_type( $blueprint, $page['post_type'] ?? '' ) )
			);

			$results[] = $this->validate_page_state(
				$slug,
				$title,
				$content,
				'Render page'
			);
		}

		foreach ( [ 'home', 'native_filters', 'contact' ] as $page_key ) {
			$page_check = $this->validate_configured_page( $blueprint, $page_key );

			if ( is_array( $page_check ) ) {
				$results[] = $page_check;
			}
		}

		foreach ( $this->validate_native_filters_proof( $blueprint ) as $native_check ) {
			$results[] = $native_check;
		}

		foreach ( $this->validate_home_queries( $blueprint ) as $query_check ) {
			$results[] = $query_check;
		}

		$front_page_check = $this->validate_front_page( $blueprint );

		if ( is_array( $front_page_check ) ) {
			$results[] = $front_page_check;
		}

		$properties_check = $this->validate_archive_not_front_page( $blueprint );

		if ( is_array( $properties_check ) ) {
			$results[] = $properties_check;
		}

		$navigation_check = $this->validate_navigation_menu( $blueprint );

		if ( is_array( $navigation_check ) ) {
			$results[] = $navigation_check;
		}

		$request_viewing_check = $this->validate_request_viewing( $blueprint );

		if ( is_array( $request_viewing_check ) ) {
			$results[] = $request_viewing_check;
		}

		foreach ( $this->validate_style_tokens( $blueprint ) as $style_check ) {
			$results[] = $style_check;
		}

		return $results;
	}

	private function validate_style_tokens( array $blueprint ): array {
		$checks = [];
		$tokens = $this->get_site_style_tokens( $blueprint );

		foreach ( [ 'primary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'button', 'button_text', 'link', 'link_hover', 'heading' ] as $key ) {
			$value = $tokens[ $key ] ?? '';

			$checks[] = [
				'status'  => preg_match( '/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/', $value ) ? 'ok' : 'error',
				'message' => preg_match( '/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/', $value )
					? "Factory style token valid: {$key}"
					: "Factory style token invalid: {$key}",
			];
		}

		return $checks;
	}

	private function upsert_listing_page( array $listing ): ?array {
		$slug      = $listing['slug'] ?? '';
		$post_type = $listing['post_type'] ?? '';

		if ( ! $slug || ! $post_type ) {
			return null;
		}

		$page_config = $this->get_archive_page_config( $post_type );

		$page_slug  = $page_config['slug'] ?? $post_type . 's';
		$page_title = $page_config['title'] ?? ucwords( str_replace( '-', ' ', $page_slug ) );

		$content = sprintf(
			'[factory_listing slug="%s"]',
			esc_attr( $slug )
		);

		$existing = get_page_by_path( $page_slug );

		$target_state = [
			'post_title'   => $page_title,
			'post_name'    => $page_slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		];

		if ( $existing ) {
			$current_state = $this->get_current_page_state( $existing );

			if ( factory_is_post_user_modified( $existing->ID, $current_state, $target_state ) ) {
				factory_mark_post_user_modified( $existing->ID );

				return $this->execution_item(
					'warning',
					'skip',
					$page_slug,
					"Manual edits detected; preserved generated page: {$existing->post_title}"
				);
			}

			$diff = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$this->mark_page_factory_managed( $existing->ID, $page_slug, $target_state );
				$this->log( "Render page up-to-date: {$page_slug}" );

				return $this->execution_item(
					'ok',
					'skip',
					$page_slug,
					"Render page up-to-date: {$page_slug}"
				);
			}

			$post_data              = $target_state;
			$post_data['ID']        = $existing->ID;
			$post_data['post_type'] = 'page';

			$post_id = wp_update_post( $post_data );
			$this->log( "Render page updated: {$page_slug}" );

			if ( is_wp_error( $post_id ) || ! $post_id ) {
				return $this->execution_item(
					'error',
					'update',
					$page_slug,
					"Render page update failed: {$page_slug}"
				);
			}

			$this->mark_page_factory_managed( (int) $post_id, $page_slug, $target_state );

			return $this->execution_item(
				'ok',
				'update',
				$page_slug,
				"Render page updated: {$page_slug}"
			);
		}

		$post_id = wp_insert_post( [
			'post_type'    => 'page',
			'post_title'   => $page_title,
			'post_name'    => $page_slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		] );

		$this->log( "Render page created: {$page_slug}" );

		if ( is_wp_error( $post_id ) || ! $post_id ) {
			return $this->execution_item(
				'error',
				'create',
				$page_slug,
				"Render page create failed: {$page_slug}"
			);
		}

		$this->mark_page_factory_managed( (int) $post_id, $page_slug, $target_state );

		return $this->execution_item(
			'ok',
			'create',
			$page_slug,
			"Render page created: {$page_slug}"
		);
	}

	private function upsert_configured_page( array $blueprint, string $page_key ): ?array {
		$page = $this->get_configured_page( $blueprint, $page_key );

		if ( empty( $page ) ) {
			return null;
		}

		$page_slug  = $page['slug'] ?? '';
		$page_title = $page['title'] ?? ucwords( str_replace( '-', ' ', $page_slug ) );
		$content    = $this->get_configured_page_content( $blueprint, $page_key );

		return $this->upsert_page(
			$page_slug,
			$page_title,
			$content,
			'page',
			$this->humanize_key( $page_key ) . ' page',
			$page_key
		);
	}

	private function upsert_page(
		string $page_slug,
		string $page_title,
		string $content,
		string $item_type,
		string $label,
		string $page_key = ''
	): ?array {
		if ( ! $page_slug || ! $page_title ) {
			return null;
		}

		$existing = get_page_by_path( $page_slug );

		$target_state = [
			'post_title'   => $page_title,
			'post_name'    => $page_slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		];

		if ( $existing ) {
			$current_state = $this->get_current_page_state( $existing );

			if ( factory_is_post_user_modified( $existing->ID, $current_state, $target_state ) ) {
				factory_mark_post_user_modified( $existing->ID );

				return $this->execution_item(
					'warning',
					'skip',
					$page_slug,
					"Manual edits detected; preserved generated page: {$existing->post_title}",
					$item_type
				);
			}

			$diff = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				$this->mark_page_factory_managed( $existing->ID, $page_key ?: $page_slug, $target_state );
				$this->log( "{$label} up-to-date: {$page_slug}" );

				return $this->execution_item(
					'ok',
					'skip',
					$page_slug,
					"{$label} up-to-date: {$page_slug}",
					$item_type
				);
			}

			$post_data              = $target_state;
			$post_data['ID']        = $existing->ID;
			$post_data['post_type'] = 'page';

			$post_id = wp_update_post( $post_data );
			$this->log( "{$label} updated: {$page_slug}" );

			if ( is_wp_error( $post_id ) || ! $post_id ) {
				return $this->execution_item(
					'error',
					'update',
					$page_slug,
					"{$label} update failed: {$page_slug}",
					$item_type
				);
			}

			$this->mark_page_factory_managed( (int) $post_id, $page_key ?: $page_slug, $target_state );

			return $this->execution_item(
				'ok',
				'update',
				$page_slug,
				"{$label} updated: {$page_slug}",
				$item_type
			);
		}

		$post_id = wp_insert_post( [
			'post_type'    => 'page',
			'post_title'   => $page_title,
			'post_name'    => $page_slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		] );

		$this->log( "{$label} created: {$page_slug}" );

		if ( is_wp_error( $post_id ) || ! $post_id ) {
			return $this->execution_item(
				'error',
				'create',
				$page_slug,
				"{$label} create failed: {$page_slug}",
				$item_type
			);
		}

		$this->mark_page_factory_managed( (int) $post_id, $page_key ?: $page_slug, $target_state );

		return $this->execution_item(
			'ok',
			'create',
			$page_slug,
			"{$label} created: {$page_slug}",
			$item_type
		);
	}

	private function get_current_page_state( WP_Post $page ): array {
		return [
			'post_title'   => $page->post_title,
			'post_name'    => $page->post_name,
			'post_status'  => $page->post_status,
			'post_content' => $page->post_content,
		];
	}

	private function mark_page_factory_managed( int $post_id, string $page_key, array $target_state ): void {
		factory_mark_post_managed(
			$post_id,
			[
				'source'      => 'real-estate',
				'entity_type' => 'page',
				'page_key'    => $page_key,
				'hash'        => factory_ownership_hash_state( $target_state ),
			]
		);
	}

	private function sync_front_page( array $blueprint ): ?array {
		$home = $this->get_configured_page( $blueprint, 'home' );

		if ( empty( $home ) || true !== ( $home['front_page'] ?? false ) ) {
			return null;
		}

		$page_slug = $home['slug'] ?? '';

		if ( ! $page_slug ) {
			return null;
		}

		$page = get_page_by_path( $page_slug );

		if ( ! $page ) {
			return $this->execution_item(
				'error',
				'update',
				$page_slug,
				"Homepage page missing: {$page_slug}",
				'homepage'
			);
		}

		if ( $this->is_front_page( $page ) ) {
			return $this->execution_item(
				'ok',
				'skip',
				$page_slug,
				"Homepage already set to Home page: {$page_slug}",
				'homepage'
			);
		}

		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $page->ID );

		return $this->execution_item(
			'ok',
			'update',
			$page_slug,
			"Homepage set to Home page: {$page_slug}",
			'homepage'
		);
	}

	private function get_configured_page_plan_item( array $blueprint, string $page_key ): ?array {
		$page = $this->get_configured_page( $blueprint, $page_key );

		if ( empty( $page ) ) {
			return null;
		}

		$page_slug  = $page['slug'] ?? '';
		$page_title = $page['title'] ?? ucwords( str_replace( '-', ' ', $page_slug ) );
		$content    = $this->get_configured_page_content( $blueprint, $page_key );

		return $this->get_page_plan_item(
			$page_slug,
			$page_title,
			$content,
			'page',
			$this->humanize_key( $page_key ) . ' page'
		);
	}

	private function get_page_plan_item(
		string $page_slug,
		string $page_title,
		string $content,
		string $item_type,
		string $label
	): ?array {
		if ( ! $page_slug || ! $page_title ) {
			return null;
		}

		$target_state = [
			'post_title'   => $page_title,
			'post_name'    => $page_slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		];

		$existing = get_page_by_path( $page_slug );

		if ( ! $existing ) {
			return [
				'action'  => 'create',
				'type'    => $item_type,
				'entity'  => $page_slug,
				'message' => "Create {$label}: {$page_slug}",
				'diff'    => [],
			];
		}

		$current_state = $this->get_current_page_state( $existing );

		if ( factory_is_post_user_modified( $existing->ID, $current_state, $target_state ) ) {
			return [
				'action'  => 'warning',
				'type'    => $item_type,
				'entity'  => $page_slug,
				'message' => "Manual edits detected; this generated page will be preserved: {$existing->post_title}",
				'diff'    => factory_diff_arrays( $current_state, $target_state ),
			];
		}

		$diff = factory_diff_arrays( $current_state, $target_state );

		return [
			'action'  => empty( $diff ) ? 'skip' : 'update',
			'type'    => $item_type,
			'entity'  => $page_slug,
			'message' => empty( $diff )
				? "{$label} up-to-date: {$page_slug}"
				: "Update {$label}: {$page_slug}",
			'diff'    => $diff,
		];
	}

	private function get_front_page_plan_item( array $blueprint ): ?array {
		$home = $this->get_configured_page( $blueprint, 'home' );

		if ( empty( $home ) || true !== ( $home['front_page'] ?? false ) ) {
			return null;
		}

		$page_slug = $home['slug'] ?? '';

		if ( ! $page_slug ) {
			return null;
		}

		$page       = get_page_by_path( $page_slug );
		$is_current = $page && $this->is_front_page( $page );

		return [
			'action'  => $is_current ? 'skip' : 'update',
			'type'    => 'homepage',
			'entity'  => $page_slug,
			'message' => $is_current
				? "Homepage already set to Home page: {$page_slug}"
				: "Set homepage to Home page: {$page_slug}",
			'diff'    => [],
		];
	}

	private function validate_configured_page( array $blueprint, string $page_key ): ?array {
		$page = $this->get_configured_page( $blueprint, $page_key );

		if ( empty( $page ) ) {
			return null;
		}

		$page_slug  = $page['slug'] ?? '';
		$page_title = $page['title'] ?? $page_slug;
		$content    = $this->get_configured_page_content( $blueprint, $page_key );

		return $this->validate_page_state(
			$page_slug,
			$page_title,
			$content,
			$this->humanize_key( $page_key ) . ' page'
		);
	}

	private function validate_page_state(
		string $page_slug,
		string $page_title,
		string $content,
		string $label
	): array {
		$existing = get_page_by_path( $page_slug );

		if ( ! $existing ) {
			return [
				'status'  => 'error',
				'message' => "{$label} missing: {$page_title}",
			];
		}

		$target_state = [
			'post_title'   => $page_title,
			'post_name'    => $page_slug,
			'post_status'  => 'publish',
			'post_content' => $content,
		];

		$current_state = $this->get_current_page_state( $existing );

		if ( factory_is_post_user_modified( $existing->ID, $current_state, $target_state ) ) {
			return [
				'status'  => 'warning',
				'message' => "Manual edits preserved for generated page: {$existing->post_title}",
			];
		}

		$diff = factory_diff_arrays( $current_state, $target_state );

		if ( ! empty( $diff ) ) {
			return [
				'status'  => 'error',
				'message' => "{$label} out of sync: {$page_title}",
			];
		}

		return [
			'status'  => 'ok',
			'message' => "{$label} up-to-date: {$page_title}",
		];
	}

	private function validate_native_filters_proof( array $blueprint ): array {
		$checks = [];
		$page   = $this->get_configured_page( $blueprint, 'native_filters' );

		if ( empty( $page ) ) {
			return $checks;
		}

		$page_slug     = is_string( $page['slug'] ?? null ) ? $page['slug'] : '';
		$query_id      = sanitize_key( $page['provider_query_id'] ?? 'native_list' );
		$query_slug    = sanitize_key( $page['query'] ?? '' );
		$filter_keys   = is_array( $page['filters'] ?? null ) ? $page['filters'] : [];
		$native_page   = $page_slug ? get_page_by_path( $page_slug ) : null;
		$archive_page  = $blueprint['pages']['archive']['slug'] ?? 'properties';
		$fallback_page = is_string( $archive_page ) && '' !== $archive_page ? get_page_by_path( $archive_page ) : null;

		$checks[] = [
			'status'  => $fallback_page ? 'ok' : 'error',
			'message' => $fallback_page
				? "Stable Properties fallback page exists: {$archive_page}"
				: "Stable Properties fallback page missing: {$archive_page}",
		];

		if ( ! $this->is_jetsmartfilters_available() ) {
			$checks[] = [
				'status'  => 'ok',
				'message' => 'Native JetSmartFilters proof skipped because JetSmartFilters is optional; /properties/ fallback remains active.',
			];

			return $checks;
		}

		if ( ! $native_page ) {
			$checks[] = [
				'status'  => 'error',
				'message' => "Native JetSmartFilters proof page missing: {$page_slug}",
			];

			return $checks;
		}

		$content      = (string) $native_page->post_content;
		$query_row_id = $this->resolve_jetengine_query_row_id( $query_slug, $query_id );
		$filter_count = substr_count( $content, 'wp:jet-smart-filters/select' );
		$expected_filters = max( 1, count( $filter_keys ) );

		$checks[] = [
			'status'  => 'publish' === $native_page->post_status ? 'ok' : 'error',
			'message' => 'publish' === $native_page->post_status
				? "Native JetSmartFilters proof page published: {$page_slug}"
				: "Native JetSmartFilters proof page not published: {$page_slug}",
		];

		$checks[] = [
			'status'  => $filter_count >= $expected_filters ? 'ok' : 'error',
			'message' => $filter_count >= $expected_filters
				? "Native JetSmartFilters select blocks present: {$filter_count}"
				: "Native JetSmartFilters select blocks missing: {$page_slug}",
		];

		$checks[] = [
			'status'  => false !== strpos( $content, '"query_id":"' . $query_id . '"' ) ? 'ok' : 'error',
			'message' => false !== strpos( $content, '"query_id":"' . $query_id . '"' )
				? "Native JetSmartFilters query ID bound: {$query_id}"
				: "Native JetSmartFilters query ID missing from page: {$query_id}",
		];

		$checks[] = [
			'status'  => false !== strpos( $content, '"content_provider":"jet-engine"' ) ? 'ok' : 'error',
			'message' => false !== strpos( $content, '"content_provider":"jet-engine"' )
				? 'Native JetSmartFilters content provider is JetEngine.'
				: 'Native JetSmartFilters content provider binding missing.',
		];

		$checks[] = [
			'status'  => false !== strpos( $content, '"additional_providers_enabled":false' ) ? 'ok' : 'error',
			'message' => false !== strpos( $content, '"additional_providers_enabled":false' )
				? 'Native JetSmartFilters additional providers disabled.'
				: 'Native JetSmartFilters additional providers should be disabled.',
		];

		$checks[] = [
			'status'  => false !== strpos( $content, 'wp:jet-engine/listing-grid' ) ? 'ok' : 'error',
			'message' => false !== strpos( $content, 'wp:jet-engine/listing-grid' )
				? 'Native JetEngine Listing Grid block present.'
				: 'Native JetEngine Listing Grid block missing.',
		];

		$checks[] = [
			'status'  => false !== strpos( $content, '"_element_id":"' . $query_id . '"' ) ? 'ok' : 'error',
			'message' => false !== strpos( $content, '"_element_id":"' . $query_id . '"' )
				? "Native Listing Grid element ID bound: {$query_id}"
				: "Native Listing Grid element ID missing: {$query_id}",
		];

		$checks[] = [
			'status'  => $query_row_id > 0 ? 'ok' : 'error',
			'message' => $query_row_id > 0
				? "Native Query Builder row resolved: {$query_id}"
				: "Native Query Builder row missing: {$query_id}",
		];

		$custom_query_matches = $query_row_id > 0 && false !== strpos( $content, '"custom_query_id":"' . $query_row_id . '"' );

		$checks[] = [
			'status'  => $custom_query_matches ? 'ok' : 'error',
			'message' => $custom_query_matches
				? "Native Listing Grid custom query ID matches row: {$query_row_id}"
				: "Native Listing Grid custom query ID does not match Query Builder row: {$query_id}",
		];

		foreach ( $filter_keys as $filter_key ) {
			$filter_key = sanitize_key( $filter_key );
			$filter_id  = $this->find_jetsmartfilters_filter_id( $filter_key );

			$checks[] = [
				'status'  => $filter_id > 0 ? 'ok' : 'error',
				'message' => $filter_id > 0
					? "Native JetSmartFilters Factory filter resolved: {$filter_key}"
					: "Native JetSmartFilters Factory filter missing: {$filter_key}",
			];
		}

		return $checks;
	}

	private function validate_front_page( array $blueprint ): ?array {
		$home = $this->get_configured_page( $blueprint, 'home' );

		if ( empty( $home ) || true !== ( $home['front_page'] ?? false ) ) {
			return null;
		}

		$page_slug = $home['slug'] ?? '';
		$page      = $page_slug ? get_page_by_path( $page_slug ) : null;

		if ( ! $page ) {
			return [
				'status'  => 'error',
				'message' => "Homepage page missing: {$page_slug}",
			];
		}

		$is_valid = $this->is_front_page( $page );

		return [
			'status'  => $is_valid ? 'ok' : 'error',
			'message' => $is_valid
				? "Homepage set to Home page: {$page_slug}"
				: "Homepage not set to Home page: {$page_slug}",
		];
	}

	private function validate_archive_not_front_page( array $blueprint ): ?array {
		$archive = $blueprint['pages']['archive'] ?? [];

		if ( ! is_array( $archive ) ) {
			return null;
		}

		$page_slug = $archive['slug'] ?? '';
		$page      = $page_slug ? get_page_by_path( $page_slug ) : null;

		if ( ! $page ) {
			return null;
		}

		$is_front_page = $this->is_front_page( $page );

		return [
			'status'  => $is_front_page ? 'error' : 'ok',
			'message' => $is_front_page
				? "Properties archive is incorrectly set as homepage: {$page_slug}"
				: "Properties archive remains available at: {$page_slug}",
		];
	}

	private function is_front_page( WP_Post $page ): bool {
		return 'page' === get_option( 'show_on_front' )
			&& (int) get_option( 'page_on_front' ) === (int) $page->ID;
	}

	private function sync_navigation_menu( array $blueprint ): ?array {
		$config = $this->get_navigation_config( $blueprint );

		if ( empty( $config ) ) {
			return null;
		}

		$menu_name     = $config['menu_name'] ?? '';
		$desired_items = $this->get_navigation_desired_items( $blueprint, $config );

		if ( ! $menu_name || empty( $desired_items ) ) {
			return null;
		}

		foreach ( $desired_items as $item ) {
			if ( empty( $item['page_id'] ) ) {
				return $this->execution_item(
					'error',
					'update',
					$menu_name,
					"Navigation page missing: {$item['label']}",
					'menu'
				);
			}
		}

		$menu    = wp_get_nav_menu_object( $menu_name );
		$created = false;

		if ( ! $menu ) {
			$menu_id = wp_create_nav_menu( $menu_name );

			if ( is_wp_error( $menu_id ) || ! $menu_id ) {
				return $this->execution_item(
					'error',
					'create',
					$menu_name,
					"Navigation menu create failed: {$menu_name}",
					'menu'
				);
			}

			$menu    = wp_get_nav_menu_object( $menu_id );
			$created = true;
		}

		$menu_id     = (int) $menu->term_id;
		$location    = $this->get_navigation_location( $config );
		$is_current  = $this->is_navigation_menu_current( $menu_id, $desired_items );
		$is_assigned = $location ? $this->is_navigation_location_assigned( $location, $menu_id ) : false;
		$current_menu_state = $this->get_current_navigation_menu_state( $menu_id );
		$target_menu_state  = $this->get_target_navigation_menu_state( $desired_items );

		if ( ! $created && ! $is_current && factory_is_term_user_modified( $menu_id, $current_menu_state, $target_menu_state ) ) {
			factory_mark_term_user_modified( $menu_id );

			return $this->execution_item(
				'warning',
				'skip',
				$menu_name,
				'Manual menu changes detected; menu was preserved.',
				'menu'
			);
		}

		if ( $is_current && ( $is_assigned || ! $location ) ) {
			$this->mark_navigation_menu_factory_managed( $menu_id, $target_menu_state );
			$status = $location ? 'ok' : 'warning';
			$message = $location
				? "Navigation menu up-to-date: {$menu_name}"
				: "Navigation menu has no theme location available: {$menu_name}";

			return $this->execution_item(
				$status,
				'skip',
				$menu_name,
				$message,
				'menu'
			);
		}

		if ( ! $is_current ) {
			$existing_items = wp_get_nav_menu_items( $menu_id );

			if ( is_array( $existing_items ) ) {
				foreach ( $existing_items as $item ) {
					wp_delete_post( (int) $item->ID, true );
				}
			}

			foreach ( $desired_items as $index => $item ) {
				$item_id = wp_update_nav_menu_item(
					$menu_id,
					0,
					[
						'menu-item-title'     => $item['label'],
						'menu-item-object-id' => $item['page_id'],
						'menu-item-object'    => 'page',
						'menu-item-type'      => 'post_type',
						'menu-item-status'    => 'publish',
						'menu-item-position'  => $index + 1,
					]
				);

				if ( is_wp_error( $item_id ) || ! $item_id ) {
					return $this->execution_item(
						'error',
						'update',
						$menu_name,
						"Navigation menu item update failed: {$item['label']}",
						'menu'
					);
				}
			}

			$this->mark_navigation_menu_factory_managed( $menu_id, $target_menu_state );
		}

		if ( $location && ! $is_assigned ) {
			$locations              = get_theme_mod( 'nav_menu_locations', [] );
			$locations[ $location ] = $menu_id;
			set_theme_mod( 'nav_menu_locations', $locations );
		}

		$this->mark_navigation_menu_factory_managed( $menu_id, $target_menu_state );

		if ( ! $location ) {
			return $this->execution_item(
				'warning',
				$created ? 'create' : 'update',
				$menu_name,
				"Navigation menu updated but no theme location is available: {$menu_name}",
				'menu'
			);
		}

		return $this->execution_item(
			'ok',
			$created ? 'create' : 'update',
			$menu_name,
			$created
				? "Navigation menu created: {$menu_name}"
				: "Navigation menu updated: {$menu_name}",
			'menu'
		);
	}

	private function get_navigation_plan_item( array $blueprint ): ?array {
		$config = $this->get_navigation_config( $blueprint );

		if ( empty( $config ) ) {
			return null;
		}

		$menu_name     = $config['menu_name'] ?? '';
		$desired_items = $this->get_navigation_desired_items( $blueprint, $config );

		if ( ! $menu_name || empty( $desired_items ) ) {
			return null;
		}

		$menu     = wp_get_nav_menu_object( $menu_name );
		$location = $this->get_navigation_location( $config );

		if ( ! $location ) {
			return [
				'action'  => 'warning',
				'type'    => 'menu',
				'entity'  => $menu_name,
				'message' => "Navigation menu has no theme location available: {$menu_name}",
				'diff'    => [],
			];
		}

		if ( ! $menu ) {
			return [
				'action'  => 'create',
				'type'    => 'menu',
				'entity'  => $menu_name,
				'message' => "Create navigation menu: {$menu_name}",
				'diff'    => [],
			];
		}

		$menu_id    = (int) $menu->term_id;
		$is_current = $this->is_navigation_menu_current( $menu_id, $desired_items )
			&& $this->is_navigation_location_assigned( $location, $menu_id );

		if (
			! $this->is_navigation_menu_current( $menu_id, $desired_items )
			&& factory_is_term_user_modified(
				$menu_id,
				$this->get_current_navigation_menu_state( $menu_id ),
				$this->get_target_navigation_menu_state( $desired_items )
			)
		) {
			return [
				'action'  => 'warning',
				'type'    => 'menu',
				'entity'  => $menu_name,
				'message' => 'Manual menu changes detected; menu will be preserved.',
				'diff'    => [],
			];
		}

		return [
			'action'  => $is_current ? 'skip' : 'update',
			'type'    => 'menu',
			'entity'  => $menu_name,
			'message' => $is_current
				? "Navigation menu up-to-date: {$menu_name}"
				: "Update navigation menu: {$menu_name}",
			'diff'    => [],
		];
	}

	private function validate_navigation_menu( array $blueprint ): ?array {
		$config = $this->get_navigation_config( $blueprint );

		if ( empty( $config ) ) {
			return null;
		}

		$menu_name     = $config['menu_name'] ?? '';
		$desired_items = $this->get_navigation_desired_items( $blueprint, $config );

		if ( ! $menu_name || empty( $desired_items ) ) {
			return null;
		}

		foreach ( $desired_items as $item ) {
			if ( empty( $item['page_id'] ) ) {
				return [
					'status'  => 'error',
					'message' => "Navigation page missing: {$item['label']}",
				];
			}
		}

		$menu = wp_get_nav_menu_object( $menu_name );

		if ( ! $menu ) {
			return [
				'status'  => 'error',
				'message' => "Navigation menu missing: {$menu_name}",
			];
		}

		$menu_id = (int) $menu->term_id;

		if ( ! $this->is_navigation_menu_current( $menu_id, $desired_items ) ) {
			if (
				factory_is_term_user_modified(
					$menu_id,
					$this->get_current_navigation_menu_state( $menu_id ),
					$this->get_target_navigation_menu_state( $desired_items )
				)
			) {
				return [
					'status'  => 'warning',
					'message' => 'Manual menu changes preserved.',
				];
			}

			return [
				'status'  => 'error',
				'message' => "Navigation menu out of sync: {$menu_name}",
			];
		}

		$location = $this->get_navigation_location( $config );

		if ( ! $location ) {
			return [
				'status'  => 'warning',
				'message' => "Navigation menu has no theme location available: {$menu_name}",
			];
		}

		if ( ! $this->is_navigation_location_assigned( $location, $menu_id ) ) {
			return [
				'status'  => 'error',
				'message' => "Navigation menu not assigned to theme location: {$location}",
			];
		}

		return [
			'status'  => 'ok',
			'message' => "Navigation menu ready: {$menu_name}",
		];
	}

	private function get_navigation_config( array $blueprint ): array {
		$config = $blueprint['pages']['navigation'] ?? [];

		return is_array( $config ) ? $config : [];
	}

	private function get_navigation_desired_items( array $blueprint, array $config ): array {
		$items = [];

		foreach ( $config['items'] ?? [] as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}

			$page_key    = $item['page'] ?? '';
			$page_config = $this->get_configured_page( $blueprint, $page_key );
			$page_slug   = $page_config['slug'] ?? '';
			$page        = $page_slug ? get_page_by_path( $page_slug ) : null;

			$items[] = [
				'label'   => $item['label'] ?? ( $page_config['title'] ?? $this->humanize_key( $page_key ) ),
				'page'    => $page_key,
				'slug'    => $page_slug,
				'page_id' => $page ? (int) $page->ID : 0,
			];
		}

		return $items;
	}

	private function is_navigation_menu_current( int $menu_id, array $desired_items ): bool {
		$current_items = wp_get_nav_menu_items(
			$menu_id,
			[
				'orderby' => 'menu_order',
				'order'   => 'ASC',
			]
		);

		if ( ! is_array( $current_items ) || count( $current_items ) !== count( $desired_items ) ) {
			return false;
		}

		foreach ( $desired_items as $index => $desired ) {
			$current = $current_items[ $index ] ?? null;

			if ( ! $current ) {
				return false;
			}

			if ( (int) $current->object_id !== (int) $desired['page_id'] ) {
				return false;
			}

			if ( (string) $current->title !== (string) $desired['label'] ) {
				return false;
			}
		}

		return true;
	}

	private function get_current_navigation_menu_state( int $menu_id ): array {
		$current_items = wp_get_nav_menu_items(
			$menu_id,
			[
				'orderby' => 'menu_order',
				'order'   => 'ASC',
			]
		);

		if ( ! is_array( $current_items ) ) {
			return [
				'items' => [],
			];
		}

		$items = [];

		foreach ( $current_items as $item ) {
			$items[] = [
				'title'     => (string) $item->title,
				'object_id' => (int) $item->object_id,
				'type'      => (string) $item->type,
				'object'    => (string) $item->object,
			];
		}

		return [
			'items' => $items,
		];
	}

	private function get_target_navigation_menu_state( array $desired_items ): array {
		$items = [];

		foreach ( $desired_items as $item ) {
			$items[] = [
				'title'     => (string) ( $item['label'] ?? '' ),
				'object_id' => (int) ( $item['page_id'] ?? 0 ),
				'type'      => 'post_type',
				'object'    => 'page',
			];
		}

		return [
			'items' => $items,
		];
	}

	private function mark_navigation_menu_factory_managed( int $menu_id, array $target_state ): void {
		factory_mark_term_managed(
			$menu_id,
			[
				'source'      => 'real-estate',
				'entity_type' => 'menu',
				'hash'        => factory_ownership_hash_state( $target_state ),
			]
		);
	}

	private function get_navigation_location( array $config ): string {
		$locations = get_registered_nav_menus();

		if ( empty( $locations ) ) {
			return '';
		}

		$preferred = $config['theme_location'] ?? 'main';

		if ( $preferred && isset( $locations[ $preferred ] ) ) {
			return $preferred;
		}

		return (string) array_key_first( $locations );
	}

	private function is_navigation_location_assigned( string $location, int $menu_id ): bool {
		$locations = get_theme_mod( 'nav_menu_locations', [] );

		return isset( $locations[ $location ] ) && (int) $locations[ $location ] === $menu_id;
	}

	private function validate_home_queries( array $blueprint ): array {
		$results = [];
		$home    = $this->get_configured_page( $blueprint, 'home' );

		if ( empty( $home['sections'] ) || ! is_array( $home['sections'] ) ) {
			return $results;
		}

		foreach ( $home['sections'] as $section ) {
			if ( ! is_array( $section ) || 'listing' !== ( $section['type'] ?? '' ) ) {
				continue;
			}

			$query_key    = $section['query'] ?? '';
			$listing_slug = $section['listing'] ?? '';
			$listing      = $this->get_listing_by_slug( $blueprint, $listing_slug );

			if ( ! $query_key || empty( $listing ) ) {
				$results[] = [
					'status'  => 'error',
					'message' => 'Home listing section is missing query or listing.',
				];
				continue;
			}

			$query_args = $this->get_listing_query_args( $listing, $blueprint, $query_key );

			if ( empty( $query_args ) ) {
				$results[] = [
					'status'  => 'error',
					'message' => "Home query missing: {$query_key}",
				];
				continue;
			}

			$query = new WP_Query( $query_args );

			$results[] = [
				'status'  => $query->have_posts() ? 'ok' : 'error',
				'message' => $query->have_posts()
					? "Home query renders: {$query_key}"
					: "Home query has no posts: {$query_key}",
			];

			wp_reset_postdata();
		}

		return $results;
	}

	private function execution_item(
		string $status,
		string $action,
		string $entity,
		string $message,
		string $type = 'render'
	): array {
		return [
			'status'  => $status,
			'action'  => $action,
			'type'    => $type,
			'entity'  => $entity,
			'message' => $message,
			'details' => [],
		];
	}

	public function render_listing_shortcode( array $atts ): string {
		$atts = shortcode_atts(
			[
				'slug'  => '',
				'query' => '',
			],
			$atts
		);

		$blueprint = factory_get_blueprint();

		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			if ( ( $listing['slug'] ?? '' ) === $atts['slug'] ) {
				return $this->render_listing( $listing, $blueprint, (string) $atts['query'] );
			}
		}

		return '';
	}

	private function render_listing( array $listing, array $blueprint, string $query_key = '' ): string {
		$post_type = $listing['post_type'] ?? '';

		if ( ! $post_type ) {
			return '';
		}

		$is_property_listing = 'property' === $post_type;
		$is_property_archive = $is_property_listing && '' === $query_key;
		$style_tokens        = $this->get_site_style_tokens( $blueprint );
		$property_filters    = $is_property_archive ? $this->get_property_filter_state() : [];
		$query_args          = $this->get_listing_query_args( $listing, $blueprint, $query_key );

		if ( empty( $query_args ) ) {
			return '<p>No query found.</p>';
		}

		if ( $is_property_archive ) {
			$query_args = $this->apply_property_filters_to_query_args( $query_args, $property_filters );
			$query_args = $this->apply_property_archive_controls_to_query_args( $query_args, $property_filters );
		}

		$query = new WP_Query( $query_args );

		if ( ! $query->have_posts() && ! $is_property_archive ) {
			return '<p>No items found.</p>';
		}

		$fields                = $this->get_render_fields( $listing, $blueprint, $post_type );
		$archive_visual_images = $is_property_archive ? $this->get_property_archive_visual_images( $query ) : [];

		ob_start();
		?>

		<?php if ( '' === $query_key ) : ?>
			<section class="factory-listing-wrap" style="max-width: 1160px; margin: 38px auto 34px; padding: 0 24px;">
				<?php if ( $is_property_archive ) : ?>
					<header style="position: relative; margin-bottom: 28px; border: 1px solid <?php echo esc_attr( $style_tokens['border'] ); ?>; border-radius: 24px; background: <?php echo esc_attr( $style_tokens['background'] ); ?>; overflow: hidden;">
						<?php if ( ! empty( $archive_visual_images ) ) : ?>
							<div aria-hidden="true" style="position: absolute; inset: 0;">
								<?php foreach ( $archive_visual_images as $index => $image ) : ?>
									<div style="position: absolute; inset: 0; background-image: url('<?php echo esc_url( $image ); ?>'); background-size: cover; background-position: center; opacity: <?php echo 0 === $index ? '0.18' : '0.08'; ?>; transform: scale(<?php echo esc_attr( 1 + ( $index * 0.03 ) ); ?>);"></div>
								<?php endforeach; ?>
							</div>
						<?php endif; ?>
						<div style="position: absolute; inset: 0; background: linear-gradient(90deg, <?php echo esc_attr( $style_tokens['background'] ); ?> 0%, rgba(255,255,255,0.92) 72%, rgba(255,255,255,0.7) 100%);"></div>
						<div style="position: relative; padding: clamp(24px, 4vw, 38px);">
							<span style="display: inline-flex; border-radius: 999px; background: <?php echo esc_attr( $style_tokens['surface'] ); ?>; color: <?php echo esc_attr( $style_tokens['primary'] ); ?>; padding: 8px 12px; font-size: 13px; font-weight: 900; margin-bottom: 14px;">
								Findero-style search
							</span>
							<h1 style="font-size: clamp(32px, 4.2vw, 50px); line-height: 1.06; margin: 0 0 10px; color: <?php echo esc_attr( $style_tokens['heading'] ); ?>;">
								Find your next Kyiv property
							</h1>
							<p style="max-width: 720px; color: <?php echo esc_attr( $style_tokens['muted'] ); ?>; font-size: 16px; line-height: 1.62; margin: 0;">
								Explore generated Kyiv listings with stable filters, sorting, pagination, and Request Viewing links.
							</p>
						</div>
					</header>
					<div class="factory-property-search-layout" style="display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 28px; align-items: start;">
						<aside style="position: sticky; top: 24px;">
							<?php echo $this->render_property_filters( $property_filters, $query, $style_tokens ); ?>
						</aside>
						<div>
							<?php echo $this->render_property_results_header( $property_filters, $query, $style_tokens ); ?>
				<?php else : ?>
					<header style="margin-bottom: 40px;">
						<h1 style="font-size: clamp(40px, 6vw, 72px); line-height: 1.05;">
							<?php echo esc_html( $listing['title'] ?? 'Listing' ); ?>
						</h1>
					</header>
				<?php endif; ?>
		<?php endif; ?>

		<?php if ( $query->have_posts() ) : ?>
			<div class="factory-listing-grid" style="display: grid; grid-template-columns: <?php echo $is_property_archive ? '1fr' : 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))'; ?>; gap: 24px;">
				<?php
				while ( $query->have_posts() ) :
					$query->the_post();

					if ( $is_property_listing ) {
						echo $this->render_property_card( get_the_ID(), $style_tokens, $is_property_archive ? 'row' : 'grid' );
						continue;
					}
					?>

					<article class="factory-card" style="border: 1px solid #e5e5e5; border-radius: 18px; padding: 24px;">
						<?php if ( has_post_thumbnail() ) : ?>
							<a href="<?php the_permalink(); ?>" style="display: block; margin: -24px -24px 20px; overflow: hidden; border-radius: 18px 18px 0 0;">
								<?php
								echo get_the_post_thumbnail(
									get_the_ID(),
									'medium_large',
									[
										'style' => 'display: block; width: 100%; height: 220px; object-fit: cover;',
									]
								);
								?>
							</a>
						<?php endif; ?>

						<h2 style="font-size: 24px; margin: 0 0 16px;">
							<a href="<?php the_permalink(); ?>" style="text-decoration: none;">
								<?php the_title(); ?>
							</a>
						</h2>

						<?php foreach ( $fields as $field ) : ?>
							<?php
							$key = $field['key'] ?? '';

							if ( ! $key || 'title' === $key ) {
								continue;
							}

							$value = get_post_meta( get_the_ID(), $key, true );

							if ( '' === $value || [] === $value ) {
								continue;
							}

							$label = $field['label'] ?? $this->humanize_key( $key );
							$type  = $field['type'] ?? 'text';
							?>

							<div style="margin-top: 10px;">
								<strong><?php echo esc_html( $label ); ?>:</strong>
								<?php echo esc_html( $this->format_value( $value, $type ) ); ?>
							</div>
						<?php endforeach; ?>
					</article>

				<?php endwhile; ?>
			</div>
		<?php elseif ( $is_property_archive ) : ?>
			<div class="factory-property-empty" style="background: #fff; border: 1px solid #d7eee9; border-radius: 20px; padding: 28px; color: #52635f;">
				<strong style="display: block; color: #10201d; font-size: 18px; margin-bottom: 8px;">
					<?php echo esc_html( 'No properties match your filters.' ); ?>
				</strong>
				<?php echo esc_html( 'Try adjusting your search.' ); ?>
			</div>
		<?php endif; ?>

		<?php if ( $is_property_archive && $query->max_num_pages > 1 ) : ?>
			<?php echo $this->render_property_archive_pagination( $query, $style_tokens ); ?>
		<?php endif; ?>

		<?php if ( $is_property_archive && '' === $query_key ) : ?>
						</div>
					</div>
		<?php endif; ?>

		<?php if ( '' === $query_key ) : ?>
			</section>
			<?php if ( $is_property_archive ) : ?>
				<?php echo $this->render_generated_footer( $blueprint ); ?>
			<?php endif; ?>
		<?php endif; ?>

		<?php
		wp_reset_postdata();

		return ob_get_clean();
	}

	private function get_property_filter_state(): array {
		$options = $this->get_property_filter_options();
		$state   = [
			'purpose'       => '',
			'property_type' => '',
			'district'      => '',
			'bedrooms'      => '',
			'price_min'     => '',
			'price_max'     => '',
			'sort'          => 'newest',
			'per_page'      => '9',
		];

		foreach ( [ 'purpose', 'property_type', 'district', 'bedrooms' ] as $key ) {
			$value = $this->get_query_param_string( $key );

			if ( '' !== $value && in_array( $value, $options[ $key ], true ) ) {
				$state[ $key ] = $value;
			}
		}

		foreach ( [ 'price_min', 'price_max' ] as $key ) {
			$value = $this->get_query_param_string( $key );

			if ( '' !== $value && preg_match( '/^\d+$/', $value ) ) {
				$state[ $key ] = (string) absint( $value );
			}
		}

		$sort = $this->get_query_param_string( 'factory_sort' );

		if ( in_array( $sort, [ 'price_asc', 'price_desc', 'newest' ], true ) ) {
			$state['sort'] = $sort;
		}

		$per_page = $this->get_query_param_string( 'factory_per_page' );

		if ( in_array( $per_page, [ '9', '12', '30' ], true ) ) {
			$state['per_page'] = $per_page;
		}

		if (
			'' !== $state['price_min']
			&& '' !== $state['price_max']
			&& (int) $state['price_min'] > (int) $state['price_max']
		) {
			$min                = $state['price_max'];
			$state['price_max'] = $state['price_min'];
			$state['price_min'] = $min;
		}

		return $state;
	}

	private function get_query_param_string( string $key ): string {
		if ( ! isset( $_GET[ $key ] ) ) {
			return '';
		}

		$value = $_GET[ $key ];

		if ( is_array( $value ) ) {
			return '';
		}

		$value = function_exists( 'wp_unslash' ) ? wp_unslash( $value ) : $value;
		$value = is_string( $value ) || is_numeric( $value ) ? trim( (string) $value ) : '';

		return function_exists( 'sanitize_text_field' ) ? sanitize_text_field( $value ) : $value;
	}

	private function get_property_filter_options(): array {
		return [
			'purpose'       => [ 'Sale', 'Rent' ],
			'property_type' => [ 'Apartment', 'House', 'Commercial' ],
			'district'      => [
				'Pechersk',
				'Obolon',
				'Podil',
				'Holosiivskyi',
				'Shevchenkivskyi',
				'Darnytskyi',
				'Solomianskyi',
				'Desnianskyi',
			],
			'bedrooms'      => [ '1', '2', '3', '4' ],
		];
	}

	private function apply_property_filters_to_query_args( array $args, array $filters ): array {
		$tax_query  = isset( $args['tax_query'] ) && is_array( $args['tax_query'] ) ? $args['tax_query'] : [];
		$meta_query = isset( $args['meta_query'] ) && is_array( $args['meta_query'] ) ? $args['meta_query'] : [];

		foreach ( [ 'purpose', 'property_type', 'district' ] as $taxonomy ) {
			if ( empty( $filters[ $taxonomy ] ) ) {
				continue;
			}

			$slugs = $this->resolve_taxonomy_term_slugs( $taxonomy, [ $filters[ $taxonomy ] ] );

			if ( empty( $slugs ) ) {
				continue;
			}

			$tax_query[] = [
				'taxonomy' => $taxonomy,
				'field'    => 'slug',
				'terms'    => $slugs,
			];
		}

		if ( '' !== ( $filters['bedrooms'] ?? '' ) ) {
			$meta_query[] = [
				'key'     => 'bedrooms',
				'value'   => (int) $filters['bedrooms'],
				'compare' => '>=',
				'type'    => 'NUMERIC',
			];
		}

		if ( '' !== ( $filters['price_min'] ?? '' ) && '' !== ( $filters['price_max'] ?? '' ) ) {
			$meta_query[] = [
				'key'     => 'price',
				'value'   => [ (int) $filters['price_min'], (int) $filters['price_max'] ],
				'compare' => 'BETWEEN',
				'type'    => 'NUMERIC',
			];
		} elseif ( '' !== ( $filters['price_min'] ?? '' ) ) {
			$meta_query[] = [
				'key'     => 'price',
				'value'   => (int) $filters['price_min'],
				'compare' => '>=',
				'type'    => 'NUMERIC',
			];
		} elseif ( '' !== ( $filters['price_max'] ?? '' ) ) {
			$meta_query[] = [
				'key'     => 'price',
				'value'   => (int) $filters['price_max'],
				'compare' => '<=',
				'type'    => 'NUMERIC',
			];
		}

		if ( ! empty( $tax_query ) ) {
			if ( count( $tax_query ) > 1 ) {
				$tax_query['relation'] = 'AND';
			}

			$args['tax_query'] = $tax_query;
		}

		if ( ! empty( $meta_query ) ) {
			if ( count( $meta_query ) > 1 ) {
				$meta_query['relation'] = 'AND';
			}

			$args['meta_query'] = $meta_query;
		}

		return $args;
	}

	private function apply_property_archive_controls_to_query_args( array $args, array $filters ): array {
		$per_page = isset( $filters['per_page'] ) ? absint( $filters['per_page'] ) : 9;

		if ( ! in_array( $per_page, [ 9, 12, 30 ], true ) ) {
			$per_page = 9;
		}

		$args['posts_per_page'] = $per_page;
		$args['paged']          = $this->get_property_archive_current_page();

		switch ( $filters['sort'] ?? 'newest' ) {
			case 'price_asc':
				$args['meta_key'] = 'price';
				$args['orderby']  = 'meta_value_num';
				$args['order']    = 'ASC';
				break;

			case 'price_desc':
				$args['meta_key'] = 'price';
				$args['orderby']  = 'meta_value_num';
				$args['order']    = 'DESC';
				break;

			case 'newest':
			default:
				$args['orderby'] = 'date';
				$args['order']   = 'DESC';
				break;
		}

		return $args;
	}

	private function get_property_archive_current_page(): int {
		$paged = (int) get_query_var( 'paged' );

		if ( $paged < 1 ) {
			$paged = (int) get_query_var( 'page' );
		}

		return max( 1, $paged );
	}

	private function render_property_filters( array $filters, WP_Query $query, array $style_tokens ): string {
		$options   = $this->get_property_filter_options();
		$reset_url = $this->get_property_filter_reset_url();
		$border    = $style_tokens['border'];
		$text      = $style_tokens['text'];
		$surface   = $style_tokens['surface'];

		ob_start();
		?>

		<form id="factory-property-search" class="factory-property-filters" method="get" action="<?php echo esc_url( $reset_url ); ?>" style="background: <?php echo esc_attr( $style_tokens['surface'] ); ?>; border: 1px solid <?php echo esc_attr( $border ); ?>; border-radius: 22px; padding: 20px; margin: 0; box-shadow: 0 16px 38px rgba(15, 118, 110, 0.08);">
			<h2 style="font-size: 24px; line-height: 1.2; margin: 0 0 18px; color: <?php echo esc_attr( $style_tokens['heading'] ); ?>;">
				Find Property
			</h2>

			<div style="display: grid; gap: 14px;">
				<?php echo $this->render_property_filter_select( 'purpose', 'Purpose', $filters['purpose'], $options['purpose'], [], $style_tokens ); ?>
				<?php echo $this->render_property_filter_select( 'district', 'Location', $filters['district'], $options['district'], [], $style_tokens ); ?>
				<?php echo $this->render_property_filter_select( 'property_type', 'Property Type', $filters['property_type'], $options['property_type'], [], $style_tokens ); ?>
				<?php echo $this->render_property_filter_select( 'bedrooms', 'Bedrooms', $filters['bedrooms'], $options['bedrooms'], [ '1' => '1+', '2' => '2+', '3' => '3+', '4' => '4+' ], $style_tokens ); ?>

				<label style="display: grid; gap: 7px; color: <?php echo esc_attr( $text ); ?>; font-size: 13px; font-weight: 800;">
					<?php echo esc_html( 'Price min' ); ?>
					<input type="number" min="0" step="1" name="price_min" value="<?php echo esc_attr( $filters['price_min'] ); ?>" placeholder="100000" style="width: 100%; border: 1px solid <?php echo esc_attr( $border ); ?>; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: <?php echo esc_attr( $surface ); ?>;">
				</label>

				<label style="display: grid; gap: 7px; color: <?php echo esc_attr( $text ); ?>; font-size: 13px; font-weight: 800;">
					<?php echo esc_html( 'Price max' ); ?>
					<input type="number" min="0" step="1" name="price_max" value="<?php echo esc_attr( $filters['price_max'] ); ?>" placeholder="300000" style="width: 100%; border: 1px solid <?php echo esc_attr( $border ); ?>; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: <?php echo esc_attr( $surface ); ?>;">
				</label>

				<div style="display: flex; gap: 10px; flex-wrap: wrap;">
					<button type="submit" style="border: 0; border-radius: 999px; background: <?php echo esc_attr( $style_tokens['button'] ); ?>; color: <?php echo esc_attr( $style_tokens['button_text'] ); ?>; min-height: 42px; padding: 0 18px; font-weight: 800; cursor: pointer;">
						<?php echo esc_html( 'Search' ); ?>
					</button>
					<a class="factory-button-link" href="<?php echo esc_url( $reset_url ); ?>" style="display: inline-flex; align-items: center; min-height: 42px; color: <?php echo esc_attr( $style_tokens['link'] ); ?>; font-weight: 800; text-decoration: none;">
						<?php echo esc_html( 'Reset' ); ?>
					</a>
				</div>
			</div>
		</form>

		<?php
		return ob_get_clean();
	}

	private function render_property_results_header( array $filters, WP_Query $query, array $style_tokens ): string {
		$count = (int) $query->found_posts;
		$label = 1 === $count ? 'property found' : 'properties found';

		ob_start();
		?>

		<header style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 18px;">
			<div>
				<h2 style="font-size: clamp(26px, 3vw, 36px); line-height: 1.12; margin: 0 0 6px; color: <?php echo esc_attr( $style_tokens['heading'] ); ?>;">
					Search Results
				</h2>
				<div style="color: <?php echo esc_attr( $style_tokens['muted'] ); ?>; font-size: 15px; font-weight: 800;">
					<?php echo esc_html( "{$count} {$label}" ); ?>
				</div>
			</div>

			<div style="display: grid; grid-template-columns: repeat(2, minmax(138px, 1fr)); gap: 10px; min-width: min(100%, 330px);">
				<label style="display: grid; gap: 7px; color: <?php echo esc_attr( $style_tokens['text'] ); ?>; font-size: 13px; font-weight: 800;">
					<?php echo esc_html( 'Sort by' ); ?>
					<select name="factory_sort" form="factory-property-search" style="width: 100%; border: 1px solid <?php echo esc_attr( $style_tokens['border'] ); ?>; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: <?php echo esc_attr( $style_tokens['surface'] ); ?>; color: <?php echo esc_attr( $style_tokens['text'] ); ?>;" onchange="this.form.requestSubmit ? this.form.requestSubmit() : this.form.submit();">
						<option value="newest" <?php selected( $filters['sort'], 'newest' ); ?>><?php echo esc_html( 'Ordinary / Newest' ); ?></option>
						<option value="price_asc" <?php selected( $filters['sort'], 'price_asc' ); ?>><?php echo esc_html( 'Price: low to high' ); ?></option>
						<option value="price_desc" <?php selected( $filters['sort'], 'price_desc' ); ?>><?php echo esc_html( 'Price: high to low' ); ?></option>
					</select>
				</label>

				<label style="display: grid; gap: 7px; color: <?php echo esc_attr( $style_tokens['text'] ); ?>; font-size: 13px; font-weight: 800;">
					<?php echo esc_html( 'Per page' ); ?>
					<select name="factory_per_page" form="factory-property-search" style="width: 100%; border: 1px solid <?php echo esc_attr( $style_tokens['border'] ); ?>; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: <?php echo esc_attr( $style_tokens['surface'] ); ?>; color: <?php echo esc_attr( $style_tokens['text'] ); ?>;" onchange="this.form.requestSubmit ? this.form.requestSubmit() : this.form.submit();">
						<?php foreach ( [ '9', '12', '30' ] as $per_page ) : ?>
							<option value="<?php echo esc_attr( $per_page ); ?>" <?php selected( $filters['per_page'], $per_page ); ?>>
								<?php echo esc_html( $per_page ); ?>
							</option>
						<?php endforeach; ?>
					</select>
				</label>
			</div>
		</header>

		<?php
		return ob_get_clean();
	}

	private function render_property_archive_pagination( WP_Query $query, array $style_tokens ): string {
		$links = paginate_links( [
			'base'      => esc_url_raw( add_query_arg( 'paged', '%#%' ) ),
			'format'    => '',
			'current'   => $this->get_property_archive_current_page(),
			'total'     => max( 1, (int) $query->max_num_pages ),
			'type'      => 'array',
			'prev_text' => 'Previous',
			'next_text' => 'Next',
			'add_args'  => $this->get_property_archive_pagination_args(),
		] );

		if ( empty( $links ) || ! is_array( $links ) ) {
			return '';
		}

		ob_start();
		?>

		<nav class="factory-property-pagination" aria-label="<?php echo esc_attr( 'Property pagination' ); ?>" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; margin: 32px 0 0;">
			<?php foreach ( $links as $link ) : ?>
				<span style="display: inline-flex; min-height: 40px; min-width: 40px; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid <?php echo esc_attr( $style_tokens['border'] ); ?>; background: <?php echo false !== strpos( $link, 'current' ) ? esc_attr( $style_tokens['primary'] ) : esc_attr( $style_tokens['surface'] ); ?>; color: <?php echo false !== strpos( $link, 'current' ) ? '#fff' : esc_attr( $style_tokens['link'] ); ?>; font-weight: 900; overflow: hidden;">
					<?php echo wp_kses_post( $link ); ?>
				</span>
			<?php endforeach; ?>
		</nav>

		<?php
		return ob_get_clean();
	}

	private function get_property_archive_pagination_args(): array {
		$args = [];

		foreach ( [ 'purpose', 'property_type', 'district', 'bedrooms', 'price_min', 'price_max', 'factory_sort', 'factory_per_page' ] as $key ) {
			$value = $this->get_query_param_string( $key );

			if ( '' !== $value ) {
				$args[ $key ] = $value;
			}
		}

		return $args;
	}

	private function get_property_archive_visual_images( WP_Query $query ): array {
		$images = [];

		foreach ( $query->posts as $post ) {
			if ( ! $post instanceof WP_Post ) {
				continue;
			}

			$thumbnail_id = get_post_thumbnail_id( $post->ID );

			if ( ! $thumbnail_id ) {
				continue;
			}

			$url = wp_get_attachment_image_url( $thumbnail_id, 'large' );

			if ( $url ) {
				$images[] = $url;
			}

			if ( count( $images ) >= 3 ) {
				break;
			}
		}

		return $images;
	}

	private function render_property_filter_select(
		string $name,
		string $label,
		string $selected,
		array $options,
		array $labels,
		array $style_tokens
	): string {
		ob_start();
		?>

		<label style="display: grid; gap: 7px; color: <?php echo esc_attr( $style_tokens['text'] ); ?>; font-size: 13px; font-weight: 800;">
			<?php echo esc_html( $label ); ?>
			<select name="<?php echo esc_attr( $name ); ?>" style="width: 100%; border: 1px solid <?php echo esc_attr( $style_tokens['border'] ); ?>; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: <?php echo esc_attr( $style_tokens['surface'] ); ?>; color: <?php echo esc_attr( $style_tokens['text'] ); ?>;">
				<option value=""><?php echo esc_html( 'Any' ); ?></option>
				<?php foreach ( $options as $option ) : ?>
					<option value="<?php echo esc_attr( $option ); ?>" <?php selected( $selected, $option ); ?>>
						<?php echo esc_html( $labels[ $option ] ?? $option ); ?>
					</option>
				<?php endforeach; ?>
			</select>
		</label>

		<?php
		return ob_get_clean();
	}

	private function get_property_filter_reset_url(): string {
		$permalink = get_permalink();

		if ( $permalink ) {
			return $permalink;
		}

		return home_url( '/properties/' );
	}

	private function get_listing_query_args( array $listing, array $blueprint, string $query_key = '' ): array {
		$post_type = $listing['post_type'] ?? '';

		if ( ! $post_type ) {
			return [];
		}

		if ( '' === $query_key ) {
			return [
				'post_type'      => $post_type,
				'post_status'    => 'publish',
				'posts_per_page' => 'property' === $post_type ? 30 : 12,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			];
		}

		$definition = $blueprint['pages']['queries'][ $query_key ] ?? null;

		if ( ! is_array( $definition ) ) {
			return [];
		}

		$args = [
			'post_type'      => sanitize_key( $definition['post_type'] ?? $post_type ),
			'post_status'    => 'publish',
			'posts_per_page' => max( 1, min( 30, absint( $definition['posts_per_page'] ?? 6 ) ) ),
			'orderby'        => $this->sanitize_orderby( $definition['orderby'] ?? 'date' ),
			'order'          => $this->sanitize_order( $definition['order'] ?? 'DESC' ),
		];

		$taxonomies = $definition['taxonomies'] ?? [];
		$tax_query  = [];

		if ( is_array( $taxonomies ) ) {
			foreach ( $taxonomies as $taxonomy => $terms ) {
				$taxonomy = sanitize_key( $taxonomy );
				$terms    = is_array( $terms ) ? $terms : [ $terms ];
				$slugs    = $this->resolve_taxonomy_term_slugs( $taxonomy, $terms );

				if ( ! $taxonomy || empty( $slugs ) ) {
					continue;
				}

				$tax_query[] = [
					'taxonomy' => $taxonomy,
					'field'    => 'slug',
					'terms'    => $slugs,
				];
			}
		}

		if ( ! empty( $tax_query ) ) {
			$args['tax_query'] = $tax_query;
		}

		return $args;
	}

	private function sanitize_orderby( $value ): string {
		$value   = is_string( $value ) ? $value : 'date';
		$allowed = [ 'date', 'ID', 'title', 'menu_order', 'modified' ];

		return in_array( $value, $allowed, true ) ? $value : 'date';
	}

	private function sanitize_order( $value ): string {
		$value = strtoupper( is_string( $value ) ? $value : 'DESC' );

		return in_array( $value, [ 'ASC', 'DESC' ], true ) ? $value : 'DESC';
	}

	private function resolve_taxonomy_term_slugs( string $taxonomy, array $terms ): array {
		$slugs = [];

		foreach ( $terms as $term_name ) {
			if ( ! is_string( $term_name ) && ! is_numeric( $term_name ) ) {
				continue;
			}

			$term_name = trim( (string) $term_name );

			if ( '' === $term_name ) {
				continue;
			}

			$term = get_term_by( 'name', $term_name, $taxonomy );

			if ( ! $term ) {
				$term = get_term_by( 'slug', sanitize_title( $term_name ), $taxonomy );
			}

			$slugs[] = $term ? $term->slug : sanitize_title( $term_name );
		}

		return array_values( array_unique( $slugs ) );
	}

	private function render_property_card( int $post_id, array $style_tokens, string $variant = 'grid' ): string {
		$primary       = $style_tokens['primary'];
		$accent        = $style_tokens['accent'];
		$background    = $style_tokens['background'];
		$surface       = $style_tokens['surface'];
		$text          = $style_tokens['text'];
		$muted         = $style_tokens['muted'];
		$border        = $style_tokens['border'];
		$permalink     = get_permalink( $post_id );
		$title         = get_the_title( $post_id );
		$price         = get_post_meta( $post_id, 'price', true );
		$address       = get_post_meta( $post_id, 'address', true );
		$bedrooms      = get_post_meta( $post_id, 'bedrooms', true );
		$bathrooms     = get_post_meta( $post_id, 'bathrooms', true );
		$property_size = get_post_meta( $post_id, 'property_size', true );
		$district      = get_post_meta( $post_id, 'district', true );
		$purpose       = $this->get_property_meta_or_term( $post_id, 'purpose' );
		$property_type = $this->get_property_meta_or_term( $post_id, 'property_type' );
		$excerpt       = wp_trim_words( wp_strip_all_tags( get_the_excerpt( $post_id ) ?: get_post_field( 'post_content', $post_id ) ), 24 );
		$stats         = [];

		if ( is_numeric( $bedrooms ) && (float) $bedrooms > 0 ) {
			$stats[] = number_format( (float) $bedrooms ) . ' bed';
		}

		if ( '' !== $bathrooms && is_numeric( $bathrooms ) && (float) $bathrooms > 0 ) {
			$stats[] = number_format( (float) $bathrooms ) . ' bath';
		}

		if ( '' !== $property_size && is_numeric( $property_size ) ) {
			$stats[] = number_format( (float) $property_size ) . ' sq m';
		}

		ob_start();
		?>

		<?php if ( 'row' === $variant ) : ?>
			<article class="factory-property-card factory-property-card-row" style="display: grid; grid-template-columns: minmax(220px, 290px) minmax(0, 1fr); gap: 0; background: <?php echo esc_attr( $surface ); ?>; border: 1px solid <?php echo esc_attr( $border ); ?>; border-radius: 20px; overflow: hidden; box-shadow: 0 14px 34px rgba(15, 118, 110, 0.09);">
				<a href="<?php echo esc_url( $permalink ); ?>" style="display: block; position: relative; min-height: 230px; background: <?php echo esc_attr( $background ); ?>; text-decoration: none;">
					<?php if ( has_post_thumbnail( $post_id ) ) : ?>
						<?php
						echo get_the_post_thumbnail(
							$post_id,
							'medium_large',
							[
								'style'   => 'display: block; width: 100%; height: 100%; min-height: 230px; object-fit: cover;',
								'loading' => 'lazy',
							]
						);
						?>
					<?php else : ?>
						<div style="height: 230px; display: flex; align-items: center; justify-content: center; color: <?php echo esc_attr( $primary ); ?>; font-weight: 800;">
							<?php echo esc_html( $property_type ?: 'Property' ); ?>
						</div>
					<?php endif; ?>

					<div style="position: absolute; left: 14px; top: 14px; display: flex; gap: 8px; flex-wrap: wrap;">
						<?php if ( '' !== $purpose ) : ?>
							<span style="display: inline-flex; align-items: center; border-radius: 999px; background: <?php echo esc_attr( $primary ); ?>; color: #fff; padding: 7px 11px; font-size: 12px; font-weight: 800;">
								<?php echo esc_html( $purpose ); ?>
							</span>
						<?php endif; ?>
						<?php if ( '' !== $property_type ) : ?>
							<span style="display: inline-flex; align-items: center; border-radius: 999px; background: rgba(255, 255, 255, 0.94); color: <?php echo esc_attr( $primary ); ?>; padding: 7px 11px; font-size: 12px; font-weight: 800;">
								<?php echo esc_html( $property_type ); ?>
							</span>
						<?php endif; ?>
					</div>
				</a>

				<div style="display: grid; gap: 12px; padding: 22px 24px;">
					<div style="display: flex; align-items: start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
						<div style="min-width: 0;">
							<?php if ( '' !== $address ) : ?>
								<div style="color: <?php echo esc_attr( $muted ); ?>; font-size: 13px; line-height: 1.45; margin-bottom: 6px;">
									<?php echo esc_html( $address ); ?>
								</div>
							<?php endif; ?>
							<h2 style="font-size: 22px; line-height: 1.22; margin: 0;">
								<a href="<?php echo esc_url( $permalink ); ?>" style="color: <?php echo esc_attr( $style_tokens['heading'] ); ?>; text-decoration: none;">
									<?php echo esc_html( $title ); ?>
								</a>
							</h2>
							<?php if ( '' !== $district ) : ?>
								<div style="color: <?php echo esc_attr( $primary ); ?>; font-size: 13px; line-height: 1.4; font-weight: 800; margin-top: 6px;">
									<?php echo esc_html( $district ); ?>
								</div>
							<?php endif; ?>
						</div>

						<?php if ( '' !== $price ) : ?>
							<div style="color: <?php echo esc_attr( $primary ); ?>; font-size: 24px; line-height: 1.1; font-weight: 900; white-space: nowrap;">
								<?php echo esc_html( $this->format_property_price( $price ) ); ?>
							</div>
						<?php endif; ?>
					</div>

					<?php if ( '' !== $excerpt ) : ?>
						<p style="color: <?php echo esc_attr( $muted ); ?>; font-size: 14px; line-height: 1.6; margin: 0;">
							<?php echo esc_html( $excerpt ); ?>
						</p>
					<?php endif; ?>

					<div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
						<?php if ( ! empty( $stats ) ) : ?>
							<div style="display: flex; flex-wrap: wrap; gap: 8px;">
								<?php foreach ( $stats as $stat ) : ?>
									<span style="display: inline-flex; align-items: center; border-radius: 999px; background: <?php echo esc_attr( $background ); ?>; color: <?php echo esc_attr( $text ); ?>; padding: 7px 10px; font-size: 13px; font-weight: 800;">
										<?php echo esc_html( $stat ); ?>
									</span>
								<?php endforeach; ?>
							</div>
						<?php endif; ?>

						<a class="factory-property-action" href="<?php echo esc_url( $permalink ); ?>" style="display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: <?php echo esc_attr( $style_tokens['button'] ); ?>; color: <?php echo esc_attr( $style_tokens['button_text'] ); ?>; min-height: 42px; padding: 0 16px; font-size: 14px; font-weight: 900; text-decoration: none;">
							View property
						</a>
					</div>
				</div>
			</article>

			<?php
			return ob_get_clean();
		endif;
		?>

		<article class="factory-property-card" style="background: <?php echo esc_attr( $surface ); ?>; border: 1px solid <?php echo esc_attr( $border ); ?>; border-radius: 20px; overflow: hidden; box-shadow: 0 16px 38px rgba(15, 118, 110, 0.11);">
			<a href="<?php echo esc_url( $permalink ); ?>" style="display: block; position: relative; min-height: 232px; background: <?php echo esc_attr( $background ); ?>; text-decoration: none;">
				<?php if ( has_post_thumbnail( $post_id ) ) : ?>
					<?php
					echo get_the_post_thumbnail(
						$post_id,
						'medium_large',
						[
							'style'   => 'display: block; width: 100%; height: 232px; object-fit: cover;',
							'loading' => 'lazy',
						]
					);
					?>
				<?php else : ?>
					<div style="height: 232px; display: flex; align-items: center; justify-content: center; color: <?php echo esc_attr( $primary ); ?>; font-weight: 700;">
						<?php echo esc_html( $property_type ?: 'Property' ); ?>
					</div>
				<?php endif; ?>

				<div style="position: absolute; left: 16px; top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
					<?php if ( '' !== $purpose ) : ?>
						<span style="display: inline-flex; align-items: center; border-radius: 999px; background: <?php echo esc_attr( $primary ); ?>; color: #fff; padding: 7px 11px; font-size: 12px; font-weight: 700; letter-spacing: 0;">
							<?php echo esc_html( $purpose ); ?>
						</span>
					<?php endif; ?>

					<?php if ( '' !== $property_type ) : ?>
						<span style="display: inline-flex; align-items: center; border-radius: 999px; background: rgba(255, 255, 255, 0.92); color: <?php echo esc_attr( $primary ); ?>; padding: 7px 11px; font-size: 12px; font-weight: 700; letter-spacing: 0;">
							<?php echo esc_html( $property_type ); ?>
						</span>
					<?php endif; ?>
				</div>
			</a>

			<div style="padding: 22px 22px 24px;">
				<?php if ( '' !== $price ) : ?>
					<div style="color: <?php echo esc_attr( $primary ); ?>; font-size: 24px; line-height: 1.15; font-weight: 800; margin-bottom: 10px;">
						<?php echo esc_html( $this->format_property_price( $price ) ); ?>
					</div>
				<?php endif; ?>

				<h2 style="font-size: 21px; line-height: 1.25; margin: 0 0 10px;">
					<a href="<?php echo esc_url( $permalink ); ?>" style="color: <?php echo esc_attr( $style_tokens['heading'] ); ?>; text-decoration: none;">
						<?php echo esc_html( $title ); ?>
					</a>
				</h2>

				<?php if ( '' !== $address ) : ?>
					<div style="color: <?php echo esc_attr( $muted ); ?>; font-size: 14px; line-height: 1.5; margin-bottom: 8px;">
						<?php echo esc_html( $address ); ?>
					</div>
				<?php endif; ?>

				<?php if ( '' !== $district ) : ?>
					<div style="color: <?php echo esc_attr( $primary ); ?>; font-size: 13px; line-height: 1.4; font-weight: 700; margin-bottom: 14px;">
						<?php echo esc_html( $district ); ?>
					</div>
				<?php endif; ?>

				<?php if ( ! empty( $stats ) ) : ?>
					<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px;">
						<?php foreach ( $stats as $stat ) : ?>
							<span style="display: inline-flex; align-items: center; border-radius: 999px; background: <?php echo esc_attr( $background ); ?>; color: <?php echo esc_attr( $text ); ?>; padding: 7px 10px; font-size: 13px; font-weight: 700;">
								<?php echo esc_html( $stat ); ?>
							</span>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>

				<a class="factory-property-action" href="<?php echo esc_url( $permalink ); ?>" style="display: inline-flex; align-items: center; color: <?php echo esc_attr( $style_tokens['link'] ?: $accent ); ?>; font-size: 14px; font-weight: 800; text-decoration: none;">
					View property
				</a>
			</div>
		</article>

		<?php
		return ob_get_clean();
	}

	private function get_site_style_tokens( array $blueprint ): array {
		$style = $blueprint['site']['style'] ?? [];

		return [
			'tone'           => sanitize_key( $style['tone'] ?? 'premium' ),
			'primary_preset' => sanitize_key( $style['primary_preset'] ?? 'turquoise' ),
			'primary'        => $this->sanitize_color_token( $style['primary'] ?? '', '#0f766e' ),
			'accent'         => $this->sanitize_color_token( $style['accent'] ?? '', '#14b8a6' ),
			'background'     => $this->sanitize_color_token( $style['background'] ?? '', '#ecfeff' ),
			'surface'        => $this->sanitize_color_token( $style['surface'] ?? '', '#ffffff' ),
			'text'           => $this->sanitize_color_token( $style['text'] ?? '', '#10201d' ),
			'muted'          => $this->sanitize_color_token( $style['muted'] ?? '', '#52635f' ),
			'border'         => $this->sanitize_color_token( $style['border'] ?? '', '#d7eee9' ),
			'button'         => $this->sanitize_color_token( $style['button'] ?? '', $style['accent'] ?? '#14b8a6' ),
			'button_text'    => $this->sanitize_color_token( $style['button_text'] ?? '', '#ffffff' ),
			'link'           => $this->sanitize_color_token( $style['link'] ?? '', $style['primary'] ?? '#0f766e' ),
			'link_hover'     => $this->sanitize_color_token( $style['link_hover'] ?? '', '#0d9488' ),
			'heading'        => $this->sanitize_color_token( $style['heading'] ?? '', '#10201d' ),
		];
	}

	private function sanitize_color_token( $value, string $fallback ): string {
		if ( ! is_string( $value ) || '' === trim( $value ) ) {
			return $fallback;
		}

		if ( function_exists( 'sanitize_hex_color' ) ) {
			$sanitized = sanitize_hex_color( $value );

			return $sanitized ?: $fallback;
		}

		return preg_match( '/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/', $value ) ? $value : $fallback;
	}

	private function get_property_meta_or_term( int $post_id, string $key ): string {
		$value = get_post_meta( $post_id, $key, true );

		if ( is_array( $value ) ) {
			$value = reset( $value );
		}

		if ( '' !== $value && null !== $value ) {
			return (string) $value;
		}

		$terms = wp_get_post_terms( $post_id, $key, [ 'fields' => 'names' ] );

		if ( is_wp_error( $terms ) || empty( $terms ) ) {
			return '';
		}

		return (string) $terms[0];
	}

	private function format_property_price( $value ): string {
		if ( is_array( $value ) ) {
			$value = reset( $value );
		}

		if ( '' === $value || [] === $value || null === $value ) {
			return '';
		}

		if ( is_numeric( $value ) ) {
			return '$' . number_format( (float) $value );
		}

		return (string) $value;
	}

	private function get_render_fields(
		array $listing,
		array $blueprint,
		string $post_type
	): array {
		$meta_map = $this->get_cpt_meta_map( $blueprint, $post_type );
		$fields   = [];
		$used     = [];

		if ( ! empty( $listing['layout'] ) && is_array( $listing['layout'] ) ) {
			foreach ( $listing['layout'] as $field ) {
				if ( ! is_array( $field ) || ( $field['type'] ?? '' ) !== 'meta' ) {
					continue;
				}

				$key = $field['key'] ?? '';

				if ( ! $key ) {
					continue;
				}

				$fields[] = [
					'key'   => $key,
					'type'  => $meta_map[ $key ]['type'] ?? 'text',
					'label' => $field['label'] ?? $meta_map[ $key ]['label'] ?? $this->humanize_key( $key ),
				];

				$used[ $key ] = true;
			}
		}

		if ( ! empty( $listing['fields'] ) && is_array( $listing['fields'] ) ) {
			foreach ( $listing['fields'] as $field ) {
				if ( ! is_string( $field ) || 'title' === $field ) {
					continue;
				}

				if ( isset( $used[ $field ] ) ) {
					continue;
				}

				$fields[] = [
					'key'   => $field,
					'type'  => $meta_map[ $field ]['type'] ?? 'text',
					'label' => $meta_map[ $field ]['label'] ?? $this->humanize_key( $field ),
				];

				$used[ $field ] = true;
			}
		}

		if ( empty( $fields ) ) {
			return array_values( $meta_map );
		}

		return $fields;
	}

	private function get_cpt_meta_map( array $blueprint, string $post_type ): array {
		foreach ( $blueprint['cpt'] ?? [] as $cpt ) {
			if ( ( $cpt['slug'] ?? '' ) !== $post_type ) {
				continue;
			}

			$map = [];

			foreach ( $cpt['meta'] ?? [] as $field ) {
				if ( empty( $field['key'] ) ) {
					continue;
				}

				$map[ $field['key'] ] = [
					'key'   => $field['key'],
					'type'  => $field['type'] ?? 'text',
					'label' => $field['label'] ?? $this->humanize_key( $field['key'] ),
				];
			}

			return $map;
		}

		return [];
	}

	private function format_value( $value, string $type ): string {
		if ( is_array( $value ) ) {
			$value = implode( ', ', $value );
		}

		if ( in_array( $type, [ 'boolean', 'checkbox' ], true ) ) {
			return $value ? 'Yes' : 'No';
		}

		if ( 'number' === $type && is_numeric( $value ) ) {
			return number_format( (float) $value );
		}

		return (string) $value;
	}

	private function humanize_key( string $key ): string {
		return ucwords( str_replace( '_', ' ', $key ) );
	}

	private function get_configured_page( array $blueprint, string $page_key ): array {
		$page = $blueprint['pages'][ $page_key ] ?? [];

		return is_array( $page ) ? $page : [];
	}

	private function is_generated_contact_page_request(): bool {
		if ( ! is_page() ) {
			return false;
		}

		$blueprint = factory_get_blueprint();
		$contact   = $this->get_configured_page( $blueprint, 'contact' );
		$slug      = is_string( $contact['slug'] ?? null ) ? $contact['slug'] : '';

		if ( '' === $slug ) {
			return false;
		}

		return is_page( $slug );
	}

	private function is_generated_archive_page_request(): bool {
		if ( ! is_page() ) {
			return false;
		}

		$blueprint = factory_get_blueprint();
		$archive   = $this->get_configured_page( $blueprint, 'archive' );
		$slug      = is_string( $archive['slug'] ?? null ) ? $archive['slug'] : '';

		if ( '' === $slug ) {
			return false;
		}

		return is_page( $slug );
	}

	private function is_generated_home_page_request(): bool {
		if ( ! is_front_page() ) {
			return false;
		}

		$blueprint = factory_get_blueprint();
		$home      = $this->get_configured_page( $blueprint, 'home' );
		$slug      = is_string( $home['slug'] ?? null ) ? $home['slug'] : '';

		if ( '' === $slug ) {
			return false;
		}

		return is_page( $slug );
	}

	private function get_configured_page_content( array $blueprint, string $page_key ): string {
		if ( 'home' === $page_key ) {
			return $this->render_home_page_content( $blueprint );
		}

		if ( 'native_filters' === $page_key ) {
			return $this->render_native_filters_page_content( $blueprint );
		}

		if ( 'contact' === $page_key ) {
			return $this->render_contact_page_content( $blueprint );
		}

		$page = $this->get_configured_page( $blueprint, $page_key );

		return is_string( $page['content'] ?? null ) ? $page['content'] : '';
	}

	private function render_generated_footer( array $blueprint ): string {
		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$home         = $this->get_configured_page( $blueprint, 'home' );
		$brand        = is_string( $home['title'] ?? null ) && '' !== trim( $home['title'] )
			? trim( $home['title'] )
			: 'Kyiv Turquoise Realty';
		$year         = gmdate( 'Y' );

		$html  = '<footer class="factory-generated-footer" style="width: 100vw; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); background: ' . esc_attr( $style_tokens['heading'] ) . '; color: #fff; padding: 38px 24px 22px;">';
		$html .= '<div style="max-width: 1120px; margin: 0 auto;">';
		$html .= '<div style="display: grid; grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(150px, 0.7fr)); gap: 24px; align-items: start;">';
		$html .= '<div>';
		$html .= '<strong style="display: block; font-size: 22px; line-height: 1.2; margin-bottom: 10px; color: #fff;">' . esc_html( $brand ) . '</strong>';
		$html .= '<p style="color: rgba(255,255,255,0.88); font-size: 14px; line-height: 1.6; margin: 0;">Generated real estate catalog with validated property pages.</p>';
		$html .= '</div>';
		$html .= '<div><strong style="display: block; color: ' . esc_attr( $style_tokens['accent'] ) . '; font-size: 13px; text-transform: uppercase; margin-bottom: 10px;">Pages</strong><a href="' . esc_url( home_url( '/' ) ) . '" style="display: block; color: rgba(255,255,255,0.94); text-decoration: none; margin-bottom: 7px;">Home</a><a href="' . esc_url( home_url( '/properties/' ) ) . '" style="display: block; color: rgba(255,255,255,0.94); text-decoration: none; margin-bottom: 7px;">Properties</a><a href="' . esc_url( home_url( '/contact/' ) ) . '" style="display: block; color: rgba(255,255,255,0.94); text-decoration: none;">Contact</a></div>';
		$html .= '<div><strong style="display: block; color: ' . esc_attr( $style_tokens['accent'] ) . '; font-size: 13px; text-transform: uppercase; margin-bottom: 10px;">Services</strong><span style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 7px;">Property search</span><span style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 7px;">Request viewing</span><span style="display: block; color: rgba(255,255,255,0.9);">Contact agency</span></div>';
		$html .= '<div><strong style="display: block; color: ' . esc_attr( $style_tokens['accent'] ) . '; font-size: 13px; text-transform: uppercase; margin-bottom: 10px;">Proof</strong><span style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 7px;">Crocoblock-powered generated site</span><span style="display: block; color: rgba(255,255,255,0.9);">Validation proof available in Site Factory</span></div>';
		$html .= '</div>';
		$html .= '<div style="border-top: 1px solid rgba(255,255,255,0.22); color: rgba(255,255,255,0.78); font-size: 13px; margin-top: 24px; padding-top: 16px;">&copy; ' . esc_html( $year ) . ' ' . esc_html( $brand ) . '. Generated by Site Factory.</div>';
		$html .= '</div>';
		$html .= '</footer>';

		return $html;
	}

	private function render_home_page_content( array $blueprint ): string {
		$home         = $this->get_configured_page( $blueprint, 'home' );
		$sections     = is_array( $home['sections'] ?? null ) ? $home['sections'] : [];
		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$primary      = $style_tokens['primary'];
		$accent       = $style_tokens['accent'];
		$background   = $style_tokens['background'];
		$surface      = $style_tokens['surface'];
		$text         = $style_tokens['text'];
		$muted        = $style_tokens['muted'];
		$border       = $style_tokens['border'];
		$hero_image   = plugins_url( '../../assets/real-estate/hero/kyiv-panorama.png', __FILE__ );
		$html         = '<style>body.front-page .entry-title, body.front-page .page-title, body.home .entry-title, body.home .page-title { display: none !important; }</style>';
		$html        .= '<div class="factory-home-page" style="background: ' . esc_attr( $surface ) . '; color: ' . esc_attr( $text ) . '; margin: -40px 0 0;">';

		foreach ( $sections as $section ) {
			if ( ! is_array( $section ) ) {
				continue;
			}

			$type = $section['type'] ?? '';

			if ( 'hero' === $type ) {
				$title     = $section['title'] ?? ( $home['title'] ?? 'Kyiv Turquoise Realty' );
				$subtitle  = $section['subtitle'] ?? '';
				$cta_label = $section['cta_label'] ?? 'Browse properties';
				$cta_url   = $this->resolve_frontend_url( $section['cta_url'] ?? '', '/properties/' );
				$hero_variant = sanitize_key( (string) ( $section['variant'] ?? 'image_left_scrim' ) );
				$html        .= $this->render_home_hero_section(
					$hero_variant,
					(string) $title,
					(string) $subtitle,
					(string) $cta_label,
					(string) $cta_url,
					(string) $hero_image,
					$style_tokens
				);
				continue;
			}

			if ( 'listing' === $type ) {
				$title   = $section['title'] ?? 'Properties';
				$query   = $section['query'] ?? '';
				$listing = $section['listing'] ?? 'property-card';

				$html .= '<section style="max-width: 1120px; margin: 0 auto; padding: 34px 24px;">';
				$html .= '<header style="display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 22px;">';
				$html .= '<div>';
				$html .= '<span style="color: ' . esc_attr( $primary ) . '; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0;">Kyiv catalog</span>';
				$html .= '<h2 style="font-size: clamp(28px, 4vw, 44px); line-height: 1.08; margin: 6px 0 0; color: ' . esc_attr( $style_tokens['heading'] ) . ';">' . esc_html( $title ) . '</h2>';
				$html .= '</div>';
				$html .= '<a class="factory-button-link" href="' . esc_url( $this->resolve_frontend_url( '/properties/', '/properties/' ) ) . '" style="color: ' . esc_attr( $style_tokens['link'] ?: $accent ) . '; font-size: 14px; font-weight: 900; text-decoration: none;">View all</a>';
				$html .= '</header>';
				$html .= sprintf(
					'[factory_listing slug="%s" query="%s"]',
					esc_attr( $listing ),
					esc_attr( $query )
				);
				$html .= '</section>';
				continue;
			}

			if ( 'cta' === $type ) {
				continue;
			}
		}

		$html .= $this->render_home_benefits_section( $blueprint );
		$html .= '</div>';
		$html .= $this->render_generated_footer( $blueprint );

		return $html;
	}

	private function render_home_hero_section(
		string $hero_variant,
		string $title,
		string $subtitle,
		string $cta_label,
		string $cta_url,
		string $hero_image,
		array $style_tokens
	): string {
		$allowed_variant = in_array( $hero_variant, [ 'image_left_scrim', 'centered_overlay' ], true ) ? $hero_variant : 'image_left_scrim';
		$primary = $style_tokens['primary'] ?? '#0f766e';
		$button = $style_tokens['button'] ?? $primary;
		$button_text = $style_tokens['button_text'] ?? '#ffffff';
		$heading = $style_tokens['heading'] ?? '#0f172a';
		$section_class = 'factory-home-hero factory-home-hero--' . str_replace( '_', '-', $allowed_variant );
		$html  = '<section class="' . esc_attr( $section_class ) . '" data-factory-hero-variant="' . esc_attr( $allowed_variant ) . '" style="position: relative; width: 100vw; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); min-height: clamp(520px, 72vw, 720px); padding: clamp(96px, 12vw, 150px) 0 clamp(92px, 10vw, 130px); overflow: hidden; background: ' . esc_attr( $heading ) . ';">';
		$html .= '<div aria-hidden="true" style="position: absolute; inset: 0; background-image: url(\'' . esc_url( $hero_image ) . '\'); background-size: cover; background-position: center; opacity: 1;"></div>';

		if ( 'centered_overlay' === $allowed_variant ) {
			$html .= '<div aria-hidden="true" style="position: absolute; inset: 0; background: radial-gradient(circle at 50% 38%, rgba(15, 23, 42, 0.18) 0%, rgba(15, 23, 42, 0.42) 28%, rgba(15, 23, 42, 0.16) 58%, rgba(15, 23, 42, 0.02) 100%);"></div>';
			$html .= '<div style="position: relative; z-index: 1; max-width: 1120px; margin: 0 auto; padding: 0 24px;">';
			$html .= '<div style="max-width: 760px; margin: 0 auto; text-align: center;">';
			$html .= '<span style="display: inline-flex; border-radius: 999px; background: rgba(255,255,255,0.92); color: ' . esc_attr( $primary ) . '; padding: 8px 12px; font-size: 13px; font-weight: 800; margin-bottom: 18px;">Real Estate Beta</span>';
			$html .= '<h1 style="font-size: clamp(40px, 5.2vw, 70px); line-height: 1.02; margin: 0 0 18px; letter-spacing: 0; color: #fff; text-wrap: balance; text-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);">' . esc_html( $title ) . '</h1>';
			$html .= '<p style="font-size: clamp(18px, 2.4vw, 26px); line-height: 1.45; color: rgba(255,255,255,0.94); margin: 0 auto 28px; max-width: 620px; text-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);">' . esc_html( $subtitle ) . '</p>';
			$html .= '<a class="factory-button-link" href="' . esc_url( $cta_url ) . '" style="display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: ' . esc_attr( $button ) . '; color: ' . esc_attr( $button_text ) . '; padding: 14px 20px; font-size: 15px; font-weight: 900; text-decoration: none;">' . esc_html( $cta_label ) . '</a>';
			$html .= '</div>';
			$html .= '</div>';
			$html .= '</section>';

			return $html;
		}

		$html .= '<div aria-hidden="true" style="position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5, 30, 28, 0.55) 0%, rgba(7, 47, 43, 0.38) 32%, rgba(15, 118, 110, 0.1) 58%, rgba(15, 118, 110, 0) 100%);"></div>';
		$html .= '<div style="position: relative; z-index: 1; max-width: 1120px; margin: 0 auto; padding: 0 24px;">';
		$html .= '<div style="max-width: 700px;">';
		$html .= '<span style="display: inline-flex; border-radius: 999px; background: rgba(255,255,255,0.92); color: ' . esc_attr( $primary ) . '; padding: 8px 12px; font-size: 13px; font-weight: 800; margin-bottom: 18px;">Real Estate Beta</span>';
		$html .= '<h1 style="font-size: clamp(38px, 5vw, 68px); line-height: 1.02; margin: 0 0 18px; letter-spacing: 0; color: #fff; text-wrap: balance; text-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);">' . esc_html( $title ) . '</h1>';
		$html .= '<p style="font-size: clamp(18px, 2.4vw, 26px); line-height: 1.45; color: rgba(255,255,255,0.92); margin: 0 0 28px; max-width: 640px; text-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);">' . esc_html( $subtitle ) . '</p>';
		$html .= '<a class="factory-button-link" href="' . esc_url( $cta_url ) . '" style="display: inline-flex; align-items: center; border-radius: 999px; background: ' . esc_attr( $button ) . '; color: ' . esc_attr( $button_text ) . '; padding: 14px 20px; font-size: 15px; font-weight: 900; text-decoration: none;">' . esc_html( $cta_label ) . '</a>';
		$html .= '</div>';
		$html .= '</div>';
		$html .= '</section>';

		return $html;
	}

	private function render_home_benefits_section( array $blueprint ): string {
		$style_tokens   = $this->get_site_style_tokens( $blueprint );
		$primary        = $style_tokens['primary'];
		$background     = $style_tokens['background'];
		$surface        = $style_tokens['surface'];
		$muted          = $style_tokens['muted'];
		$border         = $style_tokens['border'];
		$benefits       = [
			[ 'icon' => '01', 'title' => 'Curated real estate selection', 'text' => 'Prepared generated listings give the beta a complete property catalog from the first run.' ],
			[ 'icon' => '02', 'title' => 'Fast catalog search', 'text' => 'Purpose, location, type, bedroom, and price filters keep browsing focused and predictable.' ],
			[ 'icon' => '03', 'title' => 'Request a viewing', 'text' => 'Each property connects to a contact flow with the selected listing context.' ],
			[ 'icon' => '04', 'title' => 'Clear communication', 'text' => 'Contact details and proof-backed generated pages make follow-up straightforward.' ],
		];

		$html  = '<section class="factory-home-benefits" style="max-width: 1120px; margin: 0 auto; padding: 30px 24px 36px;">';
		$html .= '<header style="max-width: 680px; margin-bottom: 24px;">';
		$html .= '<span style="color: ' . esc_attr( $primary ) . '; font-size: 13px; font-weight: 900; text-transform: uppercase;">Generated real estate service</span>';
		$html .= '<h2 style="font-size: clamp(30px, 4vw, 48px); line-height: 1.08; margin: 8px 0 10px; color: ' . esc_attr( $style_tokens['heading'] ) . ';">How can we help you find real estate?</h2>';
		$html .= '<p style="color: ' . esc_attr( $muted ) . '; font-size: 16px; line-height: 1.65; margin: 0;">A clean generated experience for browsing, comparing, and requesting property viewings.</p>';
		$html .= '</header>';
		$html .= '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">';

		foreach ( $benefits as $benefit ) {
			$html .= '<article style="background: ' . esc_attr( $surface ) . '; border: 1px solid ' . esc_attr( $border ) . '; border-radius: 20px; padding: 22px; box-shadow: 0 12px 28px rgba(15, 118, 110, 0.07);">';
			$html .= '<span style="display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 14px; background: ' . esc_attr( $background ) . '; color: ' . esc_attr( $primary ) . '; font-size: 13px; font-weight: 900; margin-bottom: 16px;">' . esc_html( $benefit['icon'] ) . '</span>';
			$html .= '<h3 style="font-size: 18px; line-height: 1.25; margin: 0 0 8px; color: ' . esc_attr( $style_tokens['heading'] ) . ';">' . esc_html( $benefit['title'] ) . '</h3>';
			$html .= '<p style="color: ' . esc_attr( $muted ) . '; font-size: 14px; line-height: 1.6; margin: 0;">' . esc_html( $benefit['text'] ) . '</p>';
			$html .= '</article>';
		}

		$html .= '</div>';
		$html .= '<div style="margin-top: 24px; border-radius: 26px; background: ' . esc_attr( $style_tokens['heading'] ) . '; color: #fff; padding: clamp(26px, 5vw, 42px); display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap;">';
		$html .= '<div>';
		$html .= '<span style="display: block; color: ' . esc_attr( $style_tokens['accent'] ) . '; font-size: 13px; font-weight: 900; text-transform: uppercase; margin-bottom: 8px;">Kyiv property search</span>';
		$html .= '<h2 style="font-size: clamp(28px, 4vw, 44px); line-height: 1.08; margin: 0 0 8px; color: #fff;">Ready to find your Kyiv property?</h2>';
		$html .= '<p style="color: rgba(255,255,255,0.9); font-size: 15px; line-height: 1.55; margin: 0;">Browse generated listings or request a viewing from a property page.</p>';
		$html .= '</div>';
		$html .= '<a class="factory-button-link" href="' . esc_url( home_url( '/properties/' ) ) . '" style="display: inline-flex; align-items: center; border-radius: 999px; background: ' . esc_attr( $style_tokens['button'] ) . '; color: ' . esc_attr( $style_tokens['button_text'] ) . '; padding: 14px 20px; font-size: 15px; font-weight: 900; text-decoration: none;">Browse properties</a>';
		$html .= '</div>';
		$html .= '</section>';

		return $html;
	}

	private function render_native_filters_page_content( array $blueprint ): string {
		$page          = $this->get_configured_page( $blueprint, 'native_filters' );
		$style_tokens  = $this->get_site_style_tokens( $blueprint );
		$query_id      = sanitize_key( $page['provider_query_id'] ?? 'native_list' );
		$query_slug    = sanitize_key( $page['query'] ?? '' );
		$listing_slug  = sanitize_key( $page['listing'] ?? '' );
		$listing_id    = $this->find_jetengine_listing_id( $listing_slug );
		$query_row_id  = $this->resolve_jetengine_query_row_id( $query_slug, $query_id );
		$filter_keys   = is_array( $page['filters'] ?? null ) ? $page['filters'] : [];
		$filter_blocks = [];

		foreach ( $filter_keys as $filter_key ) {
			$filter_id = $this->find_jetsmartfilters_filter_id( sanitize_key( $filter_key ) );

			if ( $filter_id > 0 ) {
				$filter_blocks[] = $this->render_jetsmartfilters_select_block( $filter_id, $query_id );
			}
		}

		$listing_block = '';

		if ( $listing_id > 0 && $query_row_id > 0 ) {
			$listing_block = '<!-- wp:jet-engine/listing-grid ' . wp_json_encode( [
				'lisitng_id'      => (string) $listing_id,
				'custom_query'    => true,
				'custom_query_id' => (string) $query_row_id,
				'_element_id'     => $query_id,
			] ) . ' /-->';
		}

		$html  = '<div class="factory-native-filters-page" style="max-width: 1120px; margin: 72px auto; padding: 0 24px; color: #10201d;">';
		$html .= '<header style="margin-bottom: 28px;">';
		$html .= '<span style="display: inline-flex; border-radius: 999px; background: ' . esc_attr( $style_tokens['background'] ) . '; color: ' . esc_attr( $style_tokens['primary'] ) . '; padding: 8px 12px; font-size: 13px; font-weight: 900; margin-bottom: 14px;">Experimental native filters</span>';
		$html .= '<h1 style="font-size: clamp(34px, 4.5vw, 58px); line-height: 1.06; margin: 0 0 12px;">' . esc_html( $page['title'] ?? 'Native Properties' ) . '</h1>';
		$html .= '<p style="max-width: 720px; color: #52635f; font-size: 17px; line-height: 1.65; margin: 0;">This page is a native JetSmartFilters and JetEngine Listing Grid proof. The stable catalog remains available at <a href="' . esc_url( home_url( '/properties/' ) ) . '">/properties/</a>.</p>';
		$html .= '</header>';

		if ( empty( $filter_blocks ) || '' === $listing_block ) {
			$html .= '<div style="border: 1px solid #d7eee9; border-radius: 18px; background: #fff; padding: 22px; color: #52635f;">';
			$html .= esc_html( 'Native filters are not ready yet. Generate the Real Estate demo with JetSmartFilters and JetEngine active, then refresh this page.' );
			$html .= '</div>';
			$html .= '</div>';

			return $html;
		}

		$html .= '<section class="factory-native-filter-controls" style="background: ' . esc_attr( $style_tokens['background'] ) . '; border: 1px solid #b9e6de; border-radius: 20px; padding: 18px; margin: 0 0 24px;">';
		$html .= '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; align-items: end;">';
		$html .= implode( "\n\n", $filter_blocks );
		$html .= '</div>';
		$html .= '</section>';
		$html .= '<section class="factory-native-listing-grid">';
		$html .= $listing_block;
		$html .= '</section>';
		$html .= '</div>';

		return $html;
	}

	private function render_jetsmartfilters_select_block( int $filter_id, string $query_id ): string {
		return '<!-- wp:jet-smart-filters/select ' . wp_json_encode( [
			'filter_id'                    => $filter_id,
			'content_provider'             => 'jet-engine',
			'query_id'                     => $query_id,
			'show_label'                   => true,
			'additional_providers_enabled' => false,
		] ) . ' /-->';
	}

	private function render_contact_page_content( array $blueprint ): string {
		$contact      = $this->get_configured_page( $blueprint, 'contact' );
		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$primary      = $style_tokens['primary'];
		$accent       = $style_tokens['accent'];
		$background   = $style_tokens['background'];
		$surface      = $style_tokens['surface'];
		$muted        = $style_tokens['muted'];
		$border       = $style_tokens['border'];
		$title        = $contact['title'] ?? 'Contact Kyiv Turquoise Realty';
		$text         = $contact['text'] ?? '';
		$phone        = $contact['phone'] ?? '';
		$email        = $contact['email'] ?? '';
		$cta_label    = $contact['cta_label'] ?? 'Browse properties';
		$cta_url      = $this->resolve_frontend_url( $contact['cta_url'] ?? '', '/properties/' );

		$html  = '<section class="factory-contact-page" style="background: ' . esc_attr( $background ) . '; margin: 0; padding: 58px 24px 44px; color: ' . esc_attr( $style_tokens['text'] ) . ';">';
		$html .= '<div style="max-width: 920px; margin: 0 auto;">';
		$html .= '<span style="display: inline-flex; border-radius: 999px; background: ' . esc_attr( $surface ) . '; color: ' . esc_attr( $primary ) . '; padding: 8px 12px; font-size: 13px; font-weight: 900; margin-bottom: 18px;">Kyiv agency</span>';
		$html .= '<h1 style="font-size: clamp(30px, 3.2vw, 44px); line-height: 1.08; margin: 0 0 18px; color: ' . esc_attr( $style_tokens['heading'] ) . ';">' . esc_html( $title ) . '</h1>';
		$html .= '<p style="max-width: 680px; color: ' . esc_attr( $muted ) . '; font-size: 19px; line-height: 1.6; margin: 0 0 34px;">' . esc_html( $text ) . '</p>';
		$html .= '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 32px;">';
		$html .= '<div style="background: ' . esc_attr( $surface ) . '; border: 1px solid ' . esc_attr( $border ) . '; border-radius: 20px; padding: 22px;"><strong style="display: block; color: ' . esc_attr( $primary ) . '; margin-bottom: 6px;">Phone</strong><span>' . esc_html( $phone ) . '</span></div>';
		$html .= '<div style="background: ' . esc_attr( $surface ) . '; border: 1px solid ' . esc_attr( $border ) . '; border-radius: 20px; padding: 22px;"><strong style="display: block; color: ' . esc_attr( $primary ) . '; margin-bottom: 6px;">Email</strong><span>' . esc_html( $email ) . '</span></div>';
		$html .= '</div>';
		$html .= '<a class="factory-button-link" href="' . esc_url( $cta_url ) . '" style="display: inline-flex; align-items: center; border-radius: 999px; background: ' . esc_attr( $style_tokens['button'] ?: $accent ) . '; color: ' . esc_attr( $style_tokens['button_text'] ) . '; padding: 14px 20px; font-size: 15px; font-weight: 900; text-decoration: none;">' . esc_html( $cta_label ) . '</a>';
		$html .= '[factory_request_viewing]';
		$html .= '</div>';
		$html .= '</section>';
		$html .= $this->render_generated_footer( $blueprint );

		return $html;
	}

	public function render_request_viewing_shortcode(): string {
		$blueprint = factory_get_blueprint();
		$config    = $this->get_request_viewing_config( $blueprint );

		if ( empty( $config ) || false === ( $config['enabled'] ?? true ) ) {
			return '';
		}

		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$primary      = $style_tokens['primary'];
		$accent       = $style_tokens['accent'];
		$background   = $style_tokens['background'];
		$title        = is_string( $config['title'] ?? null ) && '' !== trim( $config['title'] )
			? trim( $config['title'] )
			: 'Request a Viewing';
		$form_id      = $this->resolve_request_viewing_form_id( $config );
		$property     = $this->get_request_viewing_property_context();

		ob_start();
		?>

		<section class="factory-request-viewing" style="margin-top: 42px; border: 1px solid #b9e6de; border-radius: 24px; background: #fff; padding: clamp(24px, 4vw, 38px); box-shadow: 0 18px 44px rgba(15, 118, 110, 0.1);">
			<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 28px; align-items: start;">
				<div>
					<span style="display: inline-flex; border-radius: 999px; background: <?php echo esc_attr( $background ); ?>; color: <?php echo esc_attr( $primary ); ?>; padding: 8px 12px; font-size: 13px; font-weight: 900; margin-bottom: 16px;">
						Request Viewing
					</span>
					<h2 style="font-size: clamp(28px, 4vw, 44px); line-height: 1.08; margin: 0 0 12px; color: #10201d;">
						<?php echo esc_html( $title ); ?>
					</h2>

					<?php if ( ! empty( $property ) ) : ?>
						<p style="color: #52635f; font-size: 17px; line-height: 1.6; margin: 0 0 18px;">
							Tell us when you would like to view <strong><?php echo esc_html( $property['title'] ); ?></strong>.
						</p>

						<div style="border: 1px solid #d7eee9; border-radius: 18px; background: <?php echo esc_attr( $background ); ?>; padding: 16px 18px; color: #213532;">
							<div style="font-weight: 900; margin-bottom: 6px;"><?php echo esc_html( $property['title'] ); ?></div>
							<?php if ( '' !== $property['price'] ) : ?>
								<div style="color: <?php echo esc_attr( $primary ); ?>; font-size: 15px; font-weight: 900; margin-bottom: 4px;"><?php echo esc_html( $this->format_property_price( $property['price'] ) ); ?></div>
							<?php endif; ?>
							<?php if ( '' !== $property['address'] ) : ?>
								<div style="color: #52635f; font-size: 14px; line-height: 1.45;"><?php echo esc_html( $property['address'] ); ?></div>
							<?php endif; ?>
						</div>
					<?php else : ?>
						<p style="color: #52635f; font-size: 17px; line-height: 1.6; margin: 0;">
							Share the property you are interested in and the agency will follow up with viewing details.
						</p>
					<?php endif; ?>
				</div>

				<div>
					<?php if ( $form_id ) : ?>
						<?php echo do_shortcode( sprintf( '[jet_fb_form form_id="%d" submit_type="ajax"]', $form_id ) ); ?>
					<?php else : ?>
						<?php echo $this->render_request_viewing_fallback( $config, $property, $accent ); ?>
					<?php endif; ?>
				</div>
			</div>
		</section>

		<?php
		return ob_get_clean();
	}

	private function render_request_viewing_fallback( array $config, array $property, string $accent ): string {
		$email = is_string( $config['fallback_email'] ?? null ) && is_email( $config['fallback_email'] )
			? $config['fallback_email']
			: get_option( 'admin_email' );

		$property_title = $property['title'] ?? '';
		$subject        = '' !== $property_title
			? "Request a viewing: {$property_title}"
			: 'Request a property viewing';
		$body           = '' !== $property_title
			? "Hello,%0D%0A%0D%0AI would like to request a viewing for {$property_title}.%0D%0A%0D%0AName:%0D%0APhone:%0D%0APreferred date:%0D%0AMessage:"
			: "Hello,%0D%0A%0D%0AI would like to request a property viewing.%0D%0A%0D%0AName:%0D%0APhone:%0D%0APreferred date:%0D%0AMessage:";
		$mailto         = add_query_arg(
			[
				'subject' => $subject,
				'body'    => $body,
			],
			'mailto:' . $email
		);

		ob_start();
		?>

		<div style="border: 1px dashed #9ddbd2; border-radius: 20px; background: #f8fffe; padding: 22px;">
			<div style="color: #10201d; font-size: 16px; font-weight: 900; margin-bottom: 8px;">
				Request by email
			</div>
			<p style="color: #52635f; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
				JetFormBuilder is not connected for this demo yet, so requests are routed through the agency email fallback.
			</p>
			<a class="factory-button-link" href="<?php echo esc_url( $mailto ); ?>" style="display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: <?php echo esc_attr( $accent ); ?>; color: #fff; padding: 12px 16px; font-size: 14px; font-weight: 900; text-decoration: none;">
				Email the agency
			</a>
		</div>

		<?php
		return ob_get_clean();
	}

	private function get_request_viewing_property_context(): array {
		$slug = isset( $_GET['factory_property'] )
			? sanitize_title( wp_unslash( (string) $_GET['factory_property'] ) )
			: '';

		if ( '' === $slug ) {
			return [];
		}

		$post = get_page_by_path( $slug, OBJECT, 'property' );

		if ( ! $post || 'publish' !== $post->post_status ) {
			return [];
		}

		return [
			'id'      => (int) $post->ID,
			'slug'    => $slug,
			'title'   => get_the_title( $post ),
			'address' => (string) get_post_meta( $post->ID, 'address', true ),
			'price'   => (string) get_post_meta( $post->ID, 'price', true ),
		];
	}

	private function get_request_viewing_config( array $blueprint ): array {
		$config = $blueprint['site']['forms']['request_viewing'] ?? [];

		return is_array( $config ) ? $config : [];
	}

	private function is_request_viewing_enabled( array $blueprint ): bool {
		$config = $this->get_request_viewing_config( $blueprint );

		return ! empty( $config ) && false !== ( $config['enabled'] ?? true );
	}

	private function resolve_request_viewing_form_id( array $config ): int {
		$configured_id = absint( $config['jetformbuilder_form_id'] ?? 0 );

		if ( $configured_id ) {
			return $this->get_valid_jetformbuilder_form_id( $config );
		}

		return $this->find_generated_request_viewing_form();
	}

	private function get_valid_jetformbuilder_form_id( array $config ): int {
		$form_id = absint( $config['jetformbuilder_form_id'] ?? 0 );

		if ( ! $form_id || ! $this->is_jetformbuilder_available() ) {
			return 0;
		}

		$form = get_post( $form_id );

		if ( ! $form || 'jet-form-builder' !== $form->post_type || 'publish' !== $form->post_status ) {
			return 0;
		}

		return $form_id;
	}

	private function is_jetformbuilder_available(): bool {
		if ( ! function_exists( 'is_plugin_active' ) && defined( 'ABSPATH' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$is_active = function_exists( 'jet_form_builder' )
			|| defined( 'JET_FORM_BUILDER_VERSION' )
			|| ( function_exists( 'is_plugin_active' ) && is_plugin_active( 'jet-form-builder/jet-form-builder.php' ) );

		if ( ! $is_active ) {
			return false;
		}

		return post_type_exists( 'jet-form-builder' );
	}

	private function upsert_request_viewing_form( array $blueprint ): ?array {
		if ( ! $this->is_request_viewing_enabled( $blueprint ) ) {
			return null;
		}

		$configured_id = absint( $this->get_request_viewing_config( $blueprint )['jetformbuilder_form_id'] ?? 0 );

		if ( $configured_id || ! $this->is_jetformbuilder_available() ) {
			return null;
		}

		$existing_id  = $this->find_generated_request_viewing_form();
		$target_state = $this->get_request_viewing_generated_form_state();
		$action       = $existing_id ? 'update' : 'create';

		if ( $existing_id ) {
			$current_state = $this->get_current_request_viewing_form_state( $existing_id );
			$diff          = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
				return $this->execution_item(
					'ok',
					'skip',
					'request_viewing',
					'Request Viewing form up-to-date.',
					'form'
				);
			}

			$post_id = wp_update_post(
				[
					'ID'           => $existing_id,
					'post_type'    => 'jet-form-builder',
					'post_title'   => $target_state['post_title'],
					'post_name'    => $target_state['post_name'],
					'post_status'  => $target_state['post_status'],
					'post_content' => $target_state['post_content'],
				],
				true
			);
		} else {
			$post_id = wp_insert_post(
				[
					'post_type'    => 'jet-form-builder',
					'post_title'   => $target_state['post_title'],
					'post_name'    => $target_state['post_name'],
					'post_status'  => $target_state['post_status'],
					'post_content' => $target_state['post_content'],
				],
				true
			);
		}

		if ( is_wp_error( $post_id ) || ! $post_id ) {
			return $this->execution_item(
				'error',
				$action,
				'request_viewing',
				'Request Viewing form sync failed.',
				'form'
			);
		}

		$this->sync_request_viewing_form_meta( (int) $post_id, $target_state['meta'] );

		return $this->execution_item(
			'ok',
			$action,
			'request_viewing',
			'create' === $action
				? 'Request Viewing form created.'
				: 'Request Viewing form updated.',
			'form'
		);
	}

	private function get_request_viewing_form_plan_item( array $blueprint ): ?array {
		if ( ! $this->is_request_viewing_enabled( $blueprint ) ) {
			return null;
		}

		$config        = $this->get_request_viewing_config( $blueprint );
		$configured_id = absint( $config['jetformbuilder_form_id'] ?? 0 );

		if ( $configured_id ) {
			if ( $this->get_valid_jetformbuilder_form_id( $config ) ) {
				return [
					'action'  => 'skip',
					'type'    => 'form',
					'entity'  => 'request_viewing',
					'message' => "Configured Request Viewing JetFormBuilder form ready: {$configured_id}",
					'diff'    => [],
				];
			}

			return [
				'action'  => 'error',
				'type'    => 'form',
				'entity'  => 'request_viewing',
				'message' => "Configured JetFormBuilder form missing: {$configured_id}",
				'diff'    => [],
			];
		}

		if ( ! $this->is_jetformbuilder_available() ) {
			return [
				'action'  => 'skip',
				'type'    => 'form',
				'entity'  => 'request_viewing',
				'message' => 'Request Viewing email fallback will be used.',
				'diff'    => [],
			];
		}

		$existing_id = $this->find_generated_request_viewing_form();

		if ( ! $existing_id ) {
			return [
				'action'  => 'create',
				'type'    => 'form',
				'entity'  => 'request_viewing',
				'message' => 'Create Request Viewing JetFormBuilder form.',
				'diff'    => [],
			];
		}

		$current_state = $this->get_current_request_viewing_form_state( $existing_id );
		$target_state  = $this->get_request_viewing_generated_form_state();
		$diff          = factory_diff_arrays( $current_state, $target_state );

		if ( empty( $diff ) ) {
			return [
				'action'  => 'skip',
				'type'    => 'form',
				'entity'  => 'request_viewing',
				'message' => 'Request Viewing form up-to-date.',
				'diff'    => [],
			];
		}

		return [
			'action'  => 'update',
			'type'    => 'form',
			'entity'  => 'request_viewing',
			'message' => 'Update Request Viewing JetFormBuilder form.',
			'diff'    => $diff,
		];
	}

	private function find_generated_request_viewing_form(): int {
		if ( ! $this->is_jetformbuilder_available() ) {
			return 0;
		}

		$posts = get_posts(
			[
				'post_type'      => 'jet-form-builder',
				'post_status'    => 'publish',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_query'     => [
					[
						'key'   => '_factory_generated',
						'value' => '1',
					],
					[
						'key'   => '_factory_form_key',
						'value' => 'request_viewing',
					],
					[
						'key'   => '_factory_form_provider',
						'value' => 'jetformbuilder',
					],
				],
			]
		);

		if ( ! empty( $posts ) ) {
			return (int) $posts[0];
		}

		$post = get_page_by_path( 'request-viewing', OBJECT, 'jet-form-builder' );

		if (
			$post
			&& 'publish' === $post->post_status
			&& '1' === (string) get_post_meta( $post->ID, '_factory_generated', true )
			&& 'request_viewing' === (string) get_post_meta( $post->ID, '_factory_form_key', true )
			&& 'jetformbuilder' === (string) get_post_meta( $post->ID, '_factory_form_provider', true )
		) {
			return (int) $post->ID;
		}

		return 0;
	}

	private function get_request_viewing_generated_form_slug(): string {
		$generated_id = $this->find_generated_request_viewing_form();

		if ( $generated_id ) {
			$post = get_post( $generated_id );

			if ( $post && '' !== $post->post_name ) {
				return $post->post_name;
			}
		}

		$post = get_page_by_path( 'request-viewing', OBJECT, 'jet-form-builder' );

		if ( $post && '1' !== (string) get_post_meta( $post->ID, '_factory_generated', true ) ) {
			return 'factory-request-viewing';
		}

		return 'request-viewing';
	}

	private function get_request_viewing_generated_form_state(): array {
		return [
			'post_title'   => 'Request Viewing',
			'post_name'    => $this->get_request_viewing_generated_form_slug(),
			'post_status'  => 'publish',
			'post_content' => $this->get_request_viewing_generated_form_content(),
			'meta'         => $this->get_request_viewing_generated_form_meta(),
		];
	}

	private function get_request_viewing_generated_form_content(): string {
		return '<!-- wp:jet-forms/welcome /-->' . "\n\n"
			. '<!-- wp:jet-forms/hidden-field {"field_value":"query_var","query_var_key":"factory_property","name":"property_slug"} /-->' . "\n\n"
			. '<!-- wp:jet-forms/text-field {"label":"Name","name":"name"} /-->' . "\n\n"
			. '<!-- wp:jet-forms/text-field {"field_type":"email","label":"Email","name":"email"} /-->' . "\n\n"
			. '<!-- wp:jet-forms/text-field {"field_type":"tel","label":"Phone","name":"phone"} /-->' . "\n\n"
			. '<!-- wp:jet-forms/date-field {"is_timestamp":true,"label":"Preferred date","name":"preferred_time"} /-->' . "\n\n"
			. '<!-- wp:jet-forms/textarea-field {"label":"Message","name":"message"} /-->' . "\n\n"
			. '<!-- wp:jet-forms/submit-field /-->';
	}

	private function get_request_viewing_generated_form_meta(): array {
		return [
			'_jf_actions'             => [
				[
					'settings'   => [
						'save_record' => [
							'save_user_data' => false,
						],
					],
					'type'       => 'save_record',
					'conditions' => [],
					'events'     => [],
					'index'      => 0,
					'chosen'     => false,
					'selected'   => false,
				],
				[
					'settings'   => [
						'send_email' => [
							'mail_to'      => 'admin',
							'content_type' => 'text/plain',
							'content'      => "%property_slug%\n%name%\n%email%\n%phone%\n%preferred_time%\n%message%",
						],
					],
					'type'       => 'send_email',
					'conditions' => [],
					'events'     => [],
					'index'      => 1,
					'chosen'     => false,
					'selected'   => false,
				],
			],
			'_jf_args'                => [
				'load_nonce' => 'render',
			],
			'_jf_messages'            => [],
			'_jf_preset'              => [],
			'_jf_recaptcha'           => [],
			'_jf_validation'          => [],
			'_factory_generated'      => '1',
			'_factory_form_key'       => 'request_viewing',
			'_factory_form_provider'  => 'jetformbuilder',
		];
	}

	private function get_current_request_viewing_form_state( int $form_id ): array {
		$post = get_post( $form_id );
		$meta = [];

		foreach ( $this->get_request_viewing_generated_form_meta() as $key => $value ) {
			$meta[ $key ] = $this->normalize_array_for_diff( get_post_meta( $form_id, $key, true ) );
		}

		return [
			'post_title'   => $post ? $post->post_title : '',
			'post_name'    => $post ? $post->post_name : '',
			'post_status'  => $post ? $post->post_status : '',
			'post_content' => $post ? $post->post_content : '',
			'meta'         => $meta,
		];
	}

	private function sync_request_viewing_form_meta( int $form_id, array $meta ): void {
		foreach ( $meta as $key => $value ) {
			update_post_meta( $form_id, $key, $value );
		}
	}

	private function normalize_array_for_diff( $value ) {
		if ( is_object( $value ) ) {
			$value = (array) $value;
		}

		if ( ! is_array( $value ) ) {
			return $value;
		}

		ksort( $value );

		foreach ( $value as $key => $item ) {
			$value[ $key ] = $this->normalize_array_for_diff( $item );
		}

		return $value;
	}

	private function validate_generated_request_viewing_form( array $config ): ?array {
		$form_id = $this->find_generated_request_viewing_form();

		if ( ! $form_id ) {
			$provider = is_string( $config['provider'] ?? null ) ? strtolower( $config['provider'] ) : 'auto';

			return [
				'status'  => 'jetformbuilder' === $provider ? 'error' : 'warning',
				'message' => 'Generated Request Viewing JetFormBuilder form missing.',
			];
		}

		$current_state = $this->get_current_request_viewing_form_state( $form_id );
		$target_state  = $this->get_request_viewing_generated_form_state();
		$diff          = factory_diff_arrays( $current_state, $target_state );

		if ( ! empty( $diff ) ) {
			return [
				'status'  => 'warning',
				'message' => 'Generated Request Viewing JetFormBuilder form needs update.',
			];
		}

		return [
			'status'  => 'ok',
			'message' => "Generated Request Viewing JetFormBuilder form ready: {$form_id}",
		];
	}

	private function validate_request_viewing( array $blueprint ): ?array {
		$config = $this->get_request_viewing_config( $blueprint );

		if ( empty( $config ) || false === ( $config['enabled'] ?? true ) ) {
			return null;
		}

		$contact = $this->get_configured_page( $blueprint, 'contact' );
		$slug    = $contact['slug'] ?? '';
		$page    = $slug ? get_page_by_path( $slug ) : null;

		if ( ! $page || false === strpos( $page->post_content, '[factory_request_viewing]' ) ) {
			return [
				'status'  => 'error',
				'message' => 'Request Viewing section missing from Contact page.',
			];
		}

		$form_id = absint( $config['jetformbuilder_form_id'] ?? 0 );

		if ( $form_id && ! $this->get_valid_jetformbuilder_form_id( $config ) ) {
			return [
				'status'  => 'error',
				'message' => "Configured JetFormBuilder form missing: {$form_id}",
			];
		}

		if ( $this->get_valid_jetformbuilder_form_id( $config ) ) {
			return [
				'status'  => 'ok',
				'message' => 'Request Viewing JetFormBuilder form embedded on Contact page.',
			];
		}

		if ( $this->is_jetformbuilder_available() ) {
			return $this->validate_generated_request_viewing_form( $config );
		}

		return [
			'status'  => 'ok',
			'message' => 'Request Viewing fallback rendered on Contact page. JetFormBuilder is optional for this beta flow.',
		];
	}

	private function resolve_frontend_url( $url, string $fallback ): string {
		$url = is_string( $url ) ? trim( $url ) : '';

		if ( '' === $url ) {
			$url = $fallback;
		}

		if ( '' === $url ) {
			return '';
		}

		if (
			0 === strpos( $url, '#' )
			|| 0 === strpos( $url, 'mailto:' )
			|| 0 === strpos( $url, 'tel:' )
			|| preg_match( '#^https?://#i', $url )
		) {
			return $url;
		}

		return home_url( '/' . ltrim( $url, '/' ) );
	}

	private function get_archive_page_config( string $post_type ): array {
		$blueprint = factory_get_blueprint();

		$archive = $blueprint['pages']['archive'] ?? [];

		if ( ( $archive['post_type'] ?? '' ) === $post_type ) {
			return $archive;
		}

		return [];
	}

	private function find_jetengine_listing_id( string $slug ): int {
		if ( '' === $slug ) {
			return 0;
		}

		$posts = get_posts( [
			'post_type'   => 'jet-engine',
			'post_status' => 'any',
			'name'        => $slug,
			'numberposts' => 1,
		] );

		return isset( $posts[0] ) ? (int) $posts[0]->ID : 0;
	}

	private function find_jetsmartfilters_filter_id( string $slug ): int {
		if ( '' === $slug ) {
			return 0;
		}

		$posts = get_posts( [
			'post_type'   => 'jet-smart-filters',
			'post_status' => 'any',
			'numberposts' => 1,
			'meta_query'  => [
				'relation' => 'AND',
				[
					'key'   => '_factory_filter_key',
					'value' => $slug,
				],
				[
					'key'   => '_factory_filter_provider',
					'value' => 'jetsmartfilters',
				],
			],
		] );

		return isset( $posts[0] ) ? (int) $posts[0]->ID : 0;
	}

	private function is_jetsmartfilters_available(): bool {
		return post_type_exists( 'jet-smart-filters' )
			|| ( function_exists( 'jet_smart_filters' ) && '' !== (string) get_option( 'jet_smart_filters_version', '' ) );
	}

	private function resolve_jetengine_query_row_id( string $query_slug, string $query_id ): int {
		if ( ! function_exists( 'jet_engine' ) || ! class_exists( 'Jet_Engine\\Query_Builder\\Manager' ) ) {
			return 0;
		}

		$manager = \Jet_Engine\Query_Builder\Manager::instance();

		if ( empty( $manager->data ) || empty( $manager->data->db ) ) {
			return 0;
		}

		$rows = $manager->data->db->query( $manager->data->table, [ 'status' => 'query' ], null, false );

		if ( ! is_array( $rows ) ) {
			return 0;
		}

		foreach ( $rows as $row ) {
			$args = maybe_unserialize( $row['args'] ?? [] );

			if ( ! is_array( $args ) ) {
				continue;
			}

			if ( '' !== $query_id && ( $args['query_id'] ?? '' ) === $query_id ) {
				return absint( $row['id'] ?? 0 );
			}

			if ( '' !== $query_slug && ( $args['query_id'] ?? '' ) === 'factory_' . $query_slug ) {
				return absint( $row['id'] ?? 0 );
			}
		}

		return 0;
	}

	private function get_listing_slug_for_post_type( array $blueprint, string $post_type ): string {
		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			if ( ( $listing['post_type'] ?? '' ) === $post_type ) {
				return $listing['slug'] ?? '';
			}
		}

		return '';
	}

	private function get_listing_by_slug( array $blueprint, string $slug ): array {
		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			if ( ( $listing['slug'] ?? '' ) === $slug ) {
				return $listing;
			}
		}

		return [];
	}

	private function log( string $message ): void {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::log( $message );
		}
	}
}
