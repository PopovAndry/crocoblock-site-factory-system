"use strict";

function createEnvFile(project) {
  return [
    "# Alpha local runtime credentials. Do not use for production.",
    "PROJECT_SLUG=" + project.slug,
    "WP_PORT=" + String(project.wp_port),
    "DB_NAME=" + project.db_name,
    "DB_USER=" + project.db_user,
    "DB_PASSWORD=" + project.db_password,
    "DB_ROOT_PASSWORD=" + project.db_root_password,
    "WP_ADMIN_USER=" + project.admin_user,
    "WP_ADMIN_PASSWORD=" + project.admin_password,
    ""
  ].join("\n");
}

function createDockerCompose() {
  return [
    "services:",
    "  mysql:",
    "    image: mysql:8.0",
    "    restart: unless-stopped",
    "    environment:",
    "      MYSQL_DATABASE: ${DB_NAME}",
    "      MYSQL_USER: ${DB_USER}",
    "      MYSQL_PASSWORD: ${DB_PASSWORD}",
    "      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}",
    "    command: --default-authentication-plugin=mysql_native_password",
    "    volumes:",
    "      - ./mysql:/var/lib/mysql",
    "  wordpress:",
    "    image: wordpress:php8.2-apache",
    "    command: bash -lc \"sed -ri -e 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf && a2enmod rewrite >/dev/null 2>&1 && apache2-foreground\"",
    "    restart: unless-stopped",
    "    depends_on:",
    "      - mysql",
    "    ports:",
    "      - \"${WP_PORT}:80\"",
    "    environment:",
    "      WORDPRESS_DB_HOST: mysql:3306",
    "      WORDPRESS_DB_NAME: ${DB_NAME}",
    "      WORDPRESS_DB_USER: ${DB_USER}",
    "      WORDPRESS_DB_PASSWORD: ${DB_PASSWORD}",
    "    volumes:",
    "      - ./wordpress:/var/www/html",
    "  wpcli:",
    "    image: wordpress:cli-php8.2",
    "    depends_on:",
    "      - mysql",
    "    user: \"0:0\"",
    "    working_dir: /var/www/html",
    "    environment:",
    "      WORDPRESS_DB_HOST: mysql:3306",
    "      WORDPRESS_DB_NAME: ${DB_NAME}",
    "      WORDPRESS_DB_USER: ${DB_USER}",
    "      WORDPRESS_DB_PASSWORD: ${DB_PASSWORD}",
    "    volumes:",
    "      - ./wordpress:/var/www/html",
    ""
  ].join("\n");
}

module.exports = {
  createDockerCompose,
  createEnvFile
};
