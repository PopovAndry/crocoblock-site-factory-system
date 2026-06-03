<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

/**
 * One planned operation in a preview plan.
 */
final class PlanItem
{
    public const ACTION_CREATE = 'create';
    public const ACTION_UPDATE = 'update';
    public const ACTION_DELETE = 'delete';
    public const ACTION_SKIP = 'skip';
    public const ACTION_WARNING = 'warning';
    public const ACTION_ERROR = 'error';

    private string $adapter;
    private string $action;
    private string $entity;
    private string $message;

    /** @var array<string, mixed> */
    private array $diff;

    /**
     * @param array<string, mixed> $diff
     */
    public function __construct(string $adapter, string $action, string $entity, string $message, array $diff = [])
    {
        $this->adapter = $adapter;
        $this->action = $action;
        $this->entity = $entity;
        $this->message = $message;
        $this->diff = $diff;
    }

    public function adapter(): string
    {
        return $this->adapter;
    }

    public function action(): string
    {
        return $this->action;
    }

    public function entity(): string
    {
        return $this->entity;
    }

    public function message(): string
    {
        return $this->message;
    }

    /**
     * @return array<string, mixed>
     */
    public function diff(): array
    {
        return $this->diff;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'adapter' => $this->adapter,
            'action' => $this->action,
            'entity' => $this->entity,
            'message' => $this->message,
            'diff' => $this->diff,
        ];
    }
}
