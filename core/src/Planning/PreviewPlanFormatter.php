<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

/**
 * Formats Blueprint paths and values for human-facing preview plans.
 */
final class PreviewPlanFormatter
{
    /** @var array<string, string> */
    private array $labels = [
        '/site/name' => 'Site name',
        '/pages/home/title' => 'Home page title',
        '/pages/home/sections/0/title' => 'Home hero title',
        '/pages/home/sections/0/subtitle' => 'Home hero subtitle',
        '/pages/contact/title' => 'Contact page title',
        '/pages/contact/text' => 'Contact intro',
    ];

    public function labelForPath(string $path): string
    {
        if (isset($this->labels[$path])) {
            return $this->labels[$path];
        }

        $parts = array_filter(explode('/', trim($path, '/')), static function (string $part): bool {
            return '' !== $part && !ctype_digit($part);
        });

        if ($parts === []) {
            return 'Blueprint value';
        }

        return ucwords(str_replace(['_', '-'], ' ', (string) end($parts)));
    }

    /**
     * @param mixed $value
     */
    public function valueToText($value): string
    {
        if (is_string($value)) {
            return $value;
        }

        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if (null === $value) {
            return 'not set';
        }

        if (is_array($value)) {
            return 'structured value';
        }

        return 'value';
    }

    public function updateMessage(string $label, string $before, string $after): string
    {
        return sprintf('Update %s from "%s" to "%s".', lcfirst($label), $before, $after);
    }

    public function createMessage(string $label, string $after): string
    {
        return sprintf('Add %s "%s".', lcfirst($label), $after);
    }
}
