<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatchValidator;
use Crocoblock\SiteFactory\Core\Manifest\RunManifestValidator;
use Crocoblock\SiteFactory\Core\Planning\PlanValidator;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;
use Crocoblock\SiteFactory\Core\Validation\ValidationResultValidator;

$root = dirname(__DIR__);
$systemRoot = dirname($root);

spl_autoload_register(
    static function (string $class): void {
        $prefix = 'Crocoblock\\SiteFactory\\Core\\';

        if (0 !== strpos($class, $prefix)) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        $path = dirname(__DIR__) . '/src/' . str_replace('\\', '/', $relative) . '.php';

        if (is_file($path)) {
            require_once $path;
        }
    }
);

$examples = [
    'blueprint-patch.example.json' => new BlueprintPatchValidator(),
    'plan.example.json' => new PlanValidator(),
    'validation-result.example.json' => new ValidationResultValidator(),
    'run-manifest.example.json' => new RunManifestValidator(),
    'real-estate-blueprint.example.json' => new BlueprintValidator(),
];

$failed = false;

foreach ($examples as $file => $validator) {
    $path = $root . '/examples/' . $file;

    if (!is_file($path)) {
        fwrite(STDERR, "Missing example: {$file}" . PHP_EOL);
        $failed = true;
        continue;
    }

    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        fwrite(STDERR, "Invalid JSON object: {$file}" . PHP_EOL);
        $failed = true;
        continue;
    }

    /** @var ValidationResult $result */
    $result = $validator->validate($data);
    $status = $result->status();

    echo "{$file}: {$status}" . PHP_EOL;

    foreach ($result->checks() as $check) {
        echo sprintf(
            "  [%s] %s: %s",
            $check->status(),
            $check->scope(),
            $check->message()
        ) . PHP_EOL;
    }

    if ('error' === $status) {
        $failed = true;
    }
}

exit($failed ? 1 : 0);
