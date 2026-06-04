<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintNormalizer;
use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
use Crocoblock\SiteFactory\Core\Bridge\CorePreviewResponseBuilder;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Planning\BlueprintCandidateReviewFormatter;
use Crocoblock\SiteFactory\Core\Planning\BlueprintCandidateReviewPlanBuilder;
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

/**
 * @return array<string, mixed>
 */
function load_core_preview_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

$baseline = load_core_preview_json_object($root . '/examples/real-estate-blueprint.example.json');
$candidateInput = load_core_preview_json_object($root . '/examples/blueprint-candidate.real-estate.input.json');
$expectedPath = $root . '/examples/core-preview-response.example.json';

$normalizer = new BlueprintNormalizer();
$normalization = $normalizer->normalize($candidateInput);
$candidate = $normalization->blueprint();
$validation = (new BlueprintValidator())->validate($candidate);
$reviewPlan = (new BlueprintCandidateReviewPlanBuilder())->build($baseline, $candidate);
$planValidation = (new PlanValidator())->validate($reviewPlan->toArray());
$formatted = (new BlueprintCandidateReviewFormatter())->format($reviewPlan);
$response = (new CorePreviewResponseBuilder())->build($normalization, $validation, $reviewPlan, $formatted);

$failed = false;

foreach ([$validation, $planValidation] as $result) {
    foreach ($result->checks() as $check) {
        if (ManifestStatus::ERROR === $check->status()) {
            $failed = true;
        }
    }
}

if (in_array('--write-fixture', $argv, true)) {
    file_put_contents($expectedPath, json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    echo 'Wrote expected Core preview response fixture.' . PHP_EOL;
    exit(0);
}

if (!is_file($expectedPath)) {
    fwrite(STDERR, 'Missing expected Core preview response fixture. Generated output:' . PHP_EOL);
    fwrite(STDERR, json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

$expected = load_core_preview_json_object($expectedPath);

if ($response !== $expected) {
    fwrite(STDERR, 'Core preview response did not match expected fixture. Generated output:' . PHP_EOL);
    fwrite(STDERR, json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

echo 'Core preview response' . PHP_EOL;
echo 'Response status: ' . $response['status'] . PHP_EOL;
echo 'Mode: ' . $response['mode'] . PHP_EOL;
echo 'Applied: ' . ($response['applied'] ? 'true' : 'false') . PHP_EOL;
echo 'Runtime mutation: ' . ($response['runtime_mutation'] ? 'true' : 'false') . PHP_EOL;
echo 'Core candidate valid: ' . ($response['core']['candidate_valid'] ? 'true' : 'false') . PHP_EOL;
echo 'Plugin dry-run status: ' . $response['plugin']['dry_run']['status'] . PHP_EOL;
echo 'Ownership status: ' . $response['ownership']['status'] . PHP_EOL;
echo 'Warnings: ' . count($response['warnings']) . PHP_EOL;
echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);
