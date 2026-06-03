<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Manifest;

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintDocument;
use Crocoblock\SiteFactory\Core\Planning\Plan;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * System run proof/manifest.
 *
 * Storage belongs to a runtime layer. This object defines the portable proof
 * shape shared by Core, plugin runtime, provisioning, and future services.
 */
final class RunManifest
{
    private string $id;
    private string $timestamp;
    private string $status;
    private BlueprintDocument $blueprint;
    private Plan $plan;
    private ValidationResult $validation;

    /** @var array<string, mixed> */
    private array $context;

    /** @var array<string, mixed> */
    private array $execution;

    /**
     * @param array<string, mixed> $context
     * @param array<string, mixed> $execution
     */
    public function __construct(
        string $id,
        string $timestamp,
        string $status,
        BlueprintDocument $blueprint,
        Plan $plan,
        ValidationResult $validation,
        array $context = [],
        array $execution = []
    ) {
        ManifestStatus::assertKnown($status);

        $this->id = $id;
        $this->timestamp = $timestamp;
        $this->status = $status;
        $this->blueprint = $blueprint;
        $this->plan = $plan;
        $this->validation = $validation;
        $this->context = $context;
        $this->execution = $execution;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function timestamp(): string
    {
        return $this->timestamp;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function blueprint(): BlueprintDocument
    {
        return $this->blueprint;
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
    public function context(): array
    {
        return $this->context;
    }

    /**
     * @return array<string, mixed>
     */
    public function execution(): array
    {
        return $this->execution;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'timestamp' => $this->timestamp,
            'status' => $this->status,
            'blueprint' => $this->blueprint->toArray(),
            'plan' => $this->plan->toArray(),
            'validation' => $this->validation->toArray(),
            'context' => $this->context,
            'execution' => $this->execution,
        ];
    }
}
