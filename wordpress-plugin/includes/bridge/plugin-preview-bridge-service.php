<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Internal read-only composer for future Plugin Preview Bridge responses.
 *
 * This service mirrors Core contract arrays without importing Core classes. It
 * does not add REST/dashboard wiring and does not mutate WordPress runtime.
 */
class Factory_Plugin_Preview_Bridge_Service {

	private const MODE_READ_ONLY = 'read_only';
	private const SOURCE_PLUGIN_RUNTIME = 'plugin_runtime';
	private const STATUS_OK = 'ok';
	private const STATUS_WARNING = 'warning';
	private const STATUS_ERROR = 'error';
	private const STATUS_NOT_READY = 'not_ready';

	public function build_response(
		array $blueprint,
		array $core_preview = [],
		array $ownership_targets = []
	): array {
		$dry_run = $this->collect_dry_run_evidence( $blueprint );
		$ownership = $this->collect_ownership_evidence( $ownership_targets );
		$runtime_evidence = $this->build_runtime_evidence( $dry_run, $ownership );
		$apply_gate = $this->build_apply_gate( $runtime_evidence, $dry_run, $ownership );

		return [
			'version'          => 1,
			'mode'             => self::MODE_READ_ONLY,
			'status'           => $this->response_status( $apply_gate, $runtime_evidence ),
			'applied'          => false,
			'runtime_mutation' => false,
			'title'            => 'Plugin preview bridge response',
			'message'          => 'Read-only plugin preview bridge response generated. Nothing was applied.',
			'blueprint'        => [
				'summary' => $this->blueprint_summary( $blueprint ),
			],
			'core'             => [
				'preview' => $core_preview,
			],
			'plugin'           => [
				'dry_run' => $dry_run,
			],
			'ownership'        => $ownership,
			'runtime_evidence' => $runtime_evidence,
			'apply_gate'       => $apply_gate,
			'notices'          => [
				'Preview bridge service is read-only.',
				'Apply remains unavailable until a future confirmation/apply integration.',
			],
			'warnings'         => $this->response_warnings( $runtime_evidence, $apply_gate ),
			'errors'           => $this->response_errors( $runtime_evidence, $apply_gate ),
		];
	}

	private function collect_dry_run_evidence( array $blueprint ): array {
		try {
			if ( function_exists( 'factory_collect_plugin_dry_run_evidence' ) ) {
				return factory_collect_plugin_dry_run_evidence( $blueprint );
			}

			if ( class_exists( 'Factory_Plugin_Dry_Run_Evidence_Collector' ) ) {
				$collector = new Factory_Plugin_Dry_Run_Evidence_Collector();

				return $collector->collect( $blueprint );
			}

			return $this->dry_run_unavailable( 'Plugin dry-run evidence collector is unavailable.' );
		} catch ( Throwable $e ) {
			return $this->dry_run_unavailable( 'Plugin dry-run evidence collection failed: ' . $e->getMessage() );
		}
	}

	private function collect_ownership_evidence( array $targets ): array {
		try {
			if ( function_exists( 'factory_collect_ownership_evidence' ) ) {
				return factory_collect_ownership_evidence( $targets );
			}

			if ( class_exists( 'Factory_Ownership_Evidence_Collector' ) ) {
				$collector = new Factory_Ownership_Evidence_Collector();

				return $collector->collect( $targets );
			}

			return $this->ownership_unavailable( 'Ownership evidence collector is unavailable.' );
		} catch ( Throwable $e ) {
			return $this->ownership_unavailable( 'Ownership evidence collection failed: ' . $e->getMessage() );
		}
	}

	private function build_runtime_evidence( array $dry_run, array $ownership ): array {
		$dry_run_available = ! empty( $dry_run['available'] );
		$ownership_available = ! empty( $ownership['available'] );
		$blocking_errors = 0;
		$warnings = 0;

		foreach ( [ $dry_run, $ownership ] as $evidence ) {
			$status = $evidence['status'] ?? self::STATUS_WARNING;

			if ( self::STATUS_ERROR === $status ) {
				$blocking_errors++;
			} elseif ( self::STATUS_OK !== $status ) {
				$warnings++;
			}
		}

		$ownership_summary = is_array( $ownership['summary'] ?? null ) ? $ownership['summary'] : [];

		foreach ( [ 'conflict', 'locked', 'user_modified', 'warning' ] as $key ) {
			$warnings += (int) ( $ownership_summary[ $key ] ?? 0 );
		}

		$status = self::STATUS_OK;

		if ( $blocking_errors > 0 ) {
			$status = self::STATUS_ERROR;
		} elseif ( ! $dry_run_available || ! $ownership_available ) {
			$status = self::STATUS_NOT_READY;
		} elseif ( $warnings > 0 ) {
			$status = self::STATUS_WARNING;
		}

		return [
			'version'          => 1,
			'mode'             => self::MODE_READ_ONLY,
			'source'           => self::SOURCE_PLUGIN_RUNTIME,
			'status'           => $status,
			'complete'         => $dry_run_available && $ownership_available,
			'applied'          => false,
			'runtime_mutation' => false,
			'message'          => $this->runtime_message( $status ),
			'plugin_dry_run'   => $dry_run,
			'ownership'        => $ownership,
			'summary'          => [
				'dry_run_available'      => $dry_run_available,
				'ownership_available'    => $ownership_available,
				'runtime_checks_complete' => $dry_run_available && $ownership_available,
				'blocking_errors'        => $blocking_errors,
				'warnings'               => $warnings,
			],
		];
	}

	private function build_apply_gate( array $runtime_evidence, array $dry_run, array $ownership ): array {
		$status = $runtime_evidence['status'] ?? self::STATUS_NOT_READY;
		$blocking_reasons = [];
		$warnings = [];
		$gate_status = 'ready';
		$next_required_step = 'user_confirmation';

		if ( empty( $dry_run['available'] ) ) {
			$blocking_reasons[] = 'Plugin dry-run evidence is unavailable.';
			$gate_status = 'blocked';
			$next_required_step = 'plugin_dry_run';
		}

		if ( empty( $ownership['available'] ) ) {
			$blocking_reasons[] = 'Ownership evidence is unavailable.';
			$gate_status = 'blocked';
			$next_required_step = empty( $dry_run['available'] ) ? 'plugin_dry_run' : 'ownership_check';
		}

		if ( self::STATUS_ERROR === $status ) {
			$blocking_reasons[] = 'Runtime evidence contains blocking errors.';
			$gate_status = 'error';
			$next_required_step = 'resolve_conflicts';
		} elseif ( self::STATUS_WARNING === $status ) {
			$warnings[] = 'Runtime evidence contains warnings that require review.';
			$gate_status = 'warning';
			$next_required_step = 'user_confirmation';
		} elseif ( self::STATUS_NOT_READY === $status && 'blocked' !== $gate_status ) {
			$blocking_reasons[] = 'Runtime evidence is incomplete.';
			$gate_status = 'blocked';
			$next_required_step = 'plugin_dry_run';
		}

		$ownership_summary = is_array( $ownership['summary'] ?? null ) ? $ownership['summary'] : [];

		if ( (int) ( $ownership_summary['user_modified'] ?? 0 ) > 0 ) {
			$warnings[] = 'Ownership evidence contains user-modified items.';
		}

		if ( (int) ( $ownership_summary['locked'] ?? 0 ) > 0 ) {
			$warnings[] = 'Ownership evidence contains locked items.';
		}

		if ( (int) ( $ownership_summary['conflict'] ?? 0 ) > 0 ) {
			$warnings[] = 'Ownership evidence contains conflicts.';
		}

		return [
			'status'                     => $gate_status,
			'can_apply'                  => false,
			'requires_user_confirmation' => true,
			'blocking_reasons'           => array_values( array_unique( $blocking_reasons ) ),
			'warnings'                   => array_values( array_unique( $warnings ) ),
			'next_required_step'         => $next_required_step,
		];
	}

	private function response_status( array $apply_gate, array $runtime_evidence ): string {
		if ( 'error' === ( $apply_gate['status'] ?? '' ) || self::STATUS_ERROR === ( $runtime_evidence['status'] ?? '' ) ) {
			return self::STATUS_ERROR;
		}

		if ( 'ready' === ( $apply_gate['status'] ?? '' ) && self::STATUS_OK === ( $runtime_evidence['status'] ?? '' ) ) {
			return self::STATUS_OK;
		}

		return self::STATUS_WARNING;
	}

	private function runtime_message( string $status ): string {
		return match ( $status ) {
			self::STATUS_OK => 'Runtime evidence completed successfully.',
			self::STATUS_WARNING => 'Runtime evidence completed with warnings.',
			self::STATUS_ERROR => 'Runtime evidence contains blocking errors.',
			default => 'Runtime evidence is incomplete.',
		};
	}

	private function response_warnings( array $runtime_evidence, array $apply_gate ): array {
		$warnings = [];

		if ( self::STATUS_WARNING === ( $runtime_evidence['status'] ?? '' ) ) {
			$warnings[] = 'Runtime evidence requires review.';
		}

		foreach ( $apply_gate['warnings'] ?? [] as $warning ) {
			if ( is_scalar( $warning ) ) {
				$warnings[] = (string) $warning;
			}
		}

		return array_values( array_unique( $warnings ) );
	}

	private function response_errors( array $runtime_evidence, array $apply_gate ): array {
		$errors = [];

		if ( self::STATUS_ERROR === ( $runtime_evidence['status'] ?? '' ) ) {
			$errors[] = 'Runtime evidence contains errors.';
		}

		foreach ( $apply_gate['blocking_reasons'] ?? [] as $reason ) {
			if ( is_scalar( $reason ) ) {
				$errors[] = (string) $reason;
			}
		}

		return array_values( array_unique( $errors ) );
	}

	private function dry_run_unavailable( string $message ): array {
		return [
			'available'          => false,
			'status'             => self::STATUS_ERROR,
			'source'             => self::SOURCE_PLUGIN_RUNTIME,
			'message'            => $message,
			'summary'            => $this->empty_dry_run_summary(),
			'items'              => [],
			'requires_runtime'   => true,
			'next_required_step' => 'plugin_dry_run',
		];
	}

	private function ownership_unavailable( string $message ): array {
		return [
			'available'          => false,
			'status'             => self::STATUS_ERROR,
			'source'             => self::SOURCE_PLUGIN_RUNTIME,
			'message'            => $message,
			'requires_runtime'   => true,
			'next_required_step' => 'ownership_check',
			'summary'            => $this->empty_ownership_summary(),
			'items'              => [],
		];
	}

	private function empty_dry_run_summary(): array {
		return [
			'create'  => 0,
			'update'  => 0,
			'delete'  => 0,
			'skip'    => 0,
			'warning' => 0,
			'error'   => 1,
		];
	}

	private function empty_ownership_summary(): array {
		return [
			'checked'       => 0,
			'safe'          => 0,
			'user_modified' => 0,
			'locked'        => 0,
			'conflict'      => 0,
			'warning'       => 0,
			'error'         => 1,
		];
	}

	private function blueprint_summary( array $blueprint ): array {
		return [
			'version'       => $blueprint['version'] ?? null,
			'site_name'     => $this->string_value( $blueprint['site']['name'] ?? '' ),
			'content_count' => $this->count_grouped_items( $blueprint['content'] ?? [] ),
			'listing_count' => is_array( $blueprint['listings'] ?? null ) ? count( $blueprint['listings'] ) : 0,
			'query_count'   => is_array( $blueprint['queries'] ?? null ) ? count( $blueprint['queries'] ) : 0,
			'filter_count'  => is_array( $blueprint['filters'] ?? null ) ? count( $blueprint['filters'] ) : 0,
		];
	}

	private function count_grouped_items( $groups ): int {
		if ( ! is_array( $groups ) ) {
			return 0;
		}

		$count = 0;

		foreach ( $groups as $items ) {
			if ( is_array( $items ) ) {
				$count += count( $items );
			}
		}

		return $count;
	}

	private function string_value( $value ): string {
		if ( is_scalar( $value ) || null === $value ) {
			return (string) $value;
		}

		return '';
	}
}

function factory_build_plugin_preview_bridge_response(
	array $blueprint,
	array $core_preview = [],
	array $ownership_targets = []
): array {
	$service = new Factory_Plugin_Preview_Bridge_Service();

	return $service->build_response( $blueprint, $core_preview, $ownership_targets );
}
