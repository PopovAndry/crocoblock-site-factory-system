<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Latest_Command {

	public function __invoke(
		array $args = [],
		array $assoc_args = []
	): void {

		$latest = factory_get_latest_run_name();

		if ( ! $latest ) {
			WP_CLI::warning(
				'Latest run not found.'
			);

			return;
		}

		$run = new Factory_Run_Command();

		$run->__invoke(
			[ $latest ],
			$assoc_args
		);
	}
}