<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Product\RealEstate;

/**
 * Real Estate product profile metadata and safe defaults.
 */
final class RealEstateProfile
{
    public const PRESET = 'real-estate';
    public const VERTICAL = 'real_estate';

    /** @var array<int, string> */
    private array $safePresetVariables;

    /** @var array<int, string> */
    private array $supportedStyleTones;

    /** @var array<int, string> */
    private array $supportedPrimaryPresets;

    public function __construct()
    {
        $this->safePresetVariables = [
            'agency_name',
            'hero_title',
            'hero_subtitle',
            'contact_title',
            'contact_intro',
        ];

        $this->supportedStyleTones = [
            'premium',
            'minimal',
            'modern',
            'corporate',
            'warm',
        ];

        $this->supportedPrimaryPresets = [
            'turquoise',
            'blue',
            'green',
            'beige',
        ];
    }

    public function preset(): string
    {
        return self::PRESET;
    }

    public function vertical(): string
    {
        return self::VERTICAL;
    }

    /**
     * @return array<int, string>
     */
    public function safePresetVariables(): array
    {
        return $this->safePresetVariables;
    }

    /**
     * @return array<int, string>
     */
    public function supportedStyleTones(): array
    {
        return $this->supportedStyleTones;
    }

    /**
     * @return array<int, string>
     */
    public function supportedPrimaryPresets(): array
    {
        return $this->supportedPrimaryPresets;
    }

    /**
     * @return array<string, mixed>
     */
    public function defaultImageContext(): array
    {
        return [
            'source' => 'demo_pool',
            'mode' => 'round_robin',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'preset' => $this->preset(),
            'vertical' => $this->vertical(),
            'safe_preset_variables' => $this->safePresetVariables,
            'supported_style_tones' => $this->supportedStyleTones,
            'supported_primary_presets' => $this->supportedPrimaryPresets,
            'default_image_context' => $this->defaultImageContext(),
        ];
    }
}
