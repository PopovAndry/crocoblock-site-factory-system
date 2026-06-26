[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimePath,

    [Parameter(Mandatory = $true)]
    [string]$Spec,

    [ValidateSet('ReadOnly', 'ExactGenerate')]
    [string]$Mode = 'ReadOnly',

    [switch]$AllowMutation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-HostPath {
    param([string]$PathValue)

    $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
    return $resolved.Path
}

function Test-SharedPlayableRuntime {
    param([string]$PathValue)

    return [string]::Equals(
        ([System.IO.Path]::GetFullPath($PathValue)).TrimEnd('\'),
        'C:\sf-playable-beta',
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function ConvertTo-SmokeJson {
    param([object]$Value)

    return ($Value | ConvertTo-Json -Depth 32 -Compress)
}

function ConvertTo-Base64Utf8 {
    param([string]$Text)

    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Text))
}

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-ObjectPropertyValue {
    param(
        [object]$Object,
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) {
            return $Object[$Name]
        }

        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) {
        return $property.Value
    }

    return $null
}

function Test-IsObjectLike {
    param([object]$Value)

    if ($null -eq $Value) {
        return $false
    }

    if ($Value -is [string]) {
        return $false
    }

    if ($Value -is [System.Collections.IDictionary]) {
        return $true
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [System.Array])) {
        return $false
    }

    return @($Value.PSObject.Properties).Count -gt 0
}

function Assert-Subset {
    param(
        [object]$Actual,
        [object]$Expected,
        [string]$Path = 'root'
    )

    if ($Expected -is [System.Array]) {
        if (-not ($Actual -is [System.Array])) {
            throw "Expected array at $Path."
        }

        if (@($Actual).Count -lt @($Expected).Count) {
            throw "Array at $Path has fewer items than expected."
        }

        for ($index = 0; $index -lt @($Expected).Count; $index++) {
            Assert-Subset -Actual $Actual[$index] -Expected $Expected[$index] -Path "$Path[$index]"
        }

        return
    }

    if (Test-IsObjectLike -Value $Expected) {
        if (-not (Test-IsObjectLike -Value $Actual)) {
            throw "Expected object at $Path."
        }

        $expectedProperties = @()
        if ($Expected -is [System.Collections.IDictionary]) {
            $expectedProperties = $Expected.Keys
        } else {
            $expectedProperties = $Expected.PSObject.Properties.Name
        }

        foreach ($propertyName in $expectedProperties) {
            $expectedValue = Get-ObjectPropertyValue -Object $Expected -Name $propertyName
            $actualValue = Get-ObjectPropertyValue -Object $Actual -Name $propertyName

            if ($null -eq $actualValue -and $null -ne $expectedValue) {
                throw "Missing property $Path.$propertyName."
            }

            Assert-Subset -Actual $actualValue -Expected $expectedValue -Path "$Path.$propertyName"
        }

        return
    }

    if ($Actual -is [bool] -or $Expected -is [bool]) {
        if ([bool]$Actual -ne [bool]$Expected) {
            throw "Boolean mismatch at $Path. Expected $Expected but got $Actual."
        }

        return
    }

    if ([string]$Actual -ne [string]$Expected) {
        throw "Value mismatch at $Path. Expected '$Expected' but got '$Actual'."
    }
}

function Get-StageSummary {
    param([string]$StageName, [object]$Body)

    $summary = [ordered]@{
        stage = $StageName
        status = Get-ObjectPropertyValue -Object $Body -Name 'status'
        code = Get-ObjectPropertyValue -Object $Body -Name 'code'
    }

    switch ($StageName) {
        'site-plan' {
            $summary.vertical = Get-ObjectPropertyValue -Object $Body -Name 'vertical'
            $summary.recommended_preset = Get-ObjectPropertyValue -Object $Body -Name 'recommended_preset'
        }
        'blueprint-candidate' {
            $summary.vertical = Get-ObjectPropertyValue -Object $Body -Name 'vertical'
            $summary.recommended_preset = Get-ObjectPropertyValue -Object $Body -Name 'recommended_preset'
        }
        'preview-diff' {
            $preview = Get-ObjectPropertyValue -Object $Body -Name 'preview'
            $diffSummary = Get-ObjectPropertyValue -Object $Body -Name 'diff_summary'
            $summary.preview = Get-ObjectPropertyValue -Object $preview -Name 'summary'
            $summary.diff = $diffSummary
        }
        'generate-gate' {
            $summary.can_generate = Get-ObjectPropertyValue -Object $Body -Name 'can_generate'
            $summary.confirmation_required_phrase = Get-ObjectPropertyValue -Object $Body -Name 'confirmation_required_phrase'
        }
        'generate-preflight' {
            $summary.preflight_ready = Get-ObjectPropertyValue -Object $Body -Name 'preflight_ready'
            $summary.hero_variant = Get-ObjectPropertyValue -Object (Get-ObjectPropertyValue -Object $Body -Name 'dry_run_proof_preview') -Name 'hero_variant'
        }
        'generate-confirmation' {
            $summary.confirmation_ready = Get-ObjectPropertyValue -Object $Body -Name 'confirmation_ready'
            $summary.hero_variant = Get-ObjectPropertyValue -Object (Get-ObjectPropertyValue -Object $Body -Name 'runtime_diff_evidence') -Name 'hero_variant'
        }
        'controlled-generate' {
            $summary.generated = Get-ObjectPropertyValue -Object $Body -Name 'generated'
            $summary.mutation_status = Get-ObjectPropertyValue -Object $Body -Name 'mutation_status'
        }
    }

    return [pscustomobject]$summary
}

function New-SmokeHelperFile {
    param([string]$RuntimeRoot)

    $pluginRoot = Join-Path $RuntimeRoot 'wp-content\plugins\crocoblock-site-factory'
    if (-not (Test-Path -LiteralPath $pluginRoot)) {
        throw "Plugin root not found under runtime path: $pluginRoot"
    }

    $helperDirectory = Join-Path $pluginRoot '.codex-smoke'
    $helperPath = Join-Path $helperDirectory 'design-control-smoke.php'

    if (-not (Test-Path -LiteralPath $helperDirectory)) {
        New-Item -ItemType Directory -Path $helperDirectory | Out-Null
    }

    $php = @'
<?php
$action = getenv('FACTORY_SMOKE_ACTION') ?: '';

function factory_smoke_count_total($postType) {
    if (!function_exists('wp_count_posts')) {
        return 0;
    }

    $counts = wp_count_posts($postType);
    if (!is_object($counts)) {
        return 0;
    }

    return array_sum((array) $counts);
}

function factory_smoke_emit($payload) {
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
}

if ('counts' === $action) {
    factory_smoke_emit(array(
        'pages' => factory_smoke_count_total('page'),
        'properties' => factory_smoke_count_total('property'),
        'attachments' => factory_smoke_count_total('attachment'),
    ));
    return;
}

if ('home-url' === $action) {
    factory_smoke_emit(array(
        'home' => function_exists('home_url') ? home_url('/') : '',
    ));
    return;
}

if ('route' !== $action) {
    factory_smoke_emit(array(
        'http_status' => 500,
        'is_wp_error' => true,
        'error_code' => 'unknown_action',
        'errors' => array('Unknown smoke action.'),
    ));
    return;
}

$route = getenv('FACTORY_SMOKE_ROUTE') ?: '';
$payloadFile = getenv('FACTORY_SMOKE_PAYLOAD_FILE') ?: '';
$payloadJson = '';

if (is_string($payloadFile) && '' !== $payloadFile && file_exists($payloadFile)) {
    $payloadJson = (string) file_get_contents($payloadFile);
} else {
    $payloadJson = (string) base64_decode((string) (getenv('FACTORY_SMOKE_PAYLOAD_B64') ?: ''), true);
}

if ('' !== $payloadJson && 0 === strpos($payloadJson, "\xEF\xBB\xBF")) {
    $payloadJson = substr($payloadJson, 3);
}

$payload = '' !== $payloadJson ? json_decode($payloadJson, true) : null;

if ('' !== $payloadJson && JSON_ERROR_NONE !== json_last_error()) {
    factory_smoke_emit(array(
        'http_status' => 500,
        'is_wp_error' => true,
        'error_code' => 'payload_json_decode_failed',
        'errors' => array('Payload JSON decode failed: ' . json_last_error_msg()),
    ));
    return;
}

if (function_exists('get_users') && function_exists('wp_set_current_user')) {
    $admins = get_users(array(
        'role' => 'administrator',
        'number' => 1,
        'fields' => 'ID',
    ));

    if (is_array($admins) && !empty($admins[0])) {
        wp_set_current_user((int) $admins[0]);
    }
}

if (!is_array($payload)) {
    $payload = array();
}

$request = new WP_REST_Request('POST', $route);
$request->set_body_params($payload);
$result = rest_do_request($request);

if (is_wp_error($result)) {
    factory_smoke_emit(array(
        'http_status' => 500,
        'is_wp_error' => true,
        'error_code' => $result->get_error_code(),
        'errors' => $result->get_error_messages(),
    ));
    return;
}

$response = rest_ensure_response($result);
$server = rest_get_server();

factory_smoke_emit(array(
    'http_status' => $response->get_status(),
    'is_wp_error' => false,
    'body' => $server->response_to_data($response, false),
));
'@

    Write-Utf8NoBomFile -Path $helperPath -Content $php
    return $helperPath
}

function Remove-SmokeHelperFile {
    param([string]$HelperPath)

    if (Test-Path -LiteralPath $HelperPath) {
        Remove-Item -LiteralPath $HelperPath -Force
    }

    $directory = Split-Path -Parent $HelperPath
    if (Test-Path -LiteralPath $directory) {
        $items = @(Get-ChildItem -LiteralPath $directory -Force)
        if ($items.Count -eq 0) {
            Remove-Item -LiteralPath $directory -Force
        }
    }
}

function Invoke-WpCliHelper {
    param(
        [string]$RuntimeRoot,
        [string]$HelperPath,
        [hashtable]$EnvironmentValues
    )

    $command = @('compose', 'run', '--rm', '--user', 'root')

    foreach ($entry in $EnvironmentValues.GetEnumerator()) {
        $command += '-e'
        $command += ('{0}={1}' -f $entry.Key, $entry.Value)
    }

    $command += 'wpcli'
    $command += 'wp'
    $command += 'eval-file'
    $command += '/var/www/html/wp-content/plugins/crocoblock-site-factory/.codex-smoke/design-control-smoke.php'
    $command += '--allow-root'

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    $previousErrorActionPreference = $ErrorActionPreference

    Push-Location $RuntimeRoot
    try {
        $ErrorActionPreference = 'Continue'
        & docker @command 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
    $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }

    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

    if ($exitCode -ne 0) {
        throw "docker compose wp eval-file failed:`n$stdoutText`n$stderrText"
    }

    $rawOutputText = ($stdoutText + [Environment]::NewLine + $stderrText).Trim()
    $lines = @($rawOutputText -split "(`r`n|`n|`r)" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })

    if (@($lines).Count -eq 0) {
        throw 'Smoke helper returned no JSON output.'
    }

    foreach ($line in $lines) {
        if ($line -notmatch '^[\{\[]') {
            continue
        }

        try {
            return $line | ConvertFrom-Json
        } catch {
            continue
        }
    }

    throw "Smoke helper returned invalid JSON:`n$rawOutputText"
}

function Invoke-SmokeRoute {
    param(
        [string]$RuntimeRoot,
        [string]$HelperPath,
        [string]$Route,
        [hashtable]$Payload
    )

    $payloadJson = ConvertTo-SmokeJson -Value $Payload
    $helperDirectory = Split-Path -Parent $HelperPath
    $payloadPath = Join-Path $helperDirectory 'payload.json'
    Write-Utf8NoBomFile -Path $payloadPath -Content $payloadJson

    return Invoke-WpCliHelper -RuntimeRoot $RuntimeRoot -HelperPath $HelperPath -EnvironmentValues @{
        FACTORY_SMOKE_ACTION = 'route'
        FACTORY_SMOKE_ROUTE = $Route
        FACTORY_SMOKE_PAYLOAD_FILE = '/var/www/html/wp-content/plugins/crocoblock-site-factory/.codex-smoke/payload.json'
    }
}

function Invoke-SmokeCounts {
    param(
        [string]$RuntimeRoot,
        [string]$HelperPath
    )

    return Invoke-WpCliHelper -RuntimeRoot $RuntimeRoot -HelperPath $HelperPath -EnvironmentValues @{
        FACTORY_SMOKE_ACTION = 'counts'
    }
}

function Get-SmokeHomeUrl {
    param(
        [string]$RuntimeRoot,
        [string]$HelperPath
    )

    $result = Invoke-WpCliHelper -RuntimeRoot $RuntimeRoot -HelperPath $HelperPath -EnvironmentValues @{
        FACTORY_SMOKE_ACTION = 'home-url'
    }

    return [string](Get-ObjectPropertyValue -Object $result -Name 'home')
}

$runtimeRoot = Resolve-HostPath -PathValue $RuntimePath
$specPath = Resolve-HostPath -PathValue $Spec

if ('ExactGenerate' -eq $Mode) {
    if (-not $AllowMutation.IsPresent) {
        throw 'ExactGenerate mode requires -AllowMutation.'
    }

    if (Test-SharedPlayableRuntime -PathValue $runtimeRoot) {
        throw 'ExactGenerate mode is blocked for C:\sf-playable-beta. Use a disposable runtime only.'
    }
}

$specObject = Get-Content -LiteralPath $specPath -Raw | ConvertFrom-Json
$prompt = [string](Get-ObjectPropertyValue -Object $specObject -Name 'prompt')
$siteType = [string](Get-ObjectPropertyValue -Object $specObject -Name 'site_type')
$specName = [string](Get-ObjectPropertyValue -Object $specObject -Name 'name')
$assertions = Get-ObjectPropertyValue -Object $specObject -Name 'assertions'
$exactGenerate = Get-ObjectPropertyValue -Object $specObject -Name 'exact_generate'

if ([string]::IsNullOrWhiteSpace($prompt)) {
    throw 'Spec must include a prompt.'
}

if ([string]::IsNullOrWhiteSpace($siteType)) {
    $siteType = 'real_estate'
}

$stages = @(
    [pscustomobject]@{ Name = 'site-plan'; Route = '/factory/v1/ai/site-plan' },
    [pscustomobject]@{ Name = 'blueprint-candidate'; Route = '/factory/v1/ai/blueprint-candidate' },
    [pscustomobject]@{ Name = 'preview-diff'; Route = '/factory/v1/ai/preview-diff' },
    [pscustomobject]@{ Name = 'generate-gate'; Route = '/factory/v1/ai/generate-gate' },
    [pscustomobject]@{ Name = 'generate-preflight'; Route = '/factory/v1/ai/generate-preflight' },
    [pscustomobject]@{ Name = 'generate-confirmation'; Route = '/factory/v1/ai/generate-confirmation' }
)

$results = [ordered]@{}
$summaries = @()
$helperPath = $null

try {
    $helperPath = New-SmokeHelperFile -RuntimeRoot $runtimeRoot
    $countsBefore = Invoke-SmokeCounts -RuntimeRoot $runtimeRoot -HelperPath $helperPath

    foreach ($stage in $stages) {
        $payload = [ordered]@{
            prompt = $prompt
            site_type = $siteType
        }

        if ($results.Contains('site-plan')) {
            $payload.site_plan = $results['site-plan'].body
        }
        if ($results.Contains('blueprint-candidate')) {
            $payload.blueprint_candidate = $results['blueprint-candidate'].body
        }
        if ($results.Contains('preview-diff')) {
            $payload.preview_diff = $results['preview-diff'].body
        }
        if ($results.Contains('generate-gate')) {
            $payload.generate_gate = $results['generate-gate'].body
        }
        if ($results.Contains('generate-preflight')) {
            $payload.generate_preflight = $results['generate-preflight'].body
        }
        if ($results.Contains('generate-confirmation')) {
            $payload.generate_confirmation = $results['generate-confirmation'].body
        }

        $response = Invoke-SmokeRoute -RuntimeRoot $runtimeRoot -HelperPath $helperPath -Route $stage.Route -Payload $payload
        $results[$stage.Name] = $response

        if ([int](Get-ObjectPropertyValue -Object $response -Name 'http_status') -ne 200) {
            throw "$($stage.Name) returned unexpected HTTP status."
        }

        if ([bool](Get-ObjectPropertyValue -Object $response -Name 'is_wp_error')) {
            throw "$($stage.Name) returned WP_Error."
        }

        $body = Get-ObjectPropertyValue -Object $response -Name 'body'

        if ([bool](Get-ObjectPropertyValue -Object $body -Name 'provider_called')) {
            throw "$($stage.Name) unexpectedly called a provider."
        }

        if ([bool](Get-ObjectPropertyValue -Object $body -Name 'applies_changes')) {
            throw "$($stage.Name) unexpectedly reported applies_changes=true in read-only rail."
        }

        $stageAssertions = Get-ObjectPropertyValue -Object $assertions -Name $stage.Name
        if ($null -ne $stageAssertions) {
            Assert-Subset -Actual $body -Expected $stageAssertions -Path $stage.Name
        }

        $summaries += Get-StageSummary -StageName $stage.Name -Body $body
    }

    if ('ExactGenerate' -eq $Mode) {
        $confirmationPhrase = [string](Get-ObjectPropertyValue -Object $exactGenerate -Name 'confirmation_phrase')
        if ([string]::IsNullOrWhiteSpace($confirmationPhrase)) {
            throw 'Spec exact_generate.confirmation_phrase is required for ExactGenerate mode.'
        }

        $generatePayload = [ordered]@{
            prompt = $prompt
            site_type = $siteType
            site_plan = $results['site-plan'].body
            blueprint_candidate = $results['blueprint-candidate'].body
            preview_diff = $results['preview-diff'].body
            generate_gate = $results['generate-gate'].body
            generate_preflight = $results['generate-preflight'].body
            generate_confirmation = $results['generate-confirmation'].body
            confirmation_phrase = $confirmationPhrase
            execute = $true
        }

        $generateResponse = Invoke-SmokeRoute -RuntimeRoot $runtimeRoot -HelperPath $helperPath -Route '/factory/v1/ai/controlled-generate' -Payload $generatePayload
        $results['controlled-generate'] = $generateResponse
        $summaries += Get-StageSummary -StageName 'controlled-generate' -Body (Get-ObjectPropertyValue -Object $generateResponse -Name 'body')

        $controlledAssertions = Get-ObjectPropertyValue -Object $assertions -Name 'controlled-generate'
        if ($null -ne $controlledAssertions) {
            Assert-Subset -Actual (Get-ObjectPropertyValue -Object $generateResponse -Name 'body') -Expected $controlledAssertions -Path 'controlled-generate'
        }

        $homeUrl = Get-SmokeHomeUrl -RuntimeRoot $runtimeRoot -HelperPath $helperPath
        $frontendMarkers = @(Get-ObjectPropertyValue -Object $exactGenerate -Name 'frontend_markers')
        $frontendPath = [string](Get-ObjectPropertyValue -Object $exactGenerate -Name 'frontend_path')

        if (-not [string]::IsNullOrWhiteSpace($homeUrl) -and @($frontendMarkers).Count -gt 0) {
            $targetUrl = if ([string]::IsNullOrWhiteSpace($frontendPath)) { $homeUrl } else { ([System.Uri]::new([System.Uri]$homeUrl, $frontendPath)).AbsoluteUri }
            $response = Invoke-WebRequest -Uri $targetUrl -UseBasicParsing
            $content = [string]$response.Content

            foreach ($marker in $frontendMarkers) {
                if ($content -notmatch [regex]::Escape([string]$marker)) {
                    throw "Frontend marker '$marker' was not found at $targetUrl."
                }
            }
        }
    }

    $countsAfter = Invoke-SmokeCounts -RuntimeRoot $runtimeRoot -HelperPath $helperPath

    if ('ReadOnly' -eq $Mode) {
        if ((ConvertTo-SmokeJson -Value $countsBefore) -ne (ConvertTo-SmokeJson -Value $countsAfter)) {
            throw 'ReadOnly mode changed WordPress content counts.'
        }
    }

    [pscustomobject]@{
        name = $specName
        mode = $Mode
        runtime_path = $runtimeRoot
        counts_before = $countsBefore
        counts_after = $countsAfter
        stage_summaries = $summaries
    } | ConvertTo-Json -Depth 32
}
finally {
    if ($null -ne $helperPath) {
        Remove-SmokeHelperFile -HelperPath $helperPath
    }
}
