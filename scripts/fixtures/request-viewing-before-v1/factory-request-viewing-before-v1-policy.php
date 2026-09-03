<?php
/**
 * Plugin Name: Factory Request Viewing Before-State Policy
 * Description: Disposable fixture policy for the accepted Request Viewing invariants.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FACTORY_REQUEST_VIEWING_BEFORE_V1_POLICY_VERSION = '1.0.0';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_BINDING_OPTION = 'factory_request_viewing_before_v1_binding';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_OWNER_META     = '_factory_request_viewing_before_v1_owner';
const FACTORY_REQUEST_VIEWING_BEFORE_V1_OWNER_VALUE    = 'request_viewing_before_v1';

function factory_request_viewing_before_v1_binding(): array {
	$binding = get_option( FACTORY_REQUEST_VIEWING_BEFORE_V1_BINDING_OPTION, [] );
	$required = [ 'form_id', 'form_sha256', 'email_field', 'phone_field', 'property_field', 'guard_field', 'guard_value' ];

	if ( ! is_array( $binding ) || array_diff( $required, array_keys( $binding ) ) ) {
		return [];
	}
	$actual_keys   = array_keys( $binding );
	$expected_keys = $required;
	sort( $actual_keys, SORT_STRING );
	sort( $expected_keys, SORT_STRING );
	if ( $actual_keys !== $expected_keys ) {
		return [];
	}
	if ( ! is_int( $binding['form_id'] ) || $binding['form_id'] <= 0
		|| ! is_string( $binding['form_sha256'] ) || ! preg_match( '/^[a-f0-9]{64}$/', $binding['form_sha256'] )
		|| 'email' !== $binding['email_field'] || 'phone' !== $binding['phone_field']
		|| 'property_id' !== $binding['property_field'] || '_factory_policy_guard' !== $binding['guard_field']
		|| ! is_string( $binding['guard_value'] ) || '' === $binding['guard_value'] ) {
		return [];
	}

	return $binding;
}

function factory_request_viewing_before_v1_current_form_id(): int {
	if ( ! function_exists( 'jet_fb_handler' ) ) {
		return 0;
	}
	try {
		return absint( jet_fb_handler()->get_form_id() );
	} catch ( Throwable $error ) {
		return 0;
	}
}

function factory_request_viewing_before_v1_binding_state(): string {
	$binding = factory_request_viewing_before_v1_binding();
	$current_form_id = factory_request_viewing_before_v1_current_form_id();

	if ( ! $binding || $current_form_id !== ( $binding['form_id'] ?? 0 ) ) {
		return 'target_invalid';
	}
	$form = get_post( $current_form_id );
	if ( ! $form || 'jet-form-builder' !== $form->post_type
		|| FACTORY_REQUEST_VIEWING_BEFORE_V1_OWNER_VALUE !== get_post_meta( $current_form_id, FACTORY_REQUEST_VIEWING_BEFORE_V1_OWNER_META, true )
		|| ! hash_equals( $binding['form_sha256'], hash( 'sha256', (string) $form->post_content ) ) ) {
		return 'target_invalid';
	}

	return 'target_valid';
}

function factory_request_viewing_before_v1_context_value( $context, string $field ) {
	if ( ! is_object( $context ) || ! method_exists( $context, 'get_value' ) ) {
		return null;
	}
	try {
		if ( method_exists( $context, 'resolve_to_up' ) ) {
			$parser = $context->resolve_to_up( $field );
			if ( is_object( $parser ) && method_exists( $parser, 'update_request' ) ) {
				$parser->update_request();
			}
		}
		return $context->get_value( $field );
	} catch ( Throwable $error ) {
		return null;
	}
}

function factory_request_viewing_before_v1_is_nonempty_scalar( $value ): bool {
	return is_string( $value ) && '' !== trim( $value );
}

function factory_request_viewing_before_v1_is_bound_guard( $guard, array $binding ): bool {
	return is_string( $guard ) && hash_equals( $binding['guard_value'], $guard );
}

function factory_request_viewing_before_v1_validate_contacts( $guard, $context ): bool {
	$state = factory_request_viewing_before_v1_binding_state();
	if ( 'target_valid' !== $state ) {
		return false;
	}
	$binding = factory_request_viewing_before_v1_binding();
	if ( ! factory_request_viewing_before_v1_is_bound_guard( $guard, $binding ) ) {
		return false;
	}

	$email = factory_request_viewing_before_v1_context_value( $context, $binding['email_field'] );
	$phone = factory_request_viewing_before_v1_context_value( $context, $binding['phone_field'] );

	return factory_request_viewing_before_v1_is_nonempty_scalar( $email )
		|| factory_request_viewing_before_v1_is_nonempty_scalar( $phone );
}

function factory_request_viewing_before_v1_validate_property( $guard, $context ): bool {
	$state = factory_request_viewing_before_v1_binding_state();
	if ( 'target_valid' !== $state ) {
		return false;
	}
	$binding = factory_request_viewing_before_v1_binding();
	if ( ! factory_request_viewing_before_v1_is_bound_guard( $guard, $binding ) ) {
		return false;
	}

	$property_id = factory_request_viewing_before_v1_context_value( $context, $binding['property_field'] );
	if ( ! is_string( $property_id ) || ! preg_match( '/^[1-9][0-9]*$/', $property_id ) ) {
		return false;
	}
	$property = get_post( (int) $property_id );

	return $property && 'property' === $property->post_type && 'publish' === $property->post_status;
}
