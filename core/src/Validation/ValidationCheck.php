<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Validation;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;

/**
 * One validation check in a validation result.
 */
final class ValidationCheck
{
    private string $status;
    private string $scope;
    private string $message;

    /** @var array<string, mixed> */
    private array $context;

    /**
     * @param array<string, mixed> $context
     */
    public function __construct(string $status, string $scope, string $message, array $context = [])
    {
        ManifestStatus::assertKnown($status);

        $this->status = $status;
        $this->scope = $scope;
        $this->message = $message;
        $this->context = $context;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function scope(): string
    {
        return $this->scope;
    }

    public function message(): string
    {
        return $this->message;
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
    public function toArray(): array
    {
        return [
            'status' => $this->status,
            'scope' => $this->scope,
            'message' => $this->message,
            'context' => $this->context,
        ];
    }
}
