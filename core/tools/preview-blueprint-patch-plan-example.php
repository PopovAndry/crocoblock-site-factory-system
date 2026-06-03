<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatchApplier;
use Crocoblock\SiteFactory\Core\Planning\BlueprintPatchPlanBuilder;
use Crocoblock\SiteFactory\Core\Planning\PlanValidator;

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

$applyResult = (new BlueprintPatchApplier())->apply($blueprint, $patch);
$operations = is_array($patch['operations'] ?? null) ? $patch['operations'] : [];
$previewPlan = (new BlueprintPatchPlanBuilder())->buildFromApplyResult($blueprint, $operations, $applyResult);
$planValidation = (new PlanValidator())->validate($previewPlan->toArray());

echo 'BlueprintPatch preview plan: ' . $planValidation->status() . PHP_EOL;
echo 'Plan summary: ' . json_encode($previewPlan->summary()->toArray(), JSON_UNESCAPED_SLASHES) . PHP_EOL;

foreach ($previewPlan->items() as $item) {
    $diff = $item->diff();
    $label = is_string($diff['label'] ?? null) ? $diff['label'] : $item->entity();

    echo sprintf(
        '  [%s] %s: %s',
        $item->action(),
        $label,
        $item->message()
    ) . PHP_EOL;
}

exit($planValidation->status() === 'error' ? 1 : 0);
