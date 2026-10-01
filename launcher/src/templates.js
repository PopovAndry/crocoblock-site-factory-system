"use strict";

const PROJECT_NETWORK_ALLOCATION_SCHEMA = "factory_project_network_allocation";
const PROJECT_NETWORK_ALLOCATION_VERSION = 1;
const PROJECT_NETWORK_POOL = Object.freeze([
  "10.252.254.0/24",
  "10.252.255.0/24",
  "10.252.253.0/24"
]);

function normalizeProjectNetworkAllocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || value.schema !== PROJECT_NETWORK_ALLOCATION_SCHEMA
    || value.version !== PROJECT_NETWORK_ALLOCATION_VERSION
    || typeof value.subnet !== "string"
    || !PROJECT_NETWORK_POOL.includes(value.subnet)) {
    throw new Error("Project network allocation is invalid.");
  }
  return {
    schema: PROJECT_NETWORK_ALLOCATION_SCHEMA,
    version: PROJECT_NETWORK_ALLOCATION_VERSION,
    subnet: value.subnet
  };
}

function sameProjectNetworkAllocation(left, right) {
  const leftDeclared = left !== undefined;
  const rightDeclared = right !== undefined;
  if (leftDeclared !== rightDeclared) return false;
  if (!leftDeclared) return true;
  try {
    return JSON.stringify(normalizeProjectNetworkAllocation(left))
      === JSON.stringify(normalizeProjectNetworkAllocation(right));
  } catch (_) {
    return false;
  }
}

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

function createDockerCompose(project) {
  const allocation = project && Object.prototype.hasOwnProperty.call(project, "network_allocation")
    ? normalizeProjectNetworkAllocation(project.network_allocation)
    : null;
  const lines = [
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
    "      - ./runtime-binding-v1.json:/run/csf/project-binding.json:ro",
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
    "      - ./runtime-binding-v1.json:/run/csf/project-binding.json:ro"
  ];

  if (allocation) {
    lines.push(
      "networks:",
      "  default:",
      "    ipam:",
      "      config:",
      "        - subnet: " + allocation.subnet
    );
  }

  lines.push("");
  return lines.join("\n");
}

module.exports = {
  createDockerCompose,
  createEnvFile,
  PROJECT_NETWORK_ALLOCATION_SCHEMA,
  PROJECT_NETWORK_ALLOCATION_VERSION,
  PROJECT_NETWORK_POOL,
  normalizeProjectNetworkAllocation,
  sameProjectNetworkAllocation
};
