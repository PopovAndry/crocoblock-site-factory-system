<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatchApplier;

$root = dirname(__DIR__);

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

$blueprintPath = $root . '/examples/real-estate-blueprint.example.json';
$blueprintJson = file_get_contents($blueprintPath);
$baseBlueprint = is_string($blueprintJson) ? json_decode($blueprintJson, true) : null;

if (!is_array($baseBlueprint)) {
    fwrite(STDERR, 'Invalid blueprint example JSON.' . PHP_EOL);
    exit(1);
}

$fixtures = [
    'invalid/blueprint-patch.replace-missing-path.invalid.json',
    'invalid/blueprint-patch.add-to-non-array.invalid.json',
    'invalid/blueprint-patch.patch-root-document.invalid.json',
    'invalid/blueprint-patch.invalid-path.invalid.json',
    'invalid/blueprint-patch.mutates-protected-runtime.invalid.json',
];

$applier = new BlueprintPatchApplier();
$failed = false;

foreach ($fixtures as $fixture) {
    $patchPath = $root . '/examples/' . $fixture;
    $patchJson = file_get_contents($patchPath);
    $patch = is_string($patchJson) ? json_decode($patchJson, true) : null;

    if (!is_array($patch)) {
        fwrite(STDERR, "Invalid BlueprintPatch fixture JSON: {$fixture}" . PHP_EOL);
        $failed = true;
        continue;
    }

    $blueprint = $baseBlueprint;
    $beforeHash = blueprint_hash($blueprint);
    $result = $applier->apply($blueprint, $patch);
    $afterHash = blueprint_hash($blueprint);
    $status = $result->validation()->status();
    $immutable = $beforeHash === $afterHash;
    $expected = 'error';
    $ok = $status === $expected && $immutable;

    echo "{$fixture}: {$status} (expected {$expected}), original immutable: " . ($immutable ? 'yes' : 'no') . ($ok ? '' : ' [UNEXPECTED]') . PHP_EOL;

    foreach ($result->validation()->checks() as $check) {
        if ($check->status() !== 'error') {
            continue;
        }

        echo sprintf(
            "  [%s] %s: %s",
            $check->status(),
            $check->scope(),
            $check->message()
        ) . PHP_EOL;
    }

    if (!$ok) {
        $failed = true;
    }
}

exit($failed ? 1 : 0);

/**
 * @param array<string, mixed> $blueprint
 */
function blueprint_hash(array $blueprint): string
{
    $encoded = json_encode($blueprint);

    return is_string($encoded) ? hash('sha256', $encoded) : '';
}
