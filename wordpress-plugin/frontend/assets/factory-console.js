( function () {
	'use strict';

	const config = window.FactoryConsoleConfig || {};
	const root = document.getElementById( 'factory-console-root' );
	const defaultModels = [
		{ key: 'fast', label: 'Fast' },
		{ key: 'balanced', label: 'Balanced' },
		{ key: 'reasoning', label: 'Reasoning' },
	];
	const readOnlyStages = [
		{ key: 'sitePlan', label: 'Site Plan' },
		{ key: 'blueprintCandidate', label: 'Blueprint Candidate' },
		{ key: 'previewDiff', label: 'Preview/Diff' },
		{ key: 'generateGate', label: 'Generate Gate' },
		{ key: 'generatePreflight', label: 'Preflight' },
		{ key: 'generateConfirmation', label: 'Confirmation' },
	];
	const operationOptions = [
		{ value: 'planning', label: 'Planning' },
		{ value: 'design_copy', label: 'Design / Copy' },
		{ value: 'blueprint_diff', label: 'Blueprint / Diff' },
		{ value: 'generate_apply_critical', label: 'Generate / Apply Critical' },
		{ value: 'review_debug', label: 'Review / Debug' },
	];
	const defaultPrompt = 'Create a Kyiv real estate agency website with a homepage, property catalog, contact page, validation proof, deterministic style tokens, and guided safe editing.';
	const aiSettingsSeed = config.aiSettings || {};
	const models = Array.isArray( aiSettingsSeed.available_models ) && aiSettingsSeed.available_models.length
		? aiSettingsSeed.available_models
		: defaultModels;
	let estimateDebounce = 0;
	let estimateRequestId = 0;
	let latestEstimateRequestId = 0;
	let planRunId = 0;
	const state = {
		prompt: defaultPrompt,
		siteType: 'real_estate',
		operationType: 'planning',
		selectedModel: aiSettingsSeed.selected_model || 'balanced',
		settings: aiSettingsSeed,
		estimate: null,
		estimating: false,
		recommendation: null,
		isPlanning: false,
		currentStage: '',
		error: '',
		notice: '',
		flow: {
			sitePlan: null,
			blueprintCandidate: null,
			previewDiff: null,
			generateGate: null,
			generatePreflight: null,
			generateConfirmation: null,
		},
	};

	if ( ! root || ! config.restNonce || ! config.endpoints ) {
		return;
	}

	function endpoint( path ) {
		if ( /^https?:\/\//i.test( path ) ) {
			return path;
		}

		return String( config.restBase || '' ).replace( /\/$/, '' ) + path;
	}

	function request( path, options ) {
		options = options || {};
		const headers = Object.assign(
			{
				'X-WP-Nonce': config.restNonce,
			},
			options.headers || {}
		);

		if ( options.body ) {
			headers['Content-Type'] = 'application/json';
		}

		return window.fetch(
			endpoint( path ),
			{
				credentials: 'same-origin',
				method: options.method || 'GET',
				headers: headers,
				body: options.body ? JSON.stringify( options.body ) : undefined,
			}
		).then( function ( response ) {
			return response.json().catch( function () {
				return null;
			} ).then( function ( data ) {
				if ( ! response.ok ) {
					const message = data && data.message ? data.message : 'Request failed: ' + response.status;
					const error = new Error( message );
					error.status = response.status;
					error.data = data;
					throw error;
				}

				return data;
			} );
		} );
	}

	function escapeHtml( value ) {
		return String( value ?? '' )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#039;' );
	}

	function badge( label, tone ) {
		return '<span class="factory-console-badge factory-console-badge-' + escapeHtml( tone || 'neutral' ) + '">' + escapeHtml( label ) + '</span>';
	}

	function statusTone( value ) {
		if ( value === 'ok' || value === 'ready' ) {
			return 'ok';
		}

		if ( value === 'warning' || value === 'blocked' ) {
			return 'warning';
		}

		if ( value === 'error' ) {
			return 'error';
		}

		return 'neutral';
	}

	function modelLabel( key ) {
		const match = models.find( function ( model ) {
			return model.key === key;
		} );

		return match ? ( match.label || match.key ) : key;
	}

	function operationLabel( value ) {
		const match = operationOptions.find( function ( item ) {
			return item.value === value;
		} );

		return match ? match.label : value;
	}

	function promptLength() {
		return String( state.prompt || '' ).trim().length;
	}

	function recommendModel() {
		const prompt = String( state.prompt || '' ).trim();
		const length = prompt.length;
		const operation = state.operationType;
		let recommended = 'balanced';
		let reason = 'Balanced is recommended for multi-stage planning and preview review.';
		let riskLevel = 'medium';

		if ( operation === 'generate_apply_critical' || operation === 'review_debug' || length > 1800 ) {
			recommended = 'reasoning';
			reason = operation === 'generate_apply_critical'
				? 'Reasoning is recommended because this task is apply-critical and needs conservative planning.'
				: 'Reasoning is recommended because this prompt is long or review-heavy.';
			riskLevel = 'high';
		} else if ( length > 0 && length < 500 && operation === 'design_copy' ) {
			recommended = 'fast';
			reason = 'Fast is sufficient for short copy and design direction review.';
			riskLevel = 'low';
		} else if ( length > 0 && length < 500 && operation === 'planning' ) {
			recommended = 'fast';
			reason = 'Fast is suitable for short planning prompts with limited ambiguity.';
			riskLevel = 'low';
		} else if ( operation === 'blueprint_diff' ) {
			recommended = 'balanced';
			reason = 'Balanced is recommended for blueprint candidate and diff review.';
			riskLevel = 'medium';
		}

		state.recommendation = {
			recommended_model: recommended,
			reason: reason,
			risk_level: riskLevel,
			uncertainty_label: 'Local heuristic only',
		};
	}

	function scheduleEstimate() {
		window.clearTimeout( estimateDebounce );
		estimateDebounce = window.setTimeout( function () {
			refreshEstimate();
		}, 280 );
	}

	function refreshEstimate() {
		const prompt = String( state.prompt || '' ).trim();

		if ( ! prompt ) {
			state.estimate = null;
			state.estimating = false;
			render();
			return;
		}

		state.estimating = true;
		estimateRequestId += 1;
		latestEstimateRequestId = estimateRequestId;
		render();

		request(
			config.endpoints.aiEstimate,
			{
				method: 'POST',
				body: {
					text: prompt,
					selected_model: state.selectedModel,
				},
			}
		).then( function ( data ) {
			if ( latestEstimateRequestId !== estimateRequestId ) {
				return;
			}

			state.estimate = data;
		} ).catch( function () {
			if ( latestEstimateRequestId !== estimateRequestId ) {
				return;
			}

			state.estimate = null;
		} ).finally( function () {
			if ( latestEstimateRequestId !== estimateRequestId ) {
				return;
			}

			state.estimating = false;
			render();
		} );
	}

	function summaryValue( object, key ) {
		if ( ! object || typeof object !== 'object' ) {
			return '-';
		}

		return object[ key ] ?? '-';
	}

	function stageReportedMutation( data ) {
		return true === data?.applies_changes || 'true' === data?.applies_changes;
	}

	function primaryResponse() {
		return state.flow.generateConfirmation
			|| state.flow.generatePreflight
			|| state.flow.generateGate
			|| state.flow.previewDiff
			|| state.flow.blueprintCandidate
			|| state.flow.sitePlan
			|| null;
	}

	function stageResponse( key ) {
		return state.flow[ key ] || null;
	}

	function latestStageKey() {
		let latest = 'sitePlan';

		readOnlyStages.forEach( function ( stage ) {
			if ( stageResponse( stage.key ) ) {
				latest = stage.key;
			}
		} );

		return latest;
	}

	function buildRequestPayload() {
		return {
			prompt: String( state.prompt || '' ).trim(),
			site_type: state.siteType,
			vertical: state.siteType,
			context: {},
			site_plan: state.flow.sitePlan || {},
			blueprint_candidate: state.flow.blueprintCandidate || {},
			preview_diff: state.flow.previewDiff || {},
			generate_gate: state.flow.generateGate || {},
			generate_preflight: state.flow.generatePreflight || {},
		};
	}

	function stageEndpoint(key) {
		if ( key === 'sitePlan' ) {
			return config.endpoints.aiSitePlan;
		}
		if ( key === 'blueprintCandidate' ) {
			return config.endpoints.aiBlueprintCandidate;
		}
		if ( key === 'previewDiff' ) {
			return config.endpoints.aiPreviewDiff;
		}
		if ( key === 'generateGate' ) {
			return config.endpoints.aiGenerateGate;
		}
		if ( key === 'generatePreflight' ) {
			return config.endpoints.aiGeneratePreflight;
		}
		if ( key === 'generateConfirmation' ) {
			return config.endpoints.aiGenerateConfirmation;
		}

		return '';
	}

	function stageBody(key, payload) {
		if ( key === 'sitePlan' ) {
			return {
				prompt: payload.prompt,
				site_type: payload.site_type,
				context: payload.context,
			};
		}

		if ( key === 'blueprintCandidate' ) {
			return {
				prompt: payload.prompt,
				site_plan: payload.site_plan,
				site_type: payload.site_type,
				context: payload.context,
			};
		}

		if ( key === 'previewDiff' ) {
			return {
				prompt: payload.prompt,
				site_plan: payload.site_plan,
				blueprint_candidate: payload.blueprint_candidate,
				site_type: payload.site_type,
				context: payload.context,
			};
		}

		if ( key === 'generateGate' ) {
			return {
				prompt: payload.prompt,
				site_plan: payload.site_plan,
				blueprint_candidate: payload.blueprint_candidate,
				preview_diff: payload.preview_diff,
				site_type: payload.site_type,
				context: payload.context,
			};
		}

		if ( key === 'generatePreflight' ) {
			return {
				prompt: payload.prompt,
				site_plan: payload.site_plan,
				blueprint_candidate: payload.blueprint_candidate,
				preview_diff: payload.preview_diff,
				generate_gate: payload.generate_gate,
				site_type: payload.site_type,
				context: payload.context,
			};
		}

		return {
			prompt: payload.prompt,
			site_plan: payload.site_plan,
			blueprint_candidate: payload.blueprint_candidate,
			preview_diff: payload.preview_diff,
			generate_gate: payload.generate_gate,
			generate_preflight: payload.generate_preflight,
			site_type: payload.site_type,
			context: payload.context,
		};
	}

	function resetFlow() {
		state.flow = {
			sitePlan: null,
			blueprintCandidate: null,
			previewDiff: null,
			generateGate: null,
			generatePreflight: null,
			generateConfirmation: null,
		};
	}

	function runPlanChain() {
		const prompt = String( state.prompt || '' ).trim();

		if ( ! prompt ) {
			state.error = 'Enter a prompt before running the planning chain.';
			render();
			return;
		}

		state.error = '';
		state.notice = '';
		state.isPlanning = true;
		state.currentStage = 'sitePlan';
		resetFlow();
		planRunId += 1;
		const runId = planRunId;
		render();

		const sequence = readOnlyStages.reduce( function ( promise, stage ) {
			return promise.then( function () {
				if ( runId !== planRunId ) {
					return Promise.reject( new Error( 'Planning run superseded.' ) );
				}

				state.currentStage = stage.key;
				render();
				const payload = buildRequestPayload();

				return request(
					stageEndpoint( stage.key ),
					{
						method: 'POST',
						body: stageBody( stage.key, payload ),
					}
				).then( function ( data ) {
					if ( stageReportedMutation( data ) ) {
						const message = 'Read-only contract violation: this planning stage reported applies_changes=true.';
						state.flow[ stage.key ] = {
							status: 'error',
							code: 'read_only_contract_violation',
							message: message,
							stage_key: stage.key,
							stage_label: stage.label,
						};
						state.currentStage = stage.key;
						state.error = message + ' Stage: ' + stage.label + ' (' + stage.key + ').';
						state.notice = '';
						throw new Error( state.error );
					}

					state.flow[ stage.key ] = data || null;
				} );
			} );
		}, Promise.resolve() );

		sequence.then( function () {
			state.notice = 'Read-only planning chain completed through Confirmation.';
		} ).catch( function ( error ) {
			if ( error && error.message === 'Planning run superseded.' ) {
				return;
			}

			state.error = error && error.message ? error.message : 'Planning chain failed.';
		} ).finally( function () {
			if ( runId !== planRunId ) {
				return;
			}

			state.isPlanning = false;
			render();
		} );
	}

	function renderOperationSelector() {
		return [
			'<label class="factory-console-field">',
				'<span>Operation type</span>',
				'<select data-factory-console-operation>',
					operationOptions.map( function ( option ) {
						return '<option value="' + escapeHtml( option.value ) + '"' + ( option.value === state.operationType ? ' selected' : '' ) + '>' + escapeHtml( option.label ) + '</option>';
					} ).join( '' ),
				'</select>',
			'</label>',
		].join( '' );
	}

	function renderPromptCard() {
		return [
			'<section class="factory-console-card factory-console-card-hero">',
				'<div class="factory-console-card__header">',
					'<div>',
						'<div class="factory-console-kicker">Independent Factory Console</div>',
						'<h1>Prompt-first control plane</h1>',
						'<p>Plan the site, inspect the chain, and hand off to generated frontend editing without touching the old dashboard.</p>',
					'</div>',
					badge( 'Alpha read-only', 'ok' ),
				'</div>',
				'<div class="factory-console-field-grid">',
					'<label class="factory-console-field">',
						'<span>Site type</span>',
						'<select data-factory-console-site-type disabled><option value="real_estate">Real Estate</option></select>',
					'</label>',
					renderOperationSelector(),
				'</div>',
				'<label class="factory-console-field factory-console-field-wide">',
					'<span>Prompt</span>',
					'<textarea rows="6" data-factory-console-prompt>' + escapeHtml( state.prompt ) + '</textarea>',
				'</label>',
				'<div class="factory-console-actions">',
					'<button type="button" class="factory-console-button factory-console-button-primary" data-factory-console-plan' + ( state.isPlanning ? ' disabled' : '' ) + '>' + escapeHtml( state.isPlanning ? 'Planning...' : 'Plan' ) + '</button>',
					'<button type="button" class="factory-console-button" data-factory-console-estimate' + ( state.estimating ? ' disabled' : '' ) + '>' + escapeHtml( state.estimating ? 'Estimating...' : 'Refresh estimate' ) + '</button>',
					'<span class="factory-console-inline-note">No provider call. No mutation. Generate stays disabled in 11a.</span>',
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderModelCard() {
		const settings = state.settings || {};
		const selectedModel = settings.selected_model || 'balanced';
		const hasKey = settings.has_key ? 'Configured' : 'Not configured';
		const keySource = settings.key_source || 'none';

		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>AI model control</h2>' + badge( settings.provider || 'openai', 'neutral' ) + '</div>',
				'<dl class="factory-console-definition-list">',
					'<dt>Current provider</dt><dd>' + escapeHtml( settings.provider || 'openai' ) + '</dd>',
					'<dt>Saved model profile</dt><dd>' + escapeHtml( modelLabel( selectedModel ) ) + '</dd>',
					'<dt>API key status</dt><dd>' + escapeHtml( hasKey ) + '</dd>',
					'<dt>Key source</dt><dd>' + escapeHtml( keySource ) + '</dd>',
				'</dl>',
				'<label class="factory-console-field">',
					'<span>Session model profile</span>',
					'<select data-factory-console-model>',
						models.map( function ( model ) {
							return '<option value="' + escapeHtml( model.key ) + '"' + ( model.key === state.selectedModel ? ' selected' : '' ) + '>' + escapeHtml( model.label || model.key ) + '</option>';
						} ).join( '' ),
					'</select>',
				'</label>',
				'<p class="factory-console-note">Model selection is local to this console in 11a. Saved provider settings still live in AI Settings.</p>',
				'<a class="factory-console-link" href="' + escapeHtml( config.siteLinks.ai_settings || '#' ) + '">Open AI Settings fallback</a>',
			'</section>',
		].join( '' );
	}

	function renderRecommendationCard() {
		const recommendation = state.recommendation || {};

		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>Recommended model</h2>' + badge( recommendation.risk_level || 'neutral', statusTone( recommendation.risk_level === 'high' ? 'warning' : recommendation.risk_level === 'low' ? 'ok' : 'neutral' ) ) + '</div>',
				'<div class="factory-console-recommendation-value">' + escapeHtml( modelLabel( recommendation.recommended_model || 'balanced' ) ) + '</div>',
				'<p>' + escapeHtml( recommendation.reason || 'Balanced is recommended for multi-stage planning and preview review.' ) + '</p>',
				'<dl class="factory-console-definition-list">',
					'<dt>Operation</dt><dd>' + escapeHtml( operationLabel( state.operationType ) ) + '</dd>',
					'<dt>Prompt length</dt><dd>' + escapeHtml( promptLength() + ' chars' ) + '</dd>',
					'<dt>Uncertainty</dt><dd>' + escapeHtml( recommendation.uncertainty_label || 'Local heuristic only' ) + '</dd>',
				'</dl>',
			'</section>',
		].join( '' );
	}

	function renderEstimateCard() {
		const estimate = state.estimate;
		const total = estimate ? estimate.estimated_total_tokens : null;

		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>Token and cost estimate</h2>' + badge( state.estimating ? 'refreshing' : 'local', state.estimating ? 'warning' : 'ok' ) + '</div>',
				estimate
					? [
						'<dl class="factory-console-definition-list">',
							'<dt>Estimated input tokens</dt><dd>' + escapeHtml( estimate.estimated_prompt_tokens ) + '</dd>',
							'<dt>Estimated output allowance</dt><dd>' + escapeHtml( estimate.estimated_output_tokens ) + '</dd>',
							'<dt>Estimated total</dt><dd>' + escapeHtml( total ) + '</dd>',
							'<dt>Estimated cost</dt><dd>Unavailable until pricing is configured</dd>',
							'<dt>Confidence</dt><dd>Rough local estimate</dd>',
						'</dl>',
					].join( '' )
					: '<p class="factory-console-empty">Type a prompt to see a local token estimate. No provider call is made.</p>',
				'<div class="factory-console-placeholder-list">',
					'<div><strong>Actual usage</strong><span>Available after provider-backed runs in a later phase.</span></div>',
					'<div><strong>Usage history</strong><span>Per-run history will appear here once usage recording exists.</span></div>',
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderStageRail() {
		return [
			'<section class="factory-console-card factory-console-card-wide">',
				'<div class="factory-console-card__header"><h2>Read-only planning chain</h2>' + badge( latestStageKey(), 'neutral' ) + '</div>',
				'<div class="factory-console-stage-rail">',
					readOnlyStages.map( function ( stage ) {
						const response = stageResponse( stage.key );
						const tone = state.isPlanning && state.currentStage === stage.key
							? 'warning'
							: response
								? statusTone( response.status )
								: 'neutral';
						const stateLabel = state.isPlanning && state.currentStage === stage.key
							? 'running'
							: response
								? ( response.status || 'ready' )
								: 'pending';

						return [
							'<div class="factory-console-stage factory-console-stage-' + escapeHtml( tone ) + '">',
								'<strong>' + escapeHtml( stage.label ) + '</strong>',
								'<span>' + escapeHtml( stateLabel ) + '</span>',
							'</div>',
						].join( '' );
					} ).join( '' ),
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderStageSummaryCard(key, title, renderer) {
		const response = stageResponse( key );

		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>' + escapeHtml( title ) + '</h2>' + badge( response ? ( response.status || 'ok' ) : 'pending', response ? statusTone( response.status ) : 'neutral' ) + '</div>',
				response ? renderer( response ) : '<p class="factory-console-empty">No data yet.</p>',
			'</section>',
		].join( '' );
	}

	function renderSitePlan(response) {
		return [
			'<dl class="factory-console-definition-list">',
				'<dt>Vertical</dt><dd>' + escapeHtml( response.vertical || '-' ) + '</dd>',
				'<dt>Preset</dt><dd>' + escapeHtml( response.recommended_preset || '-' ) + '</dd>',
				'<dt>Confidence</dt><dd>' + escapeHtml( response.confidence ?? '-' ) + '</dd>',
				'<dt>Business summary</dt><dd>' + escapeHtml( response.business_summary || '-' ) + '</dd>',
			'</dl>',
		].join( '' );
	}

	function renderBlueprintCandidate(response) {
		const siteName = response.candidate && response.candidate.site ? response.candidate.site.name : '';

		return [
			'<dl class="factory-console-definition-list">',
				'<dt>Vertical</dt><dd>' + escapeHtml( response.vertical || '-' ) + '</dd>',
				'<dt>Preset</dt><dd>' + escapeHtml( response.recommended_preset || '-' ) + '</dd>',
				'<dt>Candidate site</dt><dd>' + escapeHtml( siteName || '-' ) + '</dd>',
				'<dt>Next step</dt><dd>' + escapeHtml( response.next_step || '-' ) + '</dd>',
			'</dl>',
		].join( '' );
	}

	function renderPreviewDiff(response) {
		return [
			'<dl class="factory-console-definition-list">',
				'<dt>Summary</dt><dd>' + escapeHtml( response.preview && response.preview.summary ? response.preview.summary : '-' ) + '</dd>',
				'<dt>Creates</dt><dd>' + escapeHtml( summaryValue( response.diff_summary, 'creates' ) ) + '</dd>',
				'<dt>Updates</dt><dd>' + escapeHtml( summaryValue( response.diff_summary, 'updates' ) ) + '</dd>',
				'<dt>Skips</dt><dd>' + escapeHtml( summaryValue( response.diff_summary, 'skips' ) ) + '</dd>',
			'</dl>',
		].join( '' );
	}

	function renderGate(response) {
		return [
			'<dl class="factory-console-definition-list">',
				'<dt>Can generate later</dt><dd>' + escapeHtml( response.can_generate ? 'Yes' : 'No' ) + '</dd>',
				'<dt>Required dependencies</dt><dd>' + escapeHtml( Array.isArray( response.required_dependencies ) ? response.required_dependencies.length : 0 ) + '</dd>',
				'<dt>Confirmation</dt><dd>' + escapeHtml( response.confirmation_required_phrase ? 'Exact phrase required later' : 'Not ready yet' ) + '</dd>',
				'<dt>Next step</dt><dd>' + escapeHtml( response.next_step || '-' ) + '</dd>',
			'</dl>',
		].join( '' );
	}

	function renderPreflight(response) {
		const snapshot = response.current_runtime_snapshot || {};
		const dependencyStatus = response.dependency_status || {};
		const ownershipStatus = response.ownership_status || {};

		return [
			'<dl class="factory-console-definition-list">',
				'<dt>Preflight ready</dt><dd>' + escapeHtml( response.preflight_ready ? 'Yes' : 'No' ) + '</dd>',
				'<dt>Runtime snapshot</dt><dd>' + escapeHtml( summaryValue( snapshot, 'pages' ) + ' pages / ' + summaryValue( snapshot, 'properties' ) + ' properties / ' + summaryValue( snapshot, 'attachments' ) + ' attachments' ) + '</dd>',
				'<dt>Dependencies</dt><dd>' + escapeHtml( dependencyStatus.ready === false ? 'Blocked' : 'Checked' ) + '</dd>',
				'<dt>Ownership</dt><dd>' + escapeHtml( ownershipStatus.status || '-' ) + '</dd>',
			'</dl>',
		].join( '' );
	}

	function renderConfirmation(response) {
		return [
			'<dl class="factory-console-definition-list">',
				'<dt>Confirmation ready</dt><dd>' + escapeHtml( response.confirmation_ready ? 'Yes' : 'No' ) + '</dd>',
				'<dt>Exact phrase</dt><dd>' + escapeHtml( response.confirmation_required_phrase || 'Available later' ) + '</dd>',
				'<dt>Final recheck required</dt><dd>' + escapeHtml( response.final_recheck_required ? 'Yes' : 'No' ) + '</dd>',
				'<dt>Next step</dt><dd>' + escapeHtml( response.next_step || '-' ) + '</dd>',
			'</dl>',
		].join( '' );
	}

	function renderGenerateCard() {
		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>Controlled Generate</h2>' + badge( 'disabled', 'warning' ) + '</div>',
				'<p>Controlled Generate stays disabled in Phase 11a. This shell is read-only and stops at Confirmation.</p>',
				'<button type="button" class="factory-console-button factory-console-button-disabled" disabled>Generate</button>',
			'</section>',
		].join( '' );
	}

	function renderLinksCard() {
		const links = config.siteLinks || {};

		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>Open site and edit</h2>' + badge( 'handoff', 'ok' ) + '</div>',
				'<div class="factory-console-link-grid">',
					'<a class="factory-console-link-card" href="' + escapeHtml( links.home || '#' ) + '" target="_blank" rel="noopener noreferrer"><strong>Open Home</strong><span>Open the generated homepage.</span></a>',
					'<a class="factory-console-link-card" href="' + escapeHtml( links.properties || '#' ) + '" target="_blank" rel="noopener noreferrer"><strong>Open Properties</strong><span>Open the catalog page.</span></a>',
					'<a class="factory-console-link-card" href="' + escapeHtml( links.contact || '#' ) + '" target="_blank" rel="noopener noreferrer"><strong>Open Contact</strong><span>Open the contact page.</span></a>',
					'<a class="factory-console-link-card" href="' + escapeHtml( links.frontend_edit || '#' ) + '" target="_blank" rel="noopener noreferrer"><strong>Frontend Edit</strong><span>Open Home as admin to use Frontend Safe Edit.</span></a>',
					'<a class="factory-console-link-card" href="' + escapeHtml( links.manage_properties || '#' ) + '" target="_blank" rel="noopener noreferrer"><strong>Manage Properties</strong><span>Open the Property CPT list in WordPress.</span></a>',
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderManageCard() {
		const links = config.siteLinks || {};

		return [
			'<section class="factory-console-card">',
				'<div class="factory-console-card__header"><h2>Manage and status</h2>' + badge( 'placeholder', 'neutral' ) + '</div>',
				'<div class="factory-console-placeholder-list">',
					'<div><strong>Install / apply proof</strong><span>Moves here after generate is wired into the independent console.</span></div>',
					'<div><strong>Rollback</strong><span>Remains a later phase and is not exposed from this shell yet.</span></div>',
					'<div><strong>Usage history</strong><span>Will attach to provider-backed runs later.</span></div>',
				'</div>',
				'<div class="factory-console-actions factory-console-actions-compact">',
					'<a class="factory-console-button" href="' + escapeHtml( links.dashboard || '#' ) + '" target="_blank" rel="noopener noreferrer">Open beta diagnostics</a>',
					'<a class="factory-console-button" href="' + escapeHtml( links.ai_settings || '#' ) + '" target="_blank" rel="noopener noreferrer">Open AI Settings</a>',
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderDeveloperProof() {
		const data = {
			recommendation: state.recommendation,
			estimate: state.estimate,
			flow: state.flow,
		};

		return [
			'<section class="factory-console-card factory-console-card-wide">',
				'<details class="factory-console-details">',
					'<summary>Developer details</summary>',
					'<pre>' + escapeHtml( JSON.stringify( data, null, 2 ) ) + '</pre>',
				'</details>',
			'</section>',
		].join( '' );
	}

	function renderBanner() {
		const messages = [];

		if ( state.notice ) {
			messages.push( '<div class="factory-console-message factory-console-message-ok">' + escapeHtml( state.notice ) + '</div>' );
		}

		if ( state.error ) {
			messages.push( '<div class="factory-console-message factory-console-message-error">' + escapeHtml( state.error ) + '</div>' );
		}

		const warnings = Array.isArray( state.settings.warnings ) ? state.settings.warnings.slice( 0, 2 ) : [];

		warnings.forEach( function ( warning ) {
			messages.push( '<div class="factory-console-message factory-console-message-warning">' + escapeHtml( warning ) + '</div>' );
		} );

		return messages.join( '' );
	}

	function captureFocusState() {
		const active = document.activeElement;

		if ( ! active || ! root.contains( active ) ) {
			return null;
		}

		if ( active.hasAttribute( 'data-factory-console-prompt' ) ) {
			return {
				selector: '[data-factory-console-prompt]',
				selectionStart: active.selectionStart,
				selectionEnd: active.selectionEnd,
			};
		}

		if ( active.hasAttribute( 'data-factory-console-model' ) ) {
			return {
				selector: '[data-factory-console-model]',
			};
		}

		if ( active.hasAttribute( 'data-factory-console-operation' ) ) {
			return {
				selector: '[data-factory-console-operation]',
			};
		}

		return null;
	}

	function restoreFocusState( snapshot ) {
		if ( ! snapshot || ! snapshot.selector ) {
			return;
		}

		const element = root.querySelector( snapshot.selector );

		if ( ! element ) {
			return;
		}

		element.focus();

		if ( snapshot.selector === '[data-factory-console-prompt]' && typeof snapshot.selectionStart === 'number' && typeof snapshot.selectionEnd === 'number' && typeof element.setSelectionRange === 'function' ) {
			element.setSelectionRange( snapshot.selectionStart, snapshot.selectionEnd );
		}
	}

	function render() {
		const focusState = captureFocusState();

		root.innerHTML = [
			'<div class="factory-console-shell">',
				renderPromptCard(),
				renderBanner(),
				'<div class="factory-console-grid factory-console-grid-top">',
					renderModelCard(),
					renderRecommendationCard(),
					renderEstimateCard(),
				'</div>',
				renderStageRail(),
				'<div class="factory-console-grid">',
					renderStageSummaryCard( 'sitePlan', 'Site Plan', renderSitePlan ),
					renderStageSummaryCard( 'blueprintCandidate', 'Blueprint Candidate', renderBlueprintCandidate ),
					renderStageSummaryCard( 'previewDiff', 'Preview/Diff', renderPreviewDiff ),
					renderStageSummaryCard( 'generateGate', 'Generate Gate', renderGate ),
					renderStageSummaryCard( 'generatePreflight', 'Preflight', renderPreflight ),
					renderStageSummaryCard( 'generateConfirmation', 'Confirmation', renderConfirmation ),
					renderGenerateCard(),
					renderManageCard(),
				'</div>',
				renderLinksCard(),
				renderDeveloperProof(),
			'</div>',
		].join( '' );

		bindEvents();
		restoreFocusState( focusState );
	}

	function bindEvents() {
		const promptField = root.querySelector( '[data-factory-console-prompt]' );
		const modelField = root.querySelector( '[data-factory-console-model]' );
		const operationField = root.querySelector( '[data-factory-console-operation]' );
		const planButton = root.querySelector( '[data-factory-console-plan]' );
		const estimateButton = root.querySelector( '[data-factory-console-estimate]' );

		if ( promptField ) {
			promptField.addEventListener( 'input', function () {
				state.prompt = promptField.value;
				state.notice = '';
				state.error = '';
				recommendModel();
				scheduleEstimate();
			} );
		}

		if ( modelField ) {
			modelField.addEventListener( 'change', function () {
				state.selectedModel = modelField.value;
				scheduleEstimate();
				render();
			} );
		}

		if ( operationField ) {
			operationField.addEventListener( 'change', function () {
				state.operationType = operationField.value;
				recommendModel();
				render();
			} );
		}

		if ( planButton ) {
			planButton.addEventListener( 'click', runPlanChain );
		}

		if ( estimateButton ) {
			estimateButton.addEventListener( 'click', refreshEstimate );
		}
	}

	function loadSettings() {
		recommendModel();
		render();

		return request( config.endpoints.aiSettings, { method: 'GET' } )
			.then( function ( data ) {
				state.settings = data || {};
				state.selectedModel = state.settings.selected_model || state.selectedModel;
			} )
			.catch( function ( error ) {
				state.error = error.message || 'Factory Console settings could not be loaded.';
			} )
			.finally( function () {
				recommendModel();
				render();
				refreshEstimate();
			} );
	}

	loadSettings();
}() );
