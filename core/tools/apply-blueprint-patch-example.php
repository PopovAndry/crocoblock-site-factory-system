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
$patchPath = $root . '/examples/blueprint-patch.real-estate-safe.example.json';

$blueprintJson = file_get_contents($blueprintPath);
$patchJson = file_get_contents($patchPath);
$blueprint = is_string($blueprintJson) ? json_decode($blueprintJson, true) : null;
$patch = is_string($patchJson) ? json_decode($patchJson, true) : null;

if (!is_array($blueprint)) {
    fwrite(STDERR, 'Invalid blueprint example JSON.' . PHP_EOL);
    exit(1);
}

if (!is_array($patch)) {
    fwrite(STDERR, 'Invalid BlueprintPatch example JSON.' . PHP_EOL);
    exit(1);
}

$result = (new BlueprintPatchApplier())->apply($blueprint, $patch);
$candidate = $result->candidateBlueprint();
$plan = $result->plan();
$validation = $result->validation();

echo 'BlueprintPatch apply result: ' . $validation->status() . PHP_EOL;
echo 'Original site.name: ' . (string) ($blueprint['site']['name'] ?? '') . PHP_EOL;
echo 'Candidate site.name: ' . (string) ($candidate['site']['name'] ?? '') . PHP_EOL;
echo 'Plan summary: ' . json_encode($plan->summary()->toArray(), JSON_UNESCAPED_SLASHES) . PHP_EOL;

foreach ($plan->items() as $item) {
    echo sprintf(
        '  [%s] %s: %s',
        $item->action(),
        $item->entity(),
        $item->message()
    ) . PHP_EOL;
}

exit($validation->status() === 'error' ? 1 : 0);
