<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function factory_ownership_normalize_state( $value ) {
	if ( is_object( $value ) ) {
		$value = (array) $value;
	}

	if ( ! is_array( $value ) ) {
		return is_scalar( $value ) || null === $value ? (string) $value : $value;
	}

	foreach ( $value as $key => $item ) {
		$value[ $key ] = factory_ownership_normalize_state( $item );
	}

	if ( ! empty( $value ) && array_keys( $value ) !== range( 0, count( $value ) - 1 ) ) {
		ksort( $value );
	}

	return $value;
}

function factory_ownership_hash_state( array $state ): string {
	$encoded = wp_json_encode( factory_ownership_normalize_state( $state ) );

	return is_string( $encoded ) ? hash( 'sha256', $encoded ) : '';
}

function factory_mark_post_managed( int $post_id, array $args ): void {
	update_post_meta( $post_id, '_factory_managed', '1' );
	update_post_meta( $post_id, '_factory_source', sanitize_key( $args['source'] ?? 'real-estate' ) );
	update_post_meta( $post_id, '_factory_entity_type', sanitize_key( $args['entity_type'] ?? '' ) );
	update_post_meta( $post_id, '_factory_lock', 'factory_managed' );
	delete_post_meta( $post_id, '_factory_user_modified' );

	if ( isset( $args['source_key'] ) && '' !== (string) $args['source_key'] ) {
		update_post_meta( $post_id, '_factory_source_key', sanitize_key( (string) $args['source_key'] ) );
	}

	if ( isset( $args['page_key'] ) && '' !== (string) $args['page_key'] ) {
		update_post_meta( $post_id, '_factory_page_key', sanitize_key( (string) $args['page_key'] ) );
	}

	if ( isset( $args['hash'] ) && '' !== (string) $args['hash'] ) {
		update_post_meta( $post_id, '_factory_last_generated_hash', (string) $args['hash'] );
	}
}

function factory_get_last_generated_hash( int $post_id ): string {
	return (string) get_post_meta( $post_id, '_factory_last_generated_hash', true );
}

function factory_is_post_user_modified( int $post_id, array $current_state, array $target_state ): bool {
	$last_hash    = factory_get_last_generated_hash( $post_id );
	$current_hash = factory_ownership_hash_state( $current_state );
	$target_hash  = factory_ownership_hash_state( $target_state );

	if ( '' === $last_hash ) {
		return $current_hash !== $target_hash;
	}

	return $current_hash !== $last_hash;
}

function factory_mark_post_user_modified( int $post_id ): void {
	update_post_meta( $post_id, '_factory_user_modified', '1' );
	update_post_meta( $post_id, '_factory_lock', 'user_modified' );
}

function factory_mark_term_managed( int $term_id, array $args ): void {
	update_term_meta( $term_id, '_factory_managed', '1' );
	update_term_meta( $term_id, '_factory_source', sanitize_key( $args['source'] ?? 'real-estate' ) );
	update_term_meta( $term_id, '_factory_entity_type', sanitize_key( $args['entity_type'] ?? '' ) );
	update_term_meta( $term_id, '_factory_lock', 'factory_managed' );
	delete_term_meta( $term_id, '_factory_user_modified' );

	if ( isset( $args['hash'] ) && '' !== (string) $args['hash'] ) {
		update_term_meta( $term_id, '_factory_last_generated_hash', (string) $args['hash'] );
	}
}

function factory_get_term_last_generated_hash( int $term_id ): string {
	return (string) get_term_meta( $term_id, '_factory_last_generated_hash', true );
}

function factory_is_term_user_modified( int $term_id, array $current_state, array $target_state ): bool {
	$last_hash    = factory_get_term_last_generated_hash( $term_id );
	$current_hash = factory_ownership_hash_state( $current_state );
	$target_hash  = factory_ownership_hash_state( $target_state );

	if ( '' === $last_hash ) {
		return $current_hash !== $target_hash;
	}

	return $current_hash !== $last_hash;
}

function factory_mark_term_user_modified( int $term_id ): void {
	update_term_meta( $term_id, '_factory_user_modified', '1' );
	update_term_meta( $term_id, '_factory_lock', 'user_modified' );
}
