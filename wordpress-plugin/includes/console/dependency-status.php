<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_console_dependency_status_data(): array {
	if ( ! function_exists( 'get_plugins' ) || ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$definitions = factory_console_dependency_definitions();
	$dependencies = [];
	$wizard_dependency = null;

	foreach ( $definitions as $definition ) {
		$item = 'theme' === $definition['type']
			? factory_console_theme_dependency_status( $definition )
			: factory_console_plugin_dependency_status( $definition );
		$item['capabilities'] = factory_console_dependency_capabilities( $item['slug'] );

		if ( 'jet-plugins-wizard' === $item['slug'] ) {
			$wizard_dependency = $item;
			continue;
		}

		$dependencies[] = $item;
	}

	$capability_model = factory_console_dependency_capability_model();
	$seeded_capabilities = $capability_model['site_type_capabilities']['real_estate'] ?? [];
	$license = factory_console_license_status( $wizard_dependency );
	$helper = factory_console_setup_helper_status( $wizard_dependency, $license );
	$needs_attention = factory_console_has_dependency_issues( $dependencies, $seeded_capabilities );

	return [
		'overall_status' => $needs_attention ? 'needs_attention' : 'ready',
		'overall_label'  => $needs_attention ? 'Needs attention' : 'Ready',
		'dependencies'   => $dependencies,
		'capability_model' => $capability_model,
		'seeded_capabilities' => $seeded_capabilities,
		'site_type'      => 'real_estate',
		'setup_helper'   => $helper,
		'license'        => $license,
	];
}

function factory_console_has_dependency_issues( array $dependencies, array $required_capabilities ): bool {
	$required_capabilities = array_values( array_filter( array_map( 'strval', $required_capabilities ) ) );

	foreach ( $dependencies as $dependency ) {
		$dependency_capabilities = array_values( array_filter( array_map( 'strval', $dependency['capabilities'] ?? [] ) ) );
		$is_required = ! empty( array_intersect( $required_capabilities, $dependency_capabilities ) );

		if ( $is_required && 'ok' !== (string) ( $dependency['status'] ?? '' ) ) {
			return true;
		}
	}

	return false;
}

function factory_console_dependency_capability_model(): array {
	return [
		'capabilities' => [
			'real_estate_catalog' => 'Real estate catalog',
			'property_filters'    => 'Property filters',
			'contact_form'        => 'Contact form',
			'ecommerce'           => 'Ecommerce',
			'elementor_templates' => 'Elementor templates',
		],
		'site_type_capabilities' => [
			'real_estate' => [ 'real_estate_catalog', 'property_filters' ],
		],
		'dependency_capabilities' => [
			'kava'              => [ 'real_estate_catalog' ],
			'jet-engine'        => [ 'real_estate_catalog' ],
			'jet-smart-filters' => [ 'property_filters' ],
			'jet-form-builder'  => [ 'contact_form' ],
			'woocommerce'       => [ 'ecommerce' ],
			'elementor'         => [ 'elementor_templates' ],
		],
	];
}

function factory_console_dependency_capabilities( string $slug ): array {
	$model = factory_console_dependency_capability_model();

	return array_values( $model['dependency_capabilities'][ $slug ] ?? [] );
}

function factory_console_setup_helper_status( ?array $wizard, array $license ): array {
	$wizard_installed = ! empty( $wizard['installed'] );
	$wizard_active = ! empty( $wizard['active'] );

	return [
		'wizard' => [
			'installed'   => $wizard_installed,
			'active'      => $wizard_active,
			'version'     => $wizard['version'] ?? null,
			'status'      => $wizard_active ? 'available' : ( $wizard_installed ? 'installed_inactive' : 'missing' ),
			'action_hint' => $wizard_active ? 'open_wizard' : 'none',
		],
		'message' => $license['message'] ?? '',
	];
}

function factory_console_dependency_definitions(): array {
	return [
		[
			'slug'                     => 'kava',
			'name'                     => 'Kava',
			'type'                     => 'theme',
			'required_for_real_estate' => true,
			'minimum_version'          => null,
			'stylesheets'              => [ 'kava' ],
			'templates'                => [ 'kava' ],
			'action_hint'              => [
				'missing'       => 'open_themes',
				'inactive'      => 'open_themes',
				'wrong_version' => 'open_themes',
				'ok'            => 'none',
			],
		],
		[
			'slug'                     => 'jet-engine',
			'name'                     => 'JetEngine',
			'type'                     => 'plugin',
			'required_for_real_estate' => true,
			'minimum_version'          => null,
			'plugin_basenames'         => [ 'jet-engine/jet-engine.php' ],
			'plugin_dirs'              => [ 'jet-engine' ],
			'action_hint'              => [
				'missing'       => 'upload_zip',
				'inactive'      => 'open_plugins',
				'wrong_version' => 'open_plugins',
				'ok'            => 'none',
			],
		],
		[
			'slug'                     => 'jet-smart-filters',
			'name'                     => 'JetSmartFilters',
			'type'                     => 'plugin',
			'required_for_real_estate' => true,
			'minimum_version'          => null,
			'plugin_basenames'         => [ 'jet-smart-filters/jet-smart-filters.php' ],
			'plugin_dirs'              => [ 'jet-smart-filters' ],
			'action_hint'              => [
				'missing'       => 'upload_zip',
				'inactive'      => 'open_plugins',
				'wrong_version' => 'open_plugins',
				'ok'            => 'none',
			],
		],
		[
			'slug'                     => 'jet-form-builder',
			'name'                     => 'JetFormBuilder',
			'type'                     => 'plugin',
			'required_for_real_estate' => false,
			'minimum_version'          => null,
			'plugin_basenames'         => [ 'jet-form-builder/jet-form-builder.php' ],
			'plugin_dirs'              => [ 'jet-form-builder' ],
			'action_hint'              => [
				'missing'       => 'upload_zip',
				'inactive'      => 'open_plugins',
				'wrong_version' => 'open_plugins',
				'ok'            => 'none',
			],
		],
		[
			'slug'                     => 'elementor',
			'name'                     => 'Elementor',
			'type'                     => 'plugin',
			'required_for_real_estate' => false,
			'minimum_version'          => null,
			'plugin_basenames'         => [ 'elementor/elementor.php' ],
			'plugin_dirs'              => [ 'elementor' ],
			'action_hint'              => [
				'missing'       => 'open_plugins',
				'inactive'      => 'open_plugins',
				'wrong_version' => 'open_plugins',
				'ok'            => 'none',
			],
		],
		[
			'slug'                     => 'woocommerce',
			'name'                     => 'WooCommerce',
			'type'                     => 'plugin',
			'required_for_real_estate' => false,
			'minimum_version'          => null,
			'plugin_basenames'         => [ 'woocommerce/woocommerce.php' ],
			'plugin_dirs'              => [ 'woocommerce' ],
			'action_hint'              => [
				'missing'       => 'open_plugins',
				'inactive'      => 'open_plugins',
				'wrong_version' => 'open_plugins',
				'ok'            => 'none',
			],
		],
		[
			'slug'                     => 'jet-plugins-wizard',
			'name'                     => 'Crocoblock Wizard',
			'type'                     => 'plugin',
			'required_for_real_estate' => false,
			'minimum_version'          => null,
			'plugin_basenames'         => [
				'jet-plugins-wizard/jet-plugins-wizard.php',
				'jet-plugins-wizard-master/jet-plugins-wizard.php',
			],
			'plugin_dirs'              => [ 'jet-plugins-wizard', 'jet-plugins-wizard-master' ],
			'action_hint'              => [
				'missing'       => 'upload_zip',
				'inactive'      => 'open_plugins',
				'wrong_version' => 'open_plugins',
				'ok'            => 'open_wizard',
			],
		],
	];
}

function factory_console_theme_dependency_status( array $definition ): array {
	$themes = wp_get_themes();
	$active_theme = wp_get_theme();
	$installed_theme = null;

	foreach ( $definition['stylesheets'] as $stylesheet ) {
		if ( isset( $themes[ $stylesheet ] ) ) {
			$installed_theme = $themes[ $stylesheet ];
			break;
		}
	}

	if ( ! $installed_theme ) {
		foreach ( $themes as $theme ) {
			$template = $theme->get_template();
			if ( in_array( $template, $definition['templates'], true ) ) {
				$installed_theme = $theme;
				break;
			}
		}
	}

	$installed = (bool) $installed_theme;
	$active = false;
	$version = null;
	$status = $definition['required_for_real_estate'] ? 'missing' : 'optional_missing';

	if ( $installed_theme ) {
		$version = (string) $installed_theme->get( 'Version' );
		$stylesheet = $active_theme->get_stylesheet();
		$template = $active_theme->get_template();
		$active = in_array( $stylesheet, $definition['stylesheets'], true ) || in_array( $template, $definition['templates'], true );

		if ( ! $active ) {
			$status = 'inactive';
		} elseif ( ! empty( $definition['minimum_version'] ) && version_compare( $version, $definition['minimum_version'], '<' ) ) {
			$status = 'wrong_version';
		} else {
			$status = 'ok';
		}
	}

	return [
		'slug'                     => $definition['slug'],
		'name'                     => $definition['name'],
		'type'                     => 'theme',
		'required_for_real_estate' => (bool) $definition['required_for_real_estate'],
		'installed'                => $installed,
		'active'                   => $active,
		'version'                  => $version,
		'minimum_version'          => $definition['minimum_version'],
		'status'                   => $status,
		'action_hint'              => $definition['action_hint'][ $status ] ?? 'none',
	];
}

function factory_console_plugin_dependency_status( array $definition ): array {
	$plugins = get_plugins();
	$installed_plugin = null;
	$installed_basename = null;

	foreach ( $definition['plugin_basenames'] as $basename ) {
		if ( isset( $plugins[ $basename ] ) ) {
			$installed_plugin = $plugins[ $basename ];
			$installed_basename = $basename;
			break;
		}
	}

	if ( ! $installed_plugin ) {
		foreach ( $plugins as $basename => $plugin_data ) {
			$dir = dirname( $basename );
			if ( in_array( $dir, $definition['plugin_dirs'], true ) ) {
				$installed_plugin = $plugin_data;
				$installed_basename = $basename;
				break;
			}
		}
	}

	$installed = (bool) $installed_plugin;
	$active = false;
	$version = null;
	$status = $definition['required_for_real_estate'] ? 'missing' : 'optional_missing';

	if ( $installed_plugin ) {
		$version = isset( $installed_plugin['Version'] ) ? (string) $installed_plugin['Version'] : null;
		$active = $installed_basename ? is_plugin_active( $installed_basename ) : false;

		if ( ! $active ) {
			$status = 'inactive';
		} elseif ( ! empty( $definition['minimum_version'] ) && version_compare( (string) $version, $definition['minimum_version'], '<' ) ) {
			$status = 'wrong_version';
		} else {
			$status = 'ok';
		}
	}

	return [
		'slug'                     => $definition['slug'],
		'name'                     => $definition['name'],
		'type'                     => 'plugin',
		'required_for_real_estate' => (bool) $definition['required_for_real_estate'],
		'installed'                => $installed,
		'active'                   => $active,
		'version'                  => $version,
		'minimum_version'          => $definition['minimum_version'],
		'status'                   => $status,
		'action_hint'              => $definition['action_hint'][ $status ] ?? 'none',
	];
}

function factory_console_find_dependency( array $dependencies, string $slug ): ?array {
	foreach ( $dependencies as $dependency ) {
		if ( $slug === (string) ( $dependency['slug'] ?? '' ) ) {
			return $dependency;
		}
	}

	return null;
}

function factory_console_license_status( ?array $wizard ): array {
	$wizard_installed = ! empty( $wizard['installed'] );
	$wizard_active = ! empty( $wizard['active'] );
	$raw_license = get_option( 'jet_theme_core_license' );
	$has_license = is_string( $raw_license ) ? '' !== trim( $raw_license ) : ! empty( $raw_license );
	$state = 'wizard_missing';
	$message = 'Wizard is not installed. Use Plugins, Themes, or the official ZIP/manual setup path as needed.';
	$action_hint = 'none';

	if ( $wizard_installed && ! $wizard_active ) {
		$state = 'validation_requires_wizard';
		$message = 'Wizard is installed but inactive. Activate it for official Crocoblock onboarding and validation flows.';
		$action_hint = 'open_plugins';
	} elseif ( $wizard_installed && $has_license ) {
		$state = 'license_configured_locally';
		$message = 'A local Crocoblock license value is present. Official validation still runs through the Wizard.';
		$action_hint = $wizard_active ? 'open_wizard' : 'open_plugins';
	} elseif ( $wizard_installed ) {
		$state = 'license_not_configured';
		$message = 'No local Crocoblock license value was detected. Configure it through the official Wizard when needed.';
		$action_hint = $wizard_active ? 'open_wizard' : 'open_plugins';
	}

	return [
		'state'         => $state,
		'has_license'   => $has_license,
		'wizard_active' => $wizard_active,
		'message'       => $message,
		'action_hint'   => $action_hint,
	];
}
