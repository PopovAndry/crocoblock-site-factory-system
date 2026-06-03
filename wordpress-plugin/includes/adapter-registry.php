<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Adapter_Registry {

	public function get_adapter_keys(): array {
		return [
			'plugins'  => Factory_Plugin_Adapter::class,
			'theme'    => Factory_Theme_Adapter::class,
			'taxonomy' => Factory_Taxonomy_Adapter::class,
			'core'     => Factory_WP_Core_Adapter::class,
			'meta'     => Factory_JetEngine_Adapter::class,
			'queries'  => Factory_JetEngine_Query_Builder_Adapter::class,
			'listings' => Factory_JetEngine_Listing_Adapter::class,
			'filters'  => Factory_JetSmartFilters_Adapter::class,
			'render'   => Factory_Render_Adapter::class,
			'single'   => Factory_Single_Adapter::class,
			'content'  => Factory_Content_Adapter::class,
		];
	}

	public function get_adapters(): array {
		return [
			new Factory_Plugin_Adapter(),
			new Factory_Theme_Adapter(),
			new Factory_Taxonomy_Adapter(),
			new Factory_WP_Core_Adapter(),
			new Factory_JetEngine_Adapter(),
			new Factory_JetEngine_Query_Builder_Adapter(),
			new Factory_JetEngine_Listing_Adapter(),
			new Factory_JetSmartFilters_Adapter(),
			new Factory_Render_Adapter(),
			new Factory_Single_Adapter(),
			new Factory_Content_Adapter(),
		];
	}

	public function get_dependencies(): array {
		return [
			Factory_Content_Adapter::class => [
				Factory_Taxonomy_Adapter::class,
				Factory_WP_Core_Adapter::class,
				Factory_Content_Adapter::class,
			],

			Factory_JetEngine_Adapter::class => [
				Factory_WP_Core_Adapter::class,
				Factory_JetEngine_Adapter::class,
			],

			Factory_JetEngine_Listing_Adapter::class => [
				Factory_WP_Core_Adapter::class,
				Factory_JetEngine_Adapter::class,
				Factory_JetEngine_Query_Builder_Adapter::class,
				Factory_JetEngine_Listing_Adapter::class,
			],

			Factory_JetEngine_Query_Builder_Adapter::class => [
				Factory_WP_Core_Adapter::class,
				Factory_JetEngine_Adapter::class,
				Factory_JetEngine_Query_Builder_Adapter::class,
			],

			Factory_JetSmartFilters_Adapter::class => [
				Factory_JetEngine_Query_Builder_Adapter::class,
				Factory_JetEngine_Listing_Adapter::class,
				Factory_JetSmartFilters_Adapter::class,
			],

			Factory_Render_Adapter::class => [
				Factory_JetSmartFilters_Adapter::class,
				Factory_JetEngine_Listing_Adapter::class,
				Factory_Render_Adapter::class,
			],

			Factory_Single_Adapter::class => [
				Factory_WP_Core_Adapter::class,
				Factory_Single_Adapter::class,
			],
		];
	}

	public function get_adapter_capabilities(): array {
		$capabilities = [];

		foreach ( $this->get_adapter_keys() as $key => $class ) {
			$capabilities[ $key ] = [
				'class'        => $class,
				'has_register' => $this->has_public_method( $class, 'register' ),
				'has_apply'    => $this->has_public_method( $class, 'apply' ),
				'has_validate' => $this->has_public_method( $class, 'validate' ),
				'has_plan'     => $this->has_public_method( $class, 'plan' ),
			];
		}

		return $capabilities;
	}

	public function get_contract_report(): array {
		$report = [];

		foreach ( $this->get_adapter_capabilities() as $key => $capabilities ) {
			$contract_ready = $capabilities['has_register']
				&& $capabilities['has_apply']
				&& $capabilities['has_validate']
				&& $capabilities['has_plan'];

			$report[] = [
				'key'            => $key,
				'class'          => $capabilities['class'],
				'has_register'   => $capabilities['has_register'],
				'has_apply'      => $capabilities['has_apply'],
				'has_validate'   => $capabilities['has_validate'],
				'has_plan'       => $capabilities['has_plan'],
				'contract_ready' => $contract_ready,
			];
		}

		return $report;
	}

	private function has_public_method( string $class, string $method ): bool {
		if ( ! method_exists( $class, $method ) ) {
			return false;
		}

		$reflection = new ReflectionMethod( $class, $method );

		return $reflection->isPublic();
	}
}
