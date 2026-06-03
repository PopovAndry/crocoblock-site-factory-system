<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\AI;

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintDocument;
use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatch;

/**
 * Generates safe blueprint patch proposals.
 *
 * Implementations must not apply patches or mutate WordPress directly.
 */
interface BlueprintPatchGeneratorInterface
{
    /**
     * @param array<string, mixed> $context
     */
    public function proposePatch(
        BlueprintDocument $currentBlueprint,
        PromptInterpretation $interpretation,
        array $context = []
    ): BlueprintPatch;
}
