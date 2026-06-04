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
function load_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

$inputPath = $root . '/examples/blueprint-normalizer.real-estate.input.json';
$expectedPath = $root . '/examples/blueprint-normalizer.real-estate.expected.json';

$input = load_json_object($inputPath);
$expected = load_json_object($expectedPath);
$original = $input;

$normalizer = new BlueprintNormalizer();
$result = $normalizer->normalize($input);
$normalized = $result->blueprint();

$failed = false;

if ($input !== $original) {
    fwrite(STDERR, 'Normalizer mutated the original input array.' . PHP_EOL);
    $failed = true;
}

if ($normalized !== $expected) {
    fwrite(STDERR, 'Normalized blueprint did not match expected fixture.' . PHP_EOL);
    fwrite(STDERR, json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

$validation = (new BlueprintValidator())->validate($normalized);

echo 'Blueprint normalizer example' . PHP_EOL;
echo 'Warnings: ' . count($result->warnings()) . PHP_EOL;

foreach ($result->warnings() as $warning) {
    echo '  - ' . $warning . PHP_EOL;
}

echo 'Validation status: ' . $validation->status() . PHP_EOL;

foreach ($validation->checks() as $check) {
    echo sprintf(
        '  [%s] %s: %s',
        $check->status(),
        $check->scope(),
        $check->message()
    ) . PHP_EOL;
}

if (ManifestStatus::ERROR === $validation->status()) {
    $failed = true;
}

$invalidFixtures = [
    'invalid/blueprint-normalizer.unsafe-code.invalid.json',
    'invalid/blueprint-normalizer.bad-list-shape.invalid.json',
];

foreach ($invalidFixtures as $fixture) {
    $invalid = load_json_object($root . '/examples/' . $fixture);
    $invalidResult = $normalizer->normalize($invalid, ['strict' => true]);
    $hasError = false;

    foreach ($invalidResult->checks() as $check) {
        if (ManifestStatus::ERROR === $check->status()) {
            $hasError = true;
            break;
        }
    }

    echo $fixture . ': ' . ($hasError ? 'error as expected' : 'missing expected error') . PHP_EOL;

    if (!$hasError) {
        $failed = true;
    }
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);
