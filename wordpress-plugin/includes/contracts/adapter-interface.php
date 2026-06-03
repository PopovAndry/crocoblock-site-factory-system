<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Future adapter contract.
 *
 * This interface documents the adapter surface used by the factory runtime.
 * Existing adapters are not forced to implement it yet because some adapters
 * do not currently provide every optional capability, such as plan().
 */
interface Factory_Adapter_Interface {

	public function register( array $blueprint ): void;

	public function apply( array $blueprint ): void;

	public function validate( array $blueprint ): array;

	public function plan( array $blueprint ): array;
}
