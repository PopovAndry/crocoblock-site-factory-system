<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Read-only adapter from existing Factory plan items to the future Core
 * plugin_dry_run evidence envelope.
 *
 * This collector does not call apply, fix, reset, generate, manifests, REST, or
 * dashboard code. It only wraps the existing dry-run plan surface.
 */
class Factory_Plugin_Dry_Run_Evidence_Collector {

	private const SOURCE = 'plugin_runtime';
	private const NEXT_REQUIRED_STEP = 'ownership_check';

	private const ACTIONS = [
		'create',
		'update',
		'delete',
		'skip',
		'warning',
		'error',
	];

	public function collect( array $blueprint ): array {
		$dry_run = new Factory_Dry_Run_Command();
		$items   = $dry_run->get_plan_items( $blueprint );

		return $this->from_plan_items( $items );
	}

	public function from_plan_items( array $plan_items ): array {
		$items   = [];
		$summary = $this->empty_summary();

		foreach ( $plan_items as $item ) {
			if ( ! is_array( $item ) ) {
				$item = [
					'action'  => 'warning',
					'message' => 'Unsupported dry-run item shape.',
					'details' => [
						'raw_item' => $item,
					],
				];
			}

			$normalized = $this->normalize_item( $item );
			$action     = $normalized['action'];

			$summary[ $action ]++;
			$items[] = $normalized;
		}

		return [
			'available'          => true,
			'status'             => $this->status_from_summary( $summary ),
			'source'             => self::SOURCE,
			'message'            => 'Plugin dry-run completed.',
			'summary'            => $summary,
			'items'              => $items,
			'requires_runtime'   => true,
			'next_required_step' => self::NEXT_REQUIRED_STEP,
		];
	}

	private function normalize_item( array $item ): array {
		$action = $this->normalize_action( $item['action'] ?? '' );
		$details = [
			'adapter_class' => $this->string_value( $item['adapter_class'] ?? '' ),
			'plan_type'     => $this->string_value( $item['type'] ?? '' ),
			'diff'          => is_array( $item['diff'] ?? null ) ? $item['diff'] : [],
		];

		if ( 'warning' === $action && ! in_array( (string) ( $item['action'] ?? '' ), self::ACTIONS, true ) ) {
			$details['original_action'] = $this->string_value( $item['action'] ?? '' );
		}

		return [
			'action'  => $action,
			'adapter' => $this->string_value( $item['adapter'] ?? $item['type'] ?? '' ),
			'type'    => 'runtime_action',
			'entity'  => $this->string_value( $item['entity'] ?? '' ),
			'message' => $this->string_value( $item['message'] ?? '' ),
			'path'    => $this->string_value( $item['path'] ?? '' ),
			'details' => $details,
		];
	}

	private function normalize_action( $action ): string {
		$action = is_string( $action ) || is_numeric( $action )
			? sanitize_key( (string) $action )
			: '';

		return in_array( $action, self::ACTIONS, true ) ? $action : 'warning';
	}

	private function status_from_summary( array $summary ): string {
		if ( (int) ( $summary['error'] ?? 0 ) > 0 ) {
			return 'error';
		}

		if ( (int) ( $summary['warning'] ?? 0 ) > 0 ) {
			return 'warning';
		}

		return 'ok';
	}

	private function empty_summary(): array {
		return [
			'create'  => 0,
			'update'  => 0,
			'delete'  => 0,
			'skip'    => 0,
			'warning' => 0,
			'error'   => 0,
		];
	}

	private function string_value( $value ): string {
		if ( is_scalar( $value ) || null === $value ) {
			return (string) $value;
		}

		return '';
	}
}

function factory_collect_plugin_dry_run_evidence( array $blueprint ): array {
	$collector = new Factory_Plugin_Dry_Run_Evidence_Collector();

	return $collector->collect( $blueprint );
}
