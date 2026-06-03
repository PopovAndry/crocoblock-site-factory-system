<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_diff_arrays( array $current, array $target ): array {
	$diff = [];

	foreach ( $target as $key => $value ) {
		if ( ! array_key_exists( $key, $current ) ) {
			$diff[ $key ] = [
				'type'  => 'create',
				'value' => $value,
			];

			continue;
		}

		if ( is_array( $value ) ) {
			$current_value = is_array( $current[ $key ] ) ? $current[ $key ] : [];

			$nested = factory_diff_arrays( $current_value, $value );

			if ( ! empty( $nested ) ) {
				$diff[ $key ] = [
					'type'  => 'update',
					'value' => $nested,
				];
			}

			continue;
		}

		if ( $current[ $key ] !== $value ) {
			$diff[ $key ] = [
				'type'  => 'update',
				'value' => $value,
			];
		}
	}

	return $diff;
}

function factory_merge_blueprints( array $base, array $override ): array {
    return array_replace_recursive( $base, $override );
}