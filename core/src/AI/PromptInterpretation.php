<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\AI;

/**
 * Interpreted user intent.
 *
 * This object records understanding and suggestions only. It does not mutate a
 * blueprint, call a provider, or apply anything to WordPress.
 */
final class PromptInterpretation
{
    private string $version;
    private string $detectedVertical;
    private string $recommendedPreset;

    /** @var array<string, mixed> */
    private array $suggestions;

    /** @var array<int, array<string, string>> */
    private array $unsupportedRequests;

    /** @var array<int, string> */
    private array $missingQuestions;

    private float $confidence;

    /**
     * @param array<string, mixed> $suggestions
     * @param array<int, array<string, string>> $unsupportedRequests
     * @param array<int, string> $missingQuestions
     */
    public function __construct(
        string $version,
        string $detectedVertical,
        string $recommendedPreset,
        array $suggestions = [],
        array $unsupportedRequests = [],
        array $missingQuestions = [],
        float $confidence = 0.0
    ) {
        $this->version = $version;
        $this->detectedVertical = $detectedVertical;
        $this->recommendedPreset = $recommendedPreset;
        $this->suggestions = $suggestions;
        $this->unsupportedRequests = $unsupportedRequests;
        $this->missingQuestions = $missingQuestions;
        $this->confidence = max(0.0, min(1.0, $confidence));
    }

    public function version(): string
    {
        return $this->version;
    }

    public function detectedVertical(): string
    {
        return $this->detectedVertical;
    }

    public function recommendedPreset(): string
    {
        return $this->recommendedPreset;
    }

    /**
     * @return array<string, mixed>
     */
    public function suggestions(): array
    {
        return $this->suggestions;
    }

    /**
     * @return array<int, array<string, string>>
     */
    public function unsupportedRequests(): array
    {
        return $this->unsupportedRequests;
    }

    /**
     * @return array<int, string>
     */
    public function missingQuestions(): array
    {
        return $this->missingQuestions;
    }

    public function confidence(): float
    {
        return $this->confidence;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'version' => $this->version,
            'mode' => 'interpretation_only',
            'applies_changes' => false,
            'detected_vertical' => $this->detectedVertical,
            'recommended_preset' => $this->recommendedPreset,
            'suggestions' => $this->suggestions,
            'unsupported_requests' => $this->unsupportedRequests,
            'missing_questions' => $this->missingQuestions,
            'confidence' => $this->confidence,
        ];
    }
}
