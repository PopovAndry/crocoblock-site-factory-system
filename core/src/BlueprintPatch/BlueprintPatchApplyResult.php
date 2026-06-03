<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\BlueprintPatch;

use Crocoblock\SiteFactory\Core\Planning\Plan;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Result of applying a BlueprintPatch in memory.
 */
final class BlueprintPatchApplyResult
{
    /** @var array<string, mixed> */
    private array $candidateBlueprint;

    private Plan $plan;
    private ValidationResult $validation;

    /**
     * @param array<string, mixed> $candidateBlueprint
     */
    public function __construct(array $candidateBlueprint, Plan $plan, ValidationResult $validation)
    {
        $this->candidateBlueprint = $candidateBlueprint;
        $this->plan = $plan;
        $this->validation = $validation;
    }

    /**
     * @return array<string, mixed>
     */
    public function candidateBlueprint(): array
    {
        return $this->candidateBlueprint;
    }

    public function plan(): Plan
    {
        return $this->plan;
    }

    public function validation(): ValidationResult
    {
        return $this->validation;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'candidate_blueprint' => $this->candidateBlueprint,
            'plan' => $this->plan->toArray(),
            'validation' => $this->validation->toArray(),
        ];
    }
}
