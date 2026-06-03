<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Render_Adapter {

	private array $execution_results = [];

	public function register( array $blueprint ): void {
		add_shortcode( 'factory_listing', [ $this, 'render_listing_shortcode' ] );
		add_action( 'template_redirect', [ $this, 'redirect_property_archive' ] );
	}

	public function redirect_property_archive(): void {
		if ( is_admin() || ! is_post_type_archive( 'property' ) ) {
			return;
		}

		wp_safe_redirect( home_url( '/properties/' ), 302 );
		exit;
	}

	public function apply( array $blueprint ): void {
		$this->execution_results = [];

		foreach ( $blueprint['listings'] ?? [] as $listing ) {
			$result = $this->upsert_listing_page( $listing );

			if ( is_array( $result ) ) {
				$this->execution_results[] = $result;
			}
		}

		foreach ( [ 'home', 'contact' ] as $page_key ) {
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

			$current_state = [
				'post_title'   => $existing->post_title,
				'post_name'    => $existing->post_name,
				'post_status'  => $existing->post_status,
				'post_content' => $existing->post_content,
			];

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

		foreach ( [ 'home', 'contact' ] as $page_key ) {
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

		foreach ( [ 'home', 'contact' ] as $page_key ) {
			$page_check = $this->validate_configured_page( $blueprint, $page_key );

			if ( is_array( $page_check ) ) {
				$results[] = $page_check;
			}
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

		return $results;
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
			$current_state = [
				'post_title'   => $existing->post_title,
				'post_name'    => $existing->post_name,
				'post_status'  => $existing->post_status,
				'post_content' => $existing->post_content,
			];

			$diff = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
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
			$this->humanize_key( $page_key ) . ' page'
		);
	}

	private function upsert_page(
		string $page_slug,
		string $page_title,
		string $content,
		string $item_type,
		string $label
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
			$current_state = [
				'post_title'   => $existing->post_title,
				'post_name'    => $existing->post_name,
				'post_status'  => $existing->post_status,
				'post_content' => $existing->post_content,
			];

			$diff = factory_diff_arrays( $current_state, $target_state );

			if ( empty( $diff ) ) {
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

		return $this->execution_item(
			'ok',
			'create',
			$page_slug,
			"{$label} created: {$page_slug}",
			$item_type
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

		$current_state = [
			'post_title'   => $existing->post_title,
			'post_name'    => $existing->post_name,
			'post_status'  => $existing->post_status,
			'post_content' => $existing->post_content,
		];

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

		$current_state = [
			'post_title'   => $existing->post_title,
			'post_content' => $existing->post_content,
		];

		$target_state = [
			'post_title'   => $page_title,
			'post_content' => $content,
		];

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

		if ( $is_current && ( $is_assigned || ! $location ) ) {
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
		}

		if ( $location && ! $is_assigned ) {
			$locations              = get_theme_mod( 'nav_menu_locations', [] );
			$locations[ $location ] = $menu_id;
			set_theme_mod( 'nav_menu_locations', $locations );
		}

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
		}

		$query = new WP_Query( $query_args );

		if ( ! $query->have_posts() && ! $is_property_archive ) {
			return '<p>No items found.</p>';
		}

		$fields = $this->get_render_fields( $listing, $blueprint, $post_type );

		ob_start();
		?>

		<?php if ( '' === $query_key ) : ?>
			<section class="factory-listing-wrap" style="max-width: 1120px; margin: 80px auto; padding: 0 24px;">
				<header style="margin-bottom: 40px;">
					<h1 style="font-size: clamp(40px, 6vw, 72px); line-height: 1.05;">
						<?php echo esc_html( $listing['title'] ?? 'Listing' ); ?>
					</h1>
				</header>

				<?php if ( $is_property_archive ) : ?>
					<?php echo $this->render_property_filters( $property_filters, $query, $style_tokens ); ?>
				<?php endif; ?>
		<?php endif; ?>

		<?php if ( $query->have_posts() ) : ?>
			<div class="factory-listing-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px;">
				<?php
				while ( $query->have_posts() ) :
					$query->the_post();

					if ( $is_property_listing ) {
						echo $this->render_property_card( get_the_ID(), $style_tokens );
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

		<?php if ( '' === $query_key ) : ?>
			</section>
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

	private function render_property_filters( array $filters, WP_Query $query, array $style_tokens ): string {
		$options   = $this->get_property_filter_options();
		$reset_url = $this->get_property_filter_reset_url();
		$count     = (int) $query->found_posts;
		$label     = 1 === $count ? 'property found' : 'properties found';

		ob_start();
		?>

		<form class="factory-property-filters" method="get" action="<?php echo esc_url( $reset_url ); ?>" style="background: <?php echo esc_attr( $style_tokens['background'] ); ?>; border: 1px solid #b9e6de; border-radius: 20px; padding: 18px; margin: 0 0 24px;">
			<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; align-items: end;">
				<?php echo $this->render_property_filter_select( 'purpose', 'Purpose', $filters['purpose'], $options['purpose'], [] ); ?>
				<?php echo $this->render_property_filter_select( 'property_type', 'Property Type', $filters['property_type'], $options['property_type'], [] ); ?>
				<?php echo $this->render_property_filter_select( 'district', 'District', $filters['district'], $options['district'], [] ); ?>
				<?php echo $this->render_property_filter_select( 'bedrooms', 'Bedrooms', $filters['bedrooms'], $options['bedrooms'], [ '1' => '1+', '2' => '2+', '3' => '3+', '4' => '4+' ] ); ?>

				<label style="display: grid; gap: 7px; color: #213532; font-size: 13px; font-weight: 800;">
					<?php echo esc_html( 'Price min' ); ?>
					<input type="number" min="0" step="1" name="price_min" value="<?php echo esc_attr( $filters['price_min'] ); ?>" placeholder="100000" style="width: 100%; border: 1px solid #9ddbd2; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: #fff;">
				</label>

				<label style="display: grid; gap: 7px; color: #213532; font-size: 13px; font-weight: 800;">
					<?php echo esc_html( 'Price max' ); ?>
					<input type="number" min="0" step="1" name="price_max" value="<?php echo esc_attr( $filters['price_max'] ); ?>" placeholder="300000" style="width: 100%; border: 1px solid #9ddbd2; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: #fff;">
				</label>

				<div style="display: flex; gap: 10px; flex-wrap: wrap;">
					<button type="submit" style="border: 0; border-radius: 999px; background: <?php echo esc_attr( $style_tokens['primary'] ); ?>; color: #fff; min-height: 42px; padding: 0 18px; font-weight: 800; cursor: pointer;">
						<?php echo esc_html( 'Search' ); ?>
					</button>
					<a href="<?php echo esc_url( $reset_url ); ?>" style="display: inline-flex; align-items: center; min-height: 42px; color: <?php echo esc_attr( $style_tokens['primary'] ); ?>; font-weight: 800; text-decoration: none;">
						<?php echo esc_html( 'Reset' ); ?>
					</a>
				</div>
			</div>
		</form>

		<div class="factory-property-results-count" style="margin: 0 0 20px; color: #52635f; font-size: 15px; font-weight: 700;">
			<?php echo esc_html( "{$count} {$label}" ); ?>
		</div>

		<?php
		return ob_get_clean();
	}

	private function render_property_filter_select(
		string $name,
		string $label,
		string $selected,
		array $options,
		array $labels
	): string {
		ob_start();
		?>

		<label style="display: grid; gap: 7px; color: #213532; font-size: 13px; font-weight: 800;">
			<?php echo esc_html( $label ); ?>
			<select name="<?php echo esc_attr( $name ); ?>" style="width: 100%; border: 1px solid #9ddbd2; border-radius: 12px; min-height: 42px; padding: 8px 11px; background: #fff; color: #10201d;">
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

	private function render_property_card( int $post_id, array $style_tokens ): string {
		$primary       = $style_tokens['primary'];
		$accent        = $style_tokens['accent'];
		$background    = $style_tokens['background'];
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

		<article class="factory-property-card" style="background: #fff; border: 1px solid #d7eee9; border-radius: 20px; overflow: hidden; box-shadow: 0 16px 38px rgba(15, 118, 110, 0.11);">
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
					<a href="<?php echo esc_url( $permalink ); ?>" style="color: #10201d; text-decoration: none;">
						<?php echo esc_html( $title ); ?>
					</a>
				</h2>

				<?php if ( '' !== $address ) : ?>
					<div style="color: #52635f; font-size: 14px; line-height: 1.5; margin-bottom: 8px;">
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
							<span style="display: inline-flex; align-items: center; border-radius: 999px; background: <?php echo esc_attr( $background ); ?>; color: #213532; padding: 7px 10px; font-size: 13px; font-weight: 700;">
								<?php echo esc_html( $stat ); ?>
							</span>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>

				<a href="<?php echo esc_url( $permalink ); ?>" style="display: inline-flex; align-items: center; color: <?php echo esc_attr( $accent ); ?>; font-size: 14px; font-weight: 800; text-decoration: none;">
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
			'primary'    => $this->sanitize_color_token( $style['primary'] ?? '', '#0f766e' ),
			'accent'     => $this->sanitize_color_token( $style['accent'] ?? '', '#14b8a6' ),
			'background' => $this->sanitize_color_token( $style['background'] ?? '', '#ecfeff' ),
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

	private function get_configured_page_content( array $blueprint, string $page_key ): string {
		if ( 'home' === $page_key ) {
			return $this->render_home_page_content( $blueprint );
		}

		if ( 'contact' === $page_key ) {
			return $this->render_contact_page_content( $blueprint );
		}

		$page = $this->get_configured_page( $blueprint, $page_key );

		return is_string( $page['content'] ?? null ) ? $page['content'] : '';
	}

	private function render_home_page_content( array $blueprint ): string {
		$home         = $this->get_configured_page( $blueprint, 'home' );
		$sections     = is_array( $home['sections'] ?? null ) ? $home['sections'] : [];
		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$primary      = $style_tokens['primary'];
		$accent       = $style_tokens['accent'];
		$background   = $style_tokens['background'];
		$html         = '<style>body.front-page .entry-title, body.front-page .page-title, body.home .entry-title, body.home .page-title { display: none !important; }</style>';
		$html        .= '<div class="factory-home-page" style="background: #fff; color: #10201d; margin: -40px 0 0;">';

		foreach ( $sections as $section ) {
			if ( ! is_array( $section ) ) {
				continue;
			}

			$type = $section['type'] ?? '';

			if ( 'hero' === $type ) {
				$title     = $section['title'] ?? ( $home['title'] ?? 'Kyiv Turquoise Realty' );
				$subtitle  = $section['subtitle'] ?? '';
				$cta_label = $section['cta_label'] ?? 'Browse properties';
				$cta_url   = $section['cta_url'] ?? '/properties/';

				$html .= '<section class="factory-home-hero" style="width: 100vw; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); background: ' . esc_attr( $background ) . '; padding: 76px 0 54px;">';
				$html .= '<div style="max-width: 1120px; margin: 0 auto; padding: 0 24px;">';
				$html .= '<div style="max-width: 720px;">';
				$html .= '<span style="display: inline-flex; border-radius: 999px; background: #fff; color: ' . esc_attr( $primary ) . '; padding: 8px 12px; font-size: 13px; font-weight: 800; margin-bottom: 18px;">Real Estate Beta</span>';
				$html .= '<h1 style="font-size: clamp(36px, 4.5vw, 56px); line-height: 1.05; margin: 0 0 18px; letter-spacing: 0;">' . esc_html( $title ) . '</h1>';
				$html .= '<p style="font-size: clamp(18px, 2.4vw, 26px); line-height: 1.45; color: #31524d; margin: 0 0 28px;">' . esc_html( $subtitle ) . '</p>';
				$html .= '<a href="' . esc_url( $cta_url ) . '" style="display: inline-flex; align-items: center; border-radius: 999px; background: ' . esc_attr( $accent ) . '; color: #fff; padding: 14px 20px; font-size: 15px; font-weight: 900; text-decoration: none;">' . esc_html( $cta_label ) . '</a>';
				$html .= '</div>';
				$html .= '</div>';
				$html .= '</section>';
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
				$html .= '<h2 style="font-size: clamp(28px, 4vw, 44px); line-height: 1.08; margin: 6px 0 0;">' . esc_html( $title ) . '</h2>';
				$html .= '</div>';
				$html .= '<a href="/properties/" style="color: ' . esc_attr( $accent ) . '; font-size: 14px; font-weight: 900; text-decoration: none;">View all</a>';
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
				$title     = $section['title'] ?? 'Ready to find your Kyiv property?';
				$text      = $section['text'] ?? '';
				$cta_label = $section['cta_label'] ?? 'Contact agency';
				$cta_url   = $section['cta_url'] ?? '/contact/';

				$html .= '<section style="max-width: 1120px; margin: 0 auto; padding: 44px 24px 84px;">';
				$html .= '<div style="background: #fff; border: 1px solid #d7eee9; border-radius: 24px; padding: clamp(28px, 5vw, 54px); box-shadow: 0 18px 44px rgba(15, 118, 110, 0.11);">';
				$html .= '<h2 style="font-size: clamp(30px, 4vw, 50px); line-height: 1.08; margin: 0 0 12px;">' . esc_html( $title ) . '</h2>';
				$html .= '<p style="max-width: 620px; color: #52635f; font-size: 17px; line-height: 1.6; margin: 0 0 24px;">' . esc_html( $text ) . '</p>';
				$html .= '<a href="' . esc_url( $cta_url ) . '" style="display: inline-flex; align-items: center; border-radius: 999px; background: ' . esc_attr( $primary ) . '; color: #fff; padding: 13px 18px; font-size: 14px; font-weight: 900; text-decoration: none;">' . esc_html( $cta_label ) . '</a>';
				$html .= '</div>';
				$html .= '</section>';
			}
		}

		$html .= '</div>';

		return $html;
	}

	private function render_contact_page_content( array $blueprint ): string {
		$contact      = $this->get_configured_page( $blueprint, 'contact' );
		$style_tokens = $this->get_site_style_tokens( $blueprint );
		$primary      = $style_tokens['primary'];
		$accent       = $style_tokens['accent'];
		$background   = $style_tokens['background'];
		$title        = $contact['title'] ?? 'Contact Kyiv Turquoise Realty';
		$text         = $contact['text'] ?? '';
		$phone        = $contact['phone'] ?? '';
		$email        = $contact['email'] ?? '';
		$cta_label    = $contact['cta_label'] ?? 'Browse properties';
		$cta_url      = $contact['cta_url'] ?? '/properties/';

		$html  = '<section class="factory-contact-page" style="background: ' . esc_attr( $background ) . '; margin: -40px 0 0; padding: 88px 24px; color: #10201d;">';
		$html .= '<div style="max-width: 920px; margin: 0 auto;">';
		$html .= '<span style="display: inline-flex; border-radius: 999px; background: #fff; color: ' . esc_attr( $primary ) . '; padding: 8px 12px; font-size: 13px; font-weight: 900; margin-bottom: 18px;">Kyiv agency</span>';
		$html .= '<h1 style="font-size: clamp(42px, 6vw, 72px); line-height: 1.02; margin: 0 0 18px;">' . esc_html( $title ) . '</h1>';
		$html .= '<p style="max-width: 680px; color: #52635f; font-size: 19px; line-height: 1.6; margin: 0 0 34px;">' . esc_html( $text ) . '</p>';
		$html .= '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 32px;">';
		$html .= '<div style="background: #fff; border: 1px solid #d7eee9; border-radius: 20px; padding: 22px;"><strong style="display: block; color: ' . esc_attr( $primary ) . '; margin-bottom: 6px;">Phone</strong><span>' . esc_html( $phone ) . '</span></div>';
		$html .= '<div style="background: #fff; border: 1px solid #d7eee9; border-radius: 20px; padding: 22px;"><strong style="display: block; color: ' . esc_attr( $primary ) . '; margin-bottom: 6px;">Email</strong><span>' . esc_html( $email ) . '</span></div>';
		$html .= '</div>';
		$html .= '<a href="' . esc_url( $cta_url ) . '" style="display: inline-flex; align-items: center; border-radius: 999px; background: ' . esc_attr( $accent ) . '; color: #fff; padding: 14px 20px; font-size: 15px; font-weight: 900; text-decoration: none;">' . esc_html( $cta_label ) . '</a>';
		$html .= '</div>';
		$html .= '</section>';

		return $html;
	}

	private function get_archive_page_config( string $post_type ): array {
		$blueprint = factory_get_blueprint();

		$archive = $blueprint['pages']['archive'] ?? [];

		if ( ( $archive['post_type'] ?? '' ) === $post_type ) {
			return $archive;
		}

		return [];
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
