<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Factory_Commands_Command {

	public function __invoke(): void {

		$commands = [

			[
				'command'     => 'ai',
				'description' => 'Generate blueprint via AI',
			],

			[
				'command'     => 'apply',
				'description' => 'Apply blueprint',
			],

			[
				'command'     => 'adapters',
				'description' => 'Audit adapter contract readiness',
			],

			[
				'command'     => 'validate',
				'description' => 'Validate current state',
			],

			[
				'command'     => 'doctor',
				'description' => 'Detect and repair drift',
			],

			[
				'command'     => 'health',
				'description' => 'Check runtime environment health',
			],

			[
				'command'     => 'summary',
				'description' => 'Show factory overview',
			],

			[
				'command'     => 'runs',
				'description' => 'Show run history',
			],

			[
				'command'     => 'latest',
				'description' => 'Show latest run',
			],

			[
				'command'     => 'run',
				'description' => 'Inspect specific run',
			],

			[
				'command'     => 'explain',
				'description' => 'Explain generated site',
			],

			[
				'command'     => 'fix',
				'description' => 'Repair broken state',
			],

			[
				'command'     => 'reset',
				'description' => 'Reset generated state',
			],
		];

		WP_CLI::log( '' );
		WP_CLI::log( 'Factory Commands' );
		WP_CLI::log( '' );

		WP_CLI\Utils\format_items(
			'table',
			$commands,
			[
				'command',
				'description',
			]
		);
	}
}
