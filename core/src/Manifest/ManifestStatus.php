<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Manifest;

use InvalidArgumentException;

/**
 * Shared status constants for system proof objects.
 */
final class ManifestStatus
{
    public const OK = 'ok';
    public const WARNING = 'warning';
    public const ERROR = 'error';

    private function __construct()
    {
    }

    public static function isKnown(string $status): bool
    {
        return in_array($status, self::all(), true);
    }

    public static function assertKnown(string $status): void
    {
        if (!self::isKnown($status)) {
            throw new InvalidArgumentException(sprintf('Unknown manifest status "%s".', $status));
        }
    }

    /**
     * @return array<int, string>
     */
    public static function all(): array
    {
        return [
            self::OK,
            self::WARNING,
            self::ERROR,
        ];
    }
}
