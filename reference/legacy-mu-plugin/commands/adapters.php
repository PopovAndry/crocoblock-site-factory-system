<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Adapters_Command {

	public function __invoke( array $args = [], array $assoc_args = [] ): void {
		$format = $assoc_args['format'] ?? 'table';

		$registry = new Factory_Adapter_Registry();
		$report   = $registry->get_contract_report();

		if ( 'json' === $format ) {
			WP_CLI::line(
				wp_json_encode(
					$report,
					JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
				)
			);

			return;
		}

		WP_CLI\Utils\format_items(
			'table',
			array_map(
				[ $this, 'format_table_row' ],
				$report
			),
			[
				'key',
				'class',
				'register',
				'apply',
				'validate',
				'plan',
				'ready',
			]
		);
	}

	private function format_table_row( array $row ): array {
		return [
			'key'      => $row['key'],
			'class'    => $row['class'],
			'register' => $this->format_bool( $row['has_register'] ),
			'apply'    => $this->format_bool( $row['has_apply'] ),
			'validate' => $this->format_bool( $row['has_validate'] ),
			'plan'     => $this->format_bool( $row['has_plan'] ),
			'ready'    => $this->format_bool( $row['contract_ready'] ),
		];
	}

	private function format_bool( bool $value ): string {
		return $value ? 'yes' : 'no';
	}
}
