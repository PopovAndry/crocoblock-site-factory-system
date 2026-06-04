<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintNormalizer;
use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;

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
function load_candidate_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

/**
 * @param array<int, Crocoblock\SiteFactory\Core\Validation\ValidationCheck> $checks
 */
function has_error_check(array $checks): bool
{
    foreach ($checks as $check) {
        if (ManifestStatus::ERROR === $check->status()) {
            return true;
        }
    }

    return false;
}

$inputPath = $root . '/examples/blueprint-candidate.real-estate.input.json';
$expectedPath = $root . '/examples/blueprint-candidate.real-estate.expected.json';

$input = load_candidate_json_object($inputPath);
$expected = load_candidate_json_object($expectedPath);
$original = $input;

$normalizer = new BlueprintNormalizer();
$normalization = $normalizer->normalize($input);
$candidate = $normalization->blueprint();

$failed = false;

echo 'BlueprintCandidate read-only normalization/validation' . PHP_EOL;

if ($input !== $original) {
    fwrite(STDERR, 'Candidate normalizer mutated the original input array.' . PHP_EOL);
    $failed = true;
}

if ($candidate !== $expected) {
    fwrite(STDERR, 'Normalized candidate did not match expected fixture.' . PHP_EOL);
    fwrite(STDERR, json_encode($candidate, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

echo 'Normalization warnings: ' . count($normalization->warnings()) . PHP_EOL;

foreach ($normalization->warnings() as $warning) {
    echo '  - ' . $warning . PHP_EOL;
}

$validation = (new BlueprintValidator())->validate($candidate);

echo 'Validation status: ' . $validation->status() . PHP_EOL;

foreach ($validation->checks() as $check) {
    echo sprintf(
        '  [%s] %s: %s',
        $check->status(),
        $check->scope(),
        $check->message()
    ) . PHP_EOL;
}

if (has_error_check($validation->checks())) {
    $failed = true;
}

$invalidFixtures = [
    'invalid/blueprint-candidate.unsafe-code.invalid.json',
    'invalid/blueprint-candidate.bad-shape.invalid.json',
];

foreach ($invalidFixtures as $fixture) {
    $invalid = load_candidate_json_object($root . '/examples/' . $fixture);
    $invalidResult = $normalizer->normalize($invalid, ['strict' => true]);
    $hasError = has_error_check($invalidResult->checks());

    echo $fixture . ': ' . ($hasError ? 'error as expected' : 'missing expected error') . PHP_EOL;

    foreach ($invalidResult->checks() as $check) {
        echo sprintf(
            '  [%s] %s: %s',
            $check->status(),
            $check->scope(),
            $check->message()
        ) . PHP_EOL;
    }

    if (!$hasError) {
        $failed = true;
    }
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);
