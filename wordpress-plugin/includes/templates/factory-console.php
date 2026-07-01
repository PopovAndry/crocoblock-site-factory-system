<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$mode = isset( $factory_console_mode ) ? (string) $factory_console_mode : 'forbidden';
$context = isset( $factory_console_context ) && is_array( $factory_console_context ) ? $factory_console_context : [];
$title = 'app' === $mode ? 'Factory Console' : 'Factory Console Access';
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex,nofollow">
	<title><?php echo esc_html( $title ); ?></title>
	<?php wp_head(); ?>
</head>
<body class="factory-console-page factory-console-page-<?php echo esc_attr( $mode ); ?>">
<?php if ( 'app' === $mode ) : ?>
	<div id="factory-console-root" class="factory-console-root">
		<div class="factory-console-loading">Loading Factory Console...</div>
	</div>
<?php else : ?>
	<main class="factory-console-static">
		<section class="factory-console-static__panel">
			<div class="factory-console-static__eyebrow">Independent Factory Console</div>
			<h1><?php echo esc_html( 'forbidden' === $mode ? 'Administrator access required' : 'Sign in required' ); ?></h1>
			<p>
				<?php
				echo esc_html(
					'forbidden' === $mode
						? 'This console is reserved for administrators with Site Factory access.'
						: 'Sign in with an administrator account to open the Factory Console.'
				);
				?>
			</p>
			<div class="factory-console-static__actions">
				<?php if ( 'forbidden' === $mode ) : ?>
					<a class="factory-console-static__button factory-console-static__button-secondary" href="<?php echo esc_url( $context['home_url'] ?? home_url( '/' ) ); ?>">Back to site</a>
					<a class="factory-console-static__button" href="<?php echo esc_url( $context['dashboard_url'] ?? admin_url() ); ?>">Open diagnostics</a>
				<?php else : ?>
					<a class="factory-console-static__button" href="<?php echo esc_url( $context['login_url'] ?? wp_login_url() ); ?>">Sign in</a>
				<?php endif; ?>
			</div>
		</section>
	</main>
<?php endif; ?>
<?php wp_footer(); ?>
</body>
</html>
