<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintNormalizer;
use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
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
function load_review_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

$baselinePath = $root . '/examples/real-estate-blueprint.example.json';
$candidatePath = $root . '/examples/blueprint-candidate.real-estate.input.json';
$expectedPath = $root . '/examples/blueprint-candidate-review-plan.example.json';

$baseline = load_review_json_object($baselinePath);
$candidateInput = load_review_json_object($candidatePath);

$normalizer = new BlueprintNormalizer();
$normalization = $normalizer->normalize($candidateInput);
$candidate = $normalization->blueprint();

$candidateValidation = (new BlueprintValidator())->validate($candidate);
$failed = false;

echo 'BlueprintCandidate review plan' . PHP_EOL;
echo 'Candidate validation status: ' . $candidateValidation->status() . PHP_EOL;

foreach ($candidateValidation->checks() as $check) {
    echo sprintf(
        '  [%s] %s: %s',
        $check->status(),
        $check->scope(),
        $check->message()
    ) . PHP_EOL;

    if (ManifestStatus::ERROR === $check->status()) {
        $failed = true;
    }
}

$plan = (new BlueprintCandidateReviewPlanBuilder())->build($baseline, $candidate);
$planArray = $plan->toArray();
$planValidation = (new PlanValidator())->validate($planArray);

echo 'Plan validation status: ' . $planValidation->status() . PHP_EOL;

foreach ($planValidation->checks() as $check) {
    echo sprintf(
        '  [%s] %s: %s',
        $check->status(),
        $check->scope(),
        $check->message()
    ) . PHP_EOL;

    if (ManifestStatus::ERROR === $check->status()) {
        $failed = true;
    }
}

if (!is_file($expectedPath)) {
    fwrite(STDERR, 'Missing expected review plan fixture. Generated plan:' . PHP_EOL);
    fwrite(STDERR, json_encode($planArray, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

$expected = load_review_json_object($expectedPath);

if ($planArray !== $expected) {
    fwrite(STDERR, 'Candidate review plan did not match expected fixture. Generated plan:' . PHP_EOL);
    fwrite(STDERR, json_encode($planArray, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

echo 'Plan summary: ' . json_encode($plan->summary()->toArray(), JSON_UNESCAPED_SLASHES) . PHP_EOL;

foreach ($plan->items() as $item) {
    echo sprintf(
        '  [%s] %s: %s',
        $item->action(),
        $item->entity(),
        $item->message()
    ) . PHP_EOL;
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);
