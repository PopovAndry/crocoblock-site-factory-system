<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintNormalizer;
use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
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
function load_formatted_review_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

$baseline = load_formatted_review_json_object($root . '/examples/real-estate-blueprint.example.json');
$candidateInput = load_formatted_review_json_object($root . '/examples/blueprint-candidate.real-estate.input.json');
$expectedPath = $root . '/examples/blueprint-candidate-review-formatted.example.json';

$normalizer = new BlueprintNormalizer();
$candidate = $normalizer->normalize($candidateInput)->blueprint();
$candidateValidation = (new BlueprintValidator())->validate($candidate);
$failed = false;

foreach ($candidateValidation->checks() as $check) {
    if (ManifestStatus::ERROR === $check->status()) {
        $failed = true;
    }
}

$plan = (new BlueprintCandidateReviewPlanBuilder())->build($baseline, $candidate);
$planValidation = (new PlanValidator())->validate($plan->toArray());

foreach ($planValidation->checks() as $check) {
    if (ManifestStatus::ERROR === $check->status()) {
        $failed = true;
    }
}

$formatted = (new BlueprintCandidateReviewFormatter())->format($plan);

if (!is_file($expectedPath)) {
    fwrite(STDERR, 'Missing expected formatted review fixture. Generated output:' . PHP_EOL);
    fwrite(STDERR, json_encode($formatted, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

$expected = load_formatted_review_json_object($expectedPath);

if ($formatted !== $expected) {
    fwrite(STDERR, 'Formatted candidate review did not match expected fixture. Generated output:' . PHP_EOL);
    fwrite(STDERR, json_encode($formatted, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

echo 'BlueprintCandidate formatted review' . PHP_EOL;
echo 'Candidate validation status: ' . $candidateValidation->status() . PHP_EOL;
echo 'Plan validation status: ' . $planValidation->status() . PHP_EOL;
echo 'Formatted status: ' . $formatted['status'] . PHP_EOL;
echo 'Sections: ' . count($formatted['sections']) . PHP_EOL;

foreach ($formatted['sections'] as $section) {
    if (!is_array($section)) {
        continue;
    }

    echo sprintf(
        '  %s: %d item%s',
        (string) ($section['key'] ?? 'unknown'),
        is_array($section['items'] ?? null) ? count($section['items']) : 0,
        is_array($section['items'] ?? null) && 1 === count($section['items']) ? '' : 's'
    ) . PHP_EOL;
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);
