<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\AI;

/**
 * Interprets user prompts into structured intent only.
 */
interface PromptInterpreterInterface
{
    /**
     * @param array<string, mixed> $context
     */
    public function interpret(string $prompt, array $context = []): PromptInterpretation;
}
