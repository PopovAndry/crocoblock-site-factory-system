( function () {
	'use strict';

	const config = window.FactoryDashboardConfig || {};
	const root = document.getElementById( 'factory-dashboard-root' );
	const realEstatePrompt = 'Create a Kyiv real estate agency website in turquoise colors with 30 properties, image pools, a homepage with featured listings, a property catalog, single property pages, a contact page, and validation proof.';
	const defaultPresetVariables = {
		agency_name: 'Kyiv Turquoise Realty',
		hero_title: 'Kyiv Turquoise Realty',
		hero_subtitle: 'Find apartments, houses, and commercial spaces in Kyiv',
		contact_title: 'Contact Kyiv Turquoise Realty',
		contact_intro: 'Schedule a viewing or request more details about Kyiv properties.',
	};
	const defaultStyleContext = {
		tone: 'premium',
		primary_preset: 'turquoise',
	};
	const defaultImageContext = {
		source: 'demo_pool',
		mode: 'round_robin',
	};
	const imagePoolCounts = {
		Apartment: 10,
		House: 10,
		Commercial: 10,
	};
	const styleToneOptions = [
		[ 'premium', 'Premium' ],
		[ 'minimal', 'Minimal' ],
		[ 'modern', 'Modern' ],
		[ 'corporate', 'Corporate' ],
		[ 'warm', 'Warm' ],
	];
	const colorPresetOptions = [
		[ 'turquoise', 'Turquoise' ],
		[ 'blue', 'Blue' ],
		[ 'green', 'Green' ],
		[ 'beige', 'Beige' ],
	];
	const verticals = [
		{
			id: 'real-estate',
			label: 'Real Estate',
			status: 'available',
			description: 'Property catalog, listings, filters, single property pages, contact/request viewing flow.',
		},
		{
			id: 'travel-agency',
			label: 'Travel Agency',
			status: 'coming-soon',
			description: 'Tours, destinations, trip packages, and inquiry flows.',
		},
		{
			id: 'online-store',
			label: 'Online Store',
			status: 'coming-soon',
			description: 'Product catalog, commerce pages, and checkout-oriented structure.',
		},
		{
			id: 'medical-clinic',
			label: 'Medical Clinic',
			status: 'coming-soon',
			description: 'Services, doctors, appointment requests, and clinic contact pages.',
		},
		{
			id: 'barbershop',
			label: 'Barbershop',
			status: 'coming-soon',
			description: 'Services, staff, booking prompts, and local business pages.',
		},
		{
			id: 'restaurant-pizzeria',
			label: 'Restaurant / Pizzeria',
			status: 'coming-soon',
			description: 'Menu sections, location, reservations, and food-focused presentation.',
		},
		{
			id: 'job-board-directory',
			label: 'Job Board / Directory',
			status: 'coming-soon',
			description: 'Listings, categories, detail pages, and submission-oriented flows.',
		},
	];
	const colorPresetTokens = {
		turquoise: {
			primary: '#0f766e',
			accent: '#14b8a6',
			background: '#ecfeff',
			surface: '#ffffff',
			text: '#10201d',
			muted: '#52635f',
			border: '#d7eee9',
			link_hover: '#0d9488',
		},
		blue: {
			primary: '#1d4ed8',
			accent: '#38bdf8',
			background: '#eff6ff',
			surface: '#ffffff',
			text: '#102033',
			muted: '#53657a',
			border: '#dbeafe',
			link_hover: '#2563eb',
		},
		green: {
			primary: '#15803d',
			accent: '#22c55e',
			background: '#f0fdf4',
			surface: '#ffffff',
			text: '#10251a',
			muted: '#53665a',
			border: '#dcfce7',
			link_hover: '#16a34a',
		},
		beige: {
			primary: '#8a5a2b',
			accent: '#d6a45f',
			background: '#fff7ed',
			surface: '#ffffff',
			text: '#2a2118',
			muted: '#675d52',
			border: '#f1dcc4',
			link_hover: '#a16207',
		},
	};
	const styleToneOverrides = {
		premium: {},
		minimal: {
			background: '#f8fafc',
			border: '#e2e8f0',
			muted: '#64748b',
		},
		modern: {
			surface: '#ffffff',
		},
		corporate: {
			text: '#111827',
			muted: '#4b5563',
			surface: '#ffffff',
		},
		warm: {
			background: '#fff7ed',
			surface: '#fffaf4',
			border: '#f1dcc4',
		},
	};
	const wizardSteps = [
		{ title: 'Choose Site Type', subtitle: 'Vertical' },
		{ title: 'Requirements', subtitle: 'Theme and plugins' },
		{ title: 'Describe Business', subtitle: 'Preset and prompt' },
		{ title: 'Business Info', subtitle: 'Safe copy fields' },
		{ title: 'Style & Colors', subtitle: 'Design tokens' },
		{ title: 'Images', subtitle: 'Demo pools' },
		{ title: 'Preview Plan', subtitle: 'Review changes' },
		{ title: 'Generate / Proof', subtitle: 'Create and open' },
	];

	if ( ! root ) {
		return;
	}

	const state = {
		doctor: null,
		latest: null,
		runs: [],
		adapters: [],
		requirements: null,
		requirementsError: '',
		aiSettings: null,
		aiSettingsError: '',
		selectedRun: null,
		selectedFile: '',
		errors: [],
		loadingDetails: false,
		betaAction: '',
		betaMessage: null,
		betaPlan: null,
		betaProductPlan: null,
		bridgePreviewLoading: false,
		bridgePreviewError: '',
		bridgePreviewData: null,
		promptInterpretation: null,
		promptInterpretationWarnings: [],
		promptInterpretationNotices: [],
		promptInterpretationError: '',
		promptAnalyzing: false,
		prompt: realEstatePrompt,
		presetVariables: Object.assign( {}, defaultPresetVariables ),
		styleContext: Object.assign( {}, defaultStyleContext ),
		imageContext: Object.assign( {}, defaultImageContext ),
		selectedVertical: 'real-estate',
		verticalNotice: '',
		wizardStep: 0,
		maxWizardStep: 0,
		previewPayloadKey: '',
		previewStale: false,
		lastActionAt: '',
		advancedOpen: false,
		noRunsYet: false,
	};

	function endpoint( path ) {
		if ( /^https?:\/\//i.test( path ) ) {
			return path;
		}

		const base = ( config.restBase || '' ).replace( /\/$/, '' );
		return base + path;
	}

	function request( path, options ) {
		options = options || {};
		const headers = {
			'X-WP-Nonce': config.restNonce || '',
		};

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
					error.payload = data;
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

	function statusValue( value ) {
		const status = String( value || 'unknown' ).toLowerCase();

		if ( status === 'ready' ) {
			return 'ok';
		}

		return [ 'ok', 'warning', 'error' ].includes( status ) ? status : 'unknown';
	}

	function badge( value ) {
		const status = statusValue( value );
		return '<span class="factory-badge factory-badge-' + status + '">' + escapeHtml( status ) + '</span>';
	}

	function hasDoctorLoadError() {
		return state.errors.some( function ( error ) {
			return String( error || '' ).startsWith( 'Doctor:' );
		} );
	}

	function doctorStatusValue() {
		if ( hasDoctorLoadError() ) {
			return 'error';
		}

		if ( ! state.doctor ) {
			return 'unknown';
		}

		const doctorStatus = statusValue( state.doctor.status );
		const issues = Array.isArray( state.doctor.issues ) ? state.doctor.issues : [];
		const issueStatuses = issues.map( function ( issue ) {
			return statusValue( issue.status );
		} );

		if ( doctorStatus === 'error' || issueStatuses.includes( 'error' ) ) {
			return 'error';
		}

		if ( doctorStatus === 'warning' || issueStatuses.includes( 'warning' ) ) {
			return 'warning';
		}

		if ( doctorStatus === 'ok' ) {
			return issueStatuses.some( function ( status ) {
				return ! [ 'ok', 'unknown' ].includes( status );
			} ) ? 'warning' : 'ok';
		}

		return doctorStatus;
	}

	function count( value ) {
		return Array.isArray( value ) ? value.length : 0;
	}

	function addQueryParam( path, key, value ) {
		const separator = path.includes( '?' ) ? '&' : '?';
		return path + separator + encodeURIComponent( key ) + '=' + encodeURIComponent( value );
	}

	function presetVariableLabel( key ) {
		const labels = {
			agency_name: 'Agency name',
			hero_title: 'Hero title',
			hero_subtitle: 'Hero subtitle',
			contact_title: 'Contact title',
			contact_intro: 'Contact intro',
		};

		return labels[ key ] || key;
	}

	function isNoRunsMessage( message ) {
		message = String( message || '' ).toLowerCase();

		return (
			message.includes( 'no runs found' ) ||
			message.includes( 'no factory runs found' ) ||
			message.includes( 'no latest run' ) ||
			message.includes( 'latest run not found' ) ||
			message.includes( 'run registry not found' )
		);
	}

	function isNoRunsPayload( payload ) {
		return payload && typeof payload === 'object' && isNoRunsMessage( payload.message );
	}

	function isNoRunsError( error ) {
		return Number( error && error.status ) === 404 && (
			isNoRunsMessage( error && error.message ) ||
			isNoRunsPayload( error && error.payload )
		);
	}

	function isFirstRunEmptyResult( label, result ) {
		if ( ! [ 'Doctor', 'Runs', 'Latest run' ].includes( label ) ) {
			return false;
		}

		if ( result.status === 'rejected' ) {
			return isNoRunsError( result.reason );
		}

		return result.status === 'fulfilled' && isNoRunsPayload( result.value );
	}

	function homeUrl( path ) {
		const base = String( config.homeUrl || '/' ).replace( /\/$/, '' );
		const cleanPath = String( path || '/' ).replace( /^\//, '' );

		return base + '/' + cleanPath;
	}

	function summaryValue( summary, key ) {
		return summary && typeof summary === 'object' ? Number( summary[ key ] || 0 ) : 0;
	}

	function planSummaryText( summary ) {
		return [
			'+' + summaryValue( summary, 'create' ),
			'~' + summaryValue( summary, 'update' ),
			'=' + summaryValue( summary, 'skip' ),
			'!' + summaryValue( summary, 'warning' ),
			'x' + summaryValue( summary, 'error' ),
		].join( ' ' );
	}

	function resultsSummaryText( summary ) {
		return [
			'ok ' + summaryValue( summary, 'ok' ),
			'warning ' + summaryValue( summary, 'warning' ),
			'error ' + summaryValue( summary, 'error' ),
		].join( ' / ' );
	}

	function promptContextSummary( run ) {
		const context = run && run.prompt_context ? run.prompt_context : null;
		const variables = context && context.applied_variables ? context.applied_variables : null;

		if ( ! variables || typeof variables !== 'object' ) {
			return '-';
		}

		return Object.keys( variables ).map( function ( key ) {
			return presetVariableLabel( key ) + ': ' + variables[ key ];
		} ).join( ' / ' );
	}

	function styleContextSummary( run ) {
		const context = run && run.style_context && run.style_context.context ? run.style_context.context : null;

		if ( ! context || typeof context !== 'object' ) {
			return '-';
		}

		return 'Tone: ' + ( context.tone || '-' ) + ' / Primary preset: ' + ( context.primary_preset || '-' );
	}

	function imageContextSummary( run ) {
		const context = run && run.image_context && run.image_context.context ? run.image_context.context : null;

		if ( ! context || typeof context !== 'object' ) {
			return '-';
		}

		return 'Image source: Included demo image pools / Mode: ' + ( context.mode || '-' );
	}

	function currentPayloadKeyFromState() {
		return JSON.stringify( {
			prompt: state.prompt || '',
			presetVariables: state.presetVariables || {},
			styleContext: state.styleContext || {},
			imageContext: state.imageContext || {},
		} );
	}

	function isPreviewCurrent() {
		return Boolean( state.previewPayloadKey ) && state.previewPayloadKey === currentPayloadKeyFromState() && ! state.previewStale;
	}

	function isRequirementsReady() {
		return Boolean( state.requirements && state.requirements.ready );
	}

	function updatePreviewFreshness() {
		state.previewStale = Boolean( state.previewPayloadKey ) && state.previewPayloadKey !== currentPayloadKeyFromState();
	}

	function canVisitWizardStep( step, allowNext ) {
		if ( step >= 7 && ! isPreviewCurrent() ) {
			return false;
		}

		return step <= state.maxWizardStep || ( allowNext && step === state.maxWizardStep + 1 );
	}

	function markWizardProgress( step ) {
		state.maxWizardStep = Math.max( state.maxWizardStep, Math.min( step, wizardSteps.length - 1 ) );
	}

	function syncWizardInputs() {
		currentPrompt();
		currentPresetVariables();
		currentStyleContext();
		currentImageContext();
		updatePreviewFreshness();
	}

	function goWizardStep( step, allowNext ) {
		if ( state.betaAction ) {
			return;
		}

		syncWizardInputs();

		const nextStep = Math.max( 0, Math.min( step, wizardSteps.length - 1 ) );

		if ( ! canVisitWizardStep( nextStep, allowNext ) ) {
			return;
		}

		state.wizardStep = nextStep;
		markWizardProgress( nextStep );
		render();
	}

	function runFromLatest() {
		return state.latest && state.latest.run ? state.latest.run : {};
	}

	function executionCount( run ) {
		const execution = run && run.execution ? run.execution : {};
		return Number( execution.count ?? count( execution.items ) );
	}

	function validationCount( run ) {
		const validation = run && run.validation ? run.validation : {};
		return Number( validation.count ?? count( validation.checks ) );
	}

	function latestValidationOk() {
		const run = runFromLatest();

		if ( ! run || ! Object.keys( run ).length ) {
			return false;
		}

		if ( statusValue( run.status ) === 'ok' ) {
			return true;
		}

		const validationChecks = run.validation && Array.isArray( run.validation.checks )
			? run.validation.checks
			: [];
		const resultsSummary = run.results && run.results.summary ? run.results.summary : {};
		const hasValidationErrors = validationChecks.some( function ( check ) {
			return statusValue( check.status ) === 'error';
		} );
		const resultErrors = summaryValue( resultsSummary, 'error' );

		return ! hasValidationErrors && resultErrors === 0 && ( validationChecks.length > 0 || Object.keys( resultsSummary ).length > 0 );
	}

	function renderMetric( label, value ) {
		return '<div class="factory-metric"><span>' + escapeHtml( label ) + '</span><strong>' + escapeHtml( value ) + '</strong></div>';
	}

	function renderDemoStatus( label, isReady ) {
		return '<div class="factory-demo-status"><span>' + escapeHtml( label ) + '</span>' + badge( isReady ? 'ok' : 'warning' ) + '</div>';
	}

	function renderBetaMessage() {
		if ( ! state.betaMessage ) {
			return '';
		}

		return [
			'<div class="factory-demo-message factory-demo-message-' + escapeHtml( statusValue( state.betaMessage.status ) ) + '">',
				'<span>' + escapeHtml( state.betaMessage.message || '' ) + '</span>',
				state.lastActionAt
					? '<small>Last action: ' + escapeHtml( state.lastActionAt ) + '</small>'
					: '',
			'</div>',
		].join( '' );
	}

	function renderGenerationProgress() {
		if ( state.betaAction !== 'apply' ) {
			return '';
		}

		return [
			'<div class="factory-demo-progress" role="status" aria-live="polite">',
				'<span class="factory-demo-spinner" aria-hidden="true"></span>',
				'<div>',
					'<strong>Generating Real Estate Demo...</strong>',
					'<span>This may take a moment.</span>',
				'</div>',
			'</div>',
		].join( '' );
	}

	function renderPromptPreview() {
		return [
			'<div class="factory-prompt-preview">',
				'<div class="factory-prompt-preview-heading">',
					'<h3>Describe your website</h3>',
					'<span>Prompt Preview</span>',
				'</div>',
				'<textarea rows="4" data-factory-prompt>' + escapeHtml( state.prompt || realEstatePrompt ) + '</textarea>',
				'<p>Beta mode: this prompt is captured for the run manifest. The prepared Real Estate preset is still used.</p>',
				'<div class="factory-prompt-actions">',
					'<button type="button" class="button button-secondary" data-factory-ai-action="interpret"' + ( state.promptAnalyzing || state.betaAction ? ' disabled' : '' ) + '>',
						state.promptAnalyzing ? 'Analyzing...' : 'Analyze Prompt',
					'</button>',
					'<span>Interpretation only. No changes are applied automatically.</span>',
				'</div>',
			'</div>',
			renderPromptInterpretation(),
		].join( '' );
	}

	function confidencePercent( value ) {
		const number = Number( value || 0 );

		return Math.max( 0, Math.min( 100, Math.round( number * 100 ) ) ) + '%';
	}

	function suggestionValue( item ) {
		return item && typeof item === 'object' ? String( item.value || '' ) : '';
	}

	function renderPromptInterpretation() {
		const interpretation = state.promptInterpretation;
		const warnings = Array.isArray( state.promptInterpretationWarnings ) ? state.promptInterpretationWarnings : [];
		const notices = Array.isArray( state.promptInterpretationNotices ) ? state.promptInterpretationNotices : [];

		if ( state.promptAnalyzing ) {
			return '<div class="factory-prompt-intelligence factory-prompt-intelligence-loading"><strong>Analyzing prompt...</strong><p>Local interpretation is running. No external AI call is made.</p></div>';
		}

		if ( state.promptInterpretationError ) {
			return '<div class="factory-prompt-intelligence factory-prompt-intelligence-error"><strong>Prompt interpretation failed</strong><p>' + escapeHtml( state.promptInterpretationError ) + '</p></div>';
		}

		if ( ! interpretation ) {
			return [
				'<div class="factory-prompt-intelligence">',
					'<div class="factory-prompt-intelligence-heading">',
						'<div>',
							'<h4>Prompt interpretation</h4>',
							'<p>Use Analyze Prompt to produce local, structured suggestions. AI suggestions do not change the site until you apply them and run Preview.</p>',
						'</div>',
						'<span class="factory-badge factory-badge-unknown">Not analyzed</span>',
					'</div>',
				'</div>',
			].join( '' );
		}

		return [
			'<div class="factory-prompt-intelligence">',
				'<div class="factory-prompt-intelligence-heading">',
					'<div>',
						'<h4>Prompt interpretation</h4>',
						'<p>AI suggestions do not change the site until you apply them and run Preview.</p>',
					'</div>',
					'<span class="factory-badge factory-badge-ok">Local mock</span>',
				'</div>',
				renderPromptIntentSummary( interpretation ),
				renderPromptSuggestionGroups( interpretation ),
				renderPromptUnsupportedRequests( interpretation ),
				renderPromptMissingQuestions( interpretation ),
				warnings.length ? '<div class="factory-prompt-message factory-prompt-message-warning">' + warnings.map( escapeHtml ).join( '<br>' ) + '</div>' : '',
				notices.length ? '<div class="factory-prompt-message">' + notices.map( escapeHtml ).join( '<br>' ) + '</div>' : '',
			'</div>',
		].join( '' );
	}

	function renderPromptIntentSummary( interpretation ) {
		const business = interpretation.business_name || {};
		const location = interpretation.location || {};
		const tone = interpretation.tone || {};
		const color = interpretation.color_preference || {};

		return [
			'<div class="factory-prompt-intent-grid">',
				renderPromptIntentItem( 'Detected vertical', interpretation.detected_vertical || 'unknown', confidencePercent( interpretation.confidence ) ),
				renderPromptIntentItem( 'Recommended preset', interpretation.recommended_preset || 'real-estate', 'Safe preset' ),
				renderPromptIntentItem( 'Business name', business.value || '-', confidencePercent( business.confidence ) ),
				renderPromptIntentItem( 'Location', location.value || '-', confidencePercent( location.confidence ) ),
				renderPromptIntentItem( 'Tone', tone.value || '-', confidencePercent( tone.confidence ) ),
				renderPromptIntentItem( 'Color', color.value || '-', confidencePercent( color.confidence ) ),
			'</div>',
		].join( '' );
	}

	function renderPromptIntentItem( label, value, meta ) {
		return [
			'<article>',
				'<span>' + escapeHtml( label ) + '</span>',
				'<strong>' + escapeHtml( value ) + '</strong>',
				'<small>' + escapeHtml( meta ) + '</small>',
			'</article>',
		].join( '' );
	}

	function renderPromptSuggestionGroups( interpretation ) {
		const copySuggestions = interpretation.safe_preset_variable_suggestions || {};
		const styleSuggestions = interpretation.safe_style_context_suggestions || {};
		const imageSuggestions = interpretation.safe_image_context_suggestions || {};
		const copyKeys = [ 'agency_name', 'hero_title', 'hero_subtitle', 'contact_title', 'contact_intro' ];
		const styleKeys = [ 'tone', 'primary_preset' ];

		return [
			'<div class="factory-prompt-suggestion-grid">',
				'<section>',
					'<div class="factory-prompt-suggestion-heading"><h5>Safe copy suggestions</h5><button type="button" class="button button-small" data-factory-apply-interpretation="copy">Apply copy</button></div>',
					'<ul>',
						copyKeys.map( function ( key ) {
							return '<li><span>' + escapeHtml( presetVariableLabel( key ) ) + '</span><strong>' + escapeHtml( suggestionValue( copySuggestions[ key ] ) || '-' ) + '</strong></li>';
						} ).join( '' ),
					'</ul>',
				'</section>',
				'<section>',
					'<div class="factory-prompt-suggestion-heading"><h5>Style suggestions</h5><button type="button" class="button button-small" data-factory-apply-interpretation="style">Apply style</button></div>',
					'<ul>',
						styleKeys.map( function ( key ) {
							return '<li><span>' + escapeHtml( key === 'tone' ? 'Tone' : 'Primary preset' ) + '</span><strong>' + escapeHtml( suggestionValue( styleSuggestions[ key ] ) || '-' ) + '</strong></li>';
						} ).join( '' ),
					'</ul>',
				'</section>',
				'<section>',
					'<div class="factory-prompt-suggestion-heading"><h5>Image suggestions</h5><span>Informational</span></div>',
					'<ul>',
						'<li><span>Source</span><strong>' + escapeHtml( suggestionValue( imageSuggestions.source ) || 'demo_pool' ) + '</strong></li>',
						'<li><span>Mode</span><strong>' + escapeHtml( suggestionValue( imageSuggestions.mode ) || 'round_robin' ) + '</strong></li>',
					'</ul>',
					'<p>Image mode is fixed in this beta and is not applied from prompt interpretation.</p>',
				'</section>',
			'</div>',
		].join( '' );
	}

	function renderPromptUnsupportedRequests( interpretation ) {
		const unsupported = Array.isArray( interpretation.unsupported_requests ) ? interpretation.unsupported_requests : [];
		const features = Array.isArray( interpretation.requested_features ) ? interpretation.requested_features : [];

		if ( ! unsupported.length && ! features.length ) {
			return '';
		}

		return [
			'<div class="factory-prompt-feature-grid">',
				features.length
					? '<section><h5>Detected supported requests</h5><ul>' + features.map( function ( item ) {
						return '<li>' + escapeHtml( item.label || '' ) + '</li>';
					} ).join( '' ) + '</ul></section>'
					: '',
				unsupported.length
					? '<section><h5>Unsupported in this beta</h5><ul>' + unsupported.map( function ( item ) {
						return '<li><strong>' + escapeHtml( item.label || '' ) + '</strong><span>' + escapeHtml( item.reason || '' ) + '</span><small>' + escapeHtml( item.safe_alternative || '' ) + '</small></li>';
					} ).join( '' ) + '</ul></section>'
					: '',
			'</div>',
		].join( '' );
	}

	function renderPromptMissingQuestions( interpretation ) {
		const questions = Array.isArray( interpretation.missing_questions ) ? interpretation.missing_questions : [];

		if ( ! questions.length ) {
			return '';
		}

		return '<div class="factory-prompt-questions"><h5>Missing questions</h5><ul>' + questions.map( function ( question ) {
			return '<li>' + escapeHtml( question ) + '</li>';
		} ).join( '' ) + '</ul></div>';
	}

	function renderPresetVariables() {
		const fields = [
			[ 'agency_name', 'text' ],
			[ 'hero_title', 'text' ],
			[ 'hero_subtitle', 'textarea' ],
			[ 'contact_title', 'text' ],
			[ 'contact_intro', 'textarea' ],
		];

		return [
			'<div class="factory-preset-variables">',
				'<div class="factory-preset-variables-heading">',
					'<h3>Safe preset variables</h3>',
					'<span>Copy only</span>',
				'</div>',
				'<p>These beta variables update selected site copy only. The prepared preset is still used, and schema, filters, forms, property data, and page structure are unchanged.</p>',
				'<div class="factory-preset-variable-grid">',
					fields.map( function ( field ) {
						const key = field[0];
						const type = field[1];
						const value = state.presetVariables[ key ] || defaultPresetVariables[ key ] || '';

						if ( type === 'textarea' ) {
							return '<label><span>' + escapeHtml( presetVariableLabel( key ) ) + '</span><textarea rows="2" data-factory-preset-variable="' + escapeHtml( key ) + '">' + escapeHtml( value ) + '</textarea></label>';
						}

						return '<label><span>' + escapeHtml( presetVariableLabel( key ) ) + '</span><input type="text" data-factory-preset-variable="' + escapeHtml( key ) + '" value="' + escapeHtml( value ) + '"></label>';
					} ).join( '' ),
				'</div>',
			'</div>',
		].join( '' );
	}

	function deriveStyleTokens( context ) {
		const primaryPreset = colorPresetTokens[ context.primary_preset ] ? context.primary_preset : defaultStyleContext.primary_preset;
		const tone = styleToneOverrides[ context.tone ] ? context.tone : defaultStyleContext.tone;
		const tokens = Object.assign(
			{},
			colorPresetTokens[ primaryPreset ],
			styleToneOverrides[ tone ]
		);

		tokens.tone = tone;
		tokens.primary_preset = primaryPreset;
		tokens.button = tokens.accent;
		tokens.button_text = '#ffffff';
		tokens.link = tokens.primary;
		tokens.heading = tokens.text;

		return tokens;
	}

	function styleOptionButton( group, value, label, current, swatch ) {
		const checked = current === value;

		return [
			'<label class="factory-style-option' + ( checked ? ' factory-style-option-selected' : '' ) + '">',
				'<input type="radio" name="' + escapeHtml( group ) + '" data-factory-style-context="' + escapeHtml( group ) + '" value="' + escapeHtml( value ) + '"' + ( checked ? ' checked' : '' ) + '>',
				swatch ? '<span class="factory-style-swatch" style="background: ' + escapeHtml( swatch ) + ';"></span>' : '',
				'<span>' + escapeHtml( label ) + '</span>',
			'</label>',
		].join( '' );
	}

	function renderStyleContext() {
		const context = state.styleContext || defaultStyleContext;
		const tokens = deriveStyleTokens( context );
		const tokenKeys = [ 'primary', 'accent', 'background', 'surface', 'text', 'muted', 'border' ];

		return [
			'<div class="factory-style-context">',
				'<div class="factory-preset-variables-heading">',
					'<h3>Style & colors</h3>',
					'<span>Design tokens</span>',
				'</div>',
				'<p>Choose deterministic Factory tokens for generated components. Site-wide theme settings are not changed in this beta.</p>',
				'<div class="factory-style-control">',
					'<h4>Style tone</h4>',
					'<div class="factory-style-option-grid">',
						styleToneOptions.map( function ( option ) {
							return styleOptionButton( 'tone', option[0], option[1], context.tone, '' );
						} ).join( '' ),
					'</div>',
				'</div>',
				'<div class="factory-style-control">',
					'<h4>Primary color preset</h4>',
					'<div class="factory-style-option-grid">',
						colorPresetOptions.map( function ( option ) {
							const swatch = colorPresetTokens[ option[0] ] ? colorPresetTokens[ option[0] ].primary : '';

							return styleOptionButton( 'primary_preset', option[0], option[1], context.primary_preset, swatch );
						} ).join( '' ),
					'</div>',
				'</div>',
				'<div class="factory-style-palette" aria-label="Generated token preview">',
					tokenKeys.map( function ( key ) {
						return [
							'<div class="factory-style-token">',
								'<span style="background: ' + escapeHtml( tokens[ key ] ) + ';"></span>',
								'<strong>' + escapeHtml( key ) + '</strong>',
								'<code>' + escapeHtml( tokens[ key ] ) + '</code>',
							'</div>',
						].join( '' );
					} ).join( '' ),
				'</div>',
				'<div class="factory-wizard-notice">Will update generated Factory component colors. Will not change schema, content, filters, forms, images, typography, or layout.</div>',
			'</div>',
		].join( '' );
	}

	function renderImageContext() {
		const context = state.imageContext || defaultImageContext;
		const futureOptions = [
			[ 'Neutral placeholders', 'Simple placeholder visuals are planned, but not active in this beta.' ],
			[ 'Upload my images', 'Upload and Media Library picker flows are intentionally not included yet.' ],
			[ 'AI generated images', 'AI image generation and external image APIs are not used in this beta.' ],
		];

		return [
			'<div class="factory-image-context">',
				'<div class="factory-preset-variables-heading">',
					'<h3>Images</h3>',
					'<span>Demo pools</span>',
				'</div>',
				'<p>Factory will use the bundled real estate image pools already included with the plugin.</p>',
				'<article class="factory-image-source-card factory-image-source-card-active">',
					'<div>',
						'<strong>Included demo image pools</strong>',
						'<span>Source: ' + escapeHtml( context.source || defaultImageContext.source ) + '</span>',
						'<span>Mode: ' + escapeHtml( context.mode || defaultImageContext.mode ) + '</span>',
					'</div>',
					'<p>Using bundled real estate image pools. Images are assigned as featured images for property cards and single property pages.</p>',
				'</article>',
				'<div class="factory-image-pools" aria-label="Bundled image pool counts">',
					Object.keys( imagePoolCounts ).map( function ( label ) {
						return [
							'<div class="factory-image-pool">',
								'<span>' + escapeHtml( label ) + '</span>',
								'<strong>' + escapeHtml( imagePoolCounts[ label ] ) + '</strong>',
							'</div>',
						].join( '' );
					} ).join( '' ),
				'</div>',
				'<div class="factory-image-future-grid">',
					futureOptions.map( function ( option ) {
						return [
							'<article class="factory-image-source-card factory-image-source-card-disabled" aria-disabled="true">',
								'<strong>' + escapeHtml( option[0] ) + '</strong>',
								'<p>' + escapeHtml( option[1] ) + '</p>',
								'<span>Future</span>',
							'</article>',
						].join( '' );
					} ).join( '' ),
				'</div>',
				'<div class="factory-wizard-notice">Will use bundled images only. Will not upload user images, open the Media Library picker, import ZIP files, generate AI images, or call external image APIs.</div>',
			'</div>',
		].join( '' );
	}

	function renderBetaPlanPreview() {
		if ( ! state.betaProductPlan && ! state.betaPlan ) {
			return '<p class="factory-empty">Use Preview plan to inspect the prepared Real Estate preset plan.</p>';
		}

		const productPlan = state.betaProductPlan || {};
		const sections = Array.isArray( productPlan.sections ) ? productPlan.sections : [];

		return [
			productPlan.title
				? '<div class="factory-product-plan-hero"><span>' + escapeHtml( productPlan.mode || 'Beta preset plan' ) + '</span><h4>' + escapeHtml( productPlan.title ) + '</h4><p>' + escapeHtml( productPlan.summary || '' ) + '</p></div>'
				: '',
			sections.length
				? '<div class="factory-product-plan-sections">' + sections.map( function ( section ) {
					const sectionItems = Array.isArray( section.items ) ? section.items : [];

					return [
						'<section class="factory-product-plan-section factory-product-plan-section-' + statusValue( section.status ) + '">',
							'<div class="factory-product-plan-section-heading">',
								'<h4>' + escapeHtml( section.label || 'Plan section' ) + '</h4>',
								badge( section.status || 'ready' ),
							'</div>',
							sectionItems.length
								? '<ul>' + sectionItems.map( function ( item ) {
									return '<li>' + escapeHtml( item ) + '</li>';
								} ).join( '' ) + '</ul>'
								: '<p class="factory-empty">No section items returned.</p>',
						'</section>',
					].join( '' );
				} ).join( '' ) + '</div>'
				: '',
		].join( '' );
	}

	function productPlanSections() {
		const productPlan = state.betaProductPlan || {};

		return Array.isArray( productPlan.sections ) ? productPlan.sections : [];
	}

	function productPlanSection( labels ) {
		const wanted = ( Array.isArray( labels ) ? labels : [ labels ] ).map( function ( label ) {
			return String( label || '' ).toLowerCase();
		} );

		return productPlanSections().find( function ( section ) {
			const label = String( section.label || '' ).toLowerCase();

			return wanted.includes( label );
		} ) || null;
	}

	function productPlanItems( labels, fallback ) {
		const section = productPlanSection( labels );
		const items = section && Array.isArray( section.items ) ? section.items : [];

		return items.length ? items : fallback;
	}

	function renderHumanList( items ) {
		const safeItems = Array.isArray( items ) ? items.filter( Boolean ) : [];

		if ( ! safeItems.length ) {
			return '<p class="factory-empty">No summary available yet.</p>';
		}

		return '<ul>' + safeItems.map( function ( item ) {
			return '<li>' + escapeHtml( item ) + '</li>';
		} ).join( '' ) + '</ul>';
	}

	function renderHumanReportCard( title, items, modifier ) {
		const classes = [ 'factory-human-report-card', modifier ? 'factory-human-report-card-' + modifier : '' ].filter( Boolean ).join( ' ' );

		return [
			'<article class="' + escapeHtml( classes ) + '">',
				'<h4>' + escapeHtml( title ) + '</h4>',
				renderHumanList( items ),
			'</article>',
		].join( '' );
	}

	function requirementsSummaryText() {
		if ( state.requirements && state.requirements.summary ) {
			return state.requirements.summary;
		}

		if ( isRequirementsReady() ) {
			return 'Ready to generate.';
		}

		if ( state.requirementsError ) {
			return 'Unable to verify requirements.';
		}

		return 'Requirements are being checked.';
	}

	function currentStyleSummaryText() {
		const context = state.styleContext || defaultStyleContext;

		return 'Style tone: ' + ( context.tone || defaultStyleContext.tone ) + ' / Primary preset: ' + ( context.primary_preset || defaultStyleContext.primary_preset );
	}

	function currentImageSummaryText() {
		const context = state.imageContext || defaultImageContext;

		return 'Image source: Included demo image pools / Mode: ' + ( context.mode || defaultImageContext.mode );
	}

	function safeVariableSummaryItems() {
		return Object.keys( defaultPresetVariables ).map( function ( key ) {
			const value = state.presetVariables[ key ] || defaultPresetVariables[ key ] || '';

			return presetVariableLabel( key ) + ': ' + value;
		} );
	}

	function renderSafetyNotice( compact ) {
		return [
			'<div class="factory-safety-notice">',
				'<strong>Safety mode</strong>',
				'<p>',
					compact
						? 'Site Factory updates Factory-managed generated content only. Developer proof remains available in Advanced.'
						: 'Site Factory updates Factory-managed generated content only. Existing unrelated pages, posts, users, uploads, theme settings, external APIs, and AI image generation are not changed.',
				'</p>',
			'</div>',
		].join( '' );
	}

	function renderHumanPreviewReport() {
		if ( ! state.betaProductPlan && ! state.betaPlan ) {
			return [
				'<div class="factory-human-report">',
					'<section class="factory-human-report-hero">',
						'<span>Review before generation</span>',
						'<h3>Preview this setup to create a human-readable plan.</h3>',
						'<p>The prepared Real Estate preset will be shown with your prompt context, safe copy variables, style tokens, image source, requirements, and guardrails.</p>',
					'</section>',
					renderSafetyNotice( false ),
				'</div>',
			].join( '' );
		}

		return [
			'<div class="factory-human-report">',
				'<section class="factory-human-report-hero">',
					'<span>Review before generation</span>',
					'<h3>' + escapeHtml( state.betaProductPlan?.title || 'Real Estate Demo Plan' ) + '</h3>',
					'<p>' + escapeHtml( state.betaProductPlan?.summary || 'Prepared Real Estate preset with prompt context and safe beta variables.' ) + '</p>',
				'</section>',
				'<div class="factory-human-report-grid">',
					renderHumanReportCard(
						'Setup summary',
						[
							'Website type: Real Estate demo',
							'Mode: Prepared Real Estate preset',
							'Prompt captured for the run manifest; free-prose AI parsing is not enabled',
							'Requirements: ' + requirementsSummaryText(),
						],
						'summary'
					),
					renderHumanReportCard(
						'What will be generated',
						[].concat(
							productPlanItems( 'Site structure', [ 'Home page', 'Properties catalog', 'Contact page', 'Navigation menu' ] ),
							productPlanItems( 'Content', [ 'Real Estate property content' ] ),
							productPlanItems( 'Frontend features', [ 'Catalog cards', 'GET filters', 'Single property pages', 'Request Viewing flow' ] )
						),
						'generated'
					),
					renderHumanReportCard(
						'Your inputs',
						[].concat(
							safeVariableSummaryItems(),
							[ currentStyleSummaryText(), currentImageSummaryText() ]
						),
						'inputs'
					),
					renderHumanReportCard(
						'Safety guardrails',
						productPlanItems( 'Guardrails', [
							'Only Factory-managed generated content changes',
							'Existing unrelated pages, posts, users, and uploads are not changed',
							'No site-wide theme settings, AI images, external image APIs, or schema topology changes',
						] ),
						'safety'
					),
				'</div>',
				renderSafetyNotice( false ),
			'</div>',
		].join( '' );
	}

	function bridgeBooleanLabel( value ) {
		return value ? 'true' : 'false';
	}

	function bridgeStatusBadge( value ) {
		return badge( statusValue( value ) );
	}

	function bridgeSummaryItems( summary, keys ) {
		if ( ! summary || typeof summary !== 'object' ) {
			return '<p class="factory-empty">No summary available.</p>';
		}

		return [
			'<div class="factory-metric-grid factory-bridge-metrics">',
				keys.map( function ( key ) {
					return renderMetric( key.replace( /_/g, ' ' ), summaryValue( summary, key ) );
				} ).join( '' ),
			'</div>',
		].join( '' );
	}

	function bridgeMessageList( label, items, status ) {
		if ( ! Array.isArray( items ) || ! items.length ) {
			return '';
		}

		return [
			'<div class="factory-bridge-message-group factory-bridge-message-group-' + escapeHtml( statusValue( status ) ) + '">',
				'<strong>' + escapeHtml( label ) + '</strong>',
				'<ul>',
					items.map( function ( item ) {
						const message = typeof item === 'string' ? item : ( item.message || JSON.stringify( item ) );
						return '<li>' + escapeHtml( message ) + '</li>';
					} ).join( '' ),
				'</ul>',
			'</div>',
		].join( '' );
	}

	function getRuntimeReadinessState() {
		const data = state.bridgePreviewData;
		const applyGate = data && data.apply_gate && typeof data.apply_gate === 'object' ? data.apply_gate : {};
		const runtimeEvidence = data && data.runtime_evidence && typeof data.runtime_evidence === 'object' ? data.runtime_evidence : {};
		const bridgeStatus = statusValue( data && data.status );
		const runtimeStatus = statusValue( runtimeEvidence.status );
		const applyGateStatus = String( applyGate.status || '' ).toLowerCase();
		const blockingReasons = Array.isArray( applyGate.blocking_reasons ) ? applyGate.blocking_reasons : [];
		const warnings = [].concat(
			Array.isArray( data && data.warnings ) ? data.warnings : [],
			Array.isArray( applyGate.warnings ) ? applyGate.warnings : []
		);

		if ( state.bridgePreviewLoading ) {
			return {
				key: 'loading',
				label: 'Loading',
				message: 'Collecting read-only runtime evidence...',
			};
		}

		if ( ! data ) {
			return {
				key: 'unknown',
				label: 'Unknown',
				message: 'Run the read-only runtime preview before generating to inspect runtime evidence.',
			};
		}

		if (
			bridgeStatus === 'error' ||
			runtimeStatus === 'error' ||
			[ 'error', 'blocked' ].includes( applyGateStatus ) ||
			blockingReasons.length > 0
		) {
			return {
				key: 'blocked',
				label: 'Blocked',
				message: 'You can preview the plan, but generation should wait until runtime requirements are resolved.',
			};
		}

		if (
			warnings.length > 0 ||
			applyGateStatus === 'warning' ||
			applyGate.can_apply === false
		) {
			return {
				key: 'review',
				label: 'Review required',
				message: 'The Preview Bridge is evidence-only in this beta. Review runtime evidence before generating.',
			};
		}

		return {
			key: 'ready',
			label: 'Ready for review',
			message: 'Runtime evidence is clean. This still does not authorize automatic apply.',
		};
	}

	function renderRuntimeReadinessNotice( context ) {
		const readiness = getRuntimeReadinessState();
		const className = 'factory-readiness factory-readiness--' + readiness.key;

		if ( context === 'step6' ) {
			if ( readiness.key === 'unknown' ) {
				return '<div class="' + className + '"><strong>Runtime readiness: Unknown</strong><p>Runtime readiness has not been checked. You can continue with the current beta flow, but running the read-only runtime preview is recommended.</p></div>';
			}

			if ( readiness.key === 'blocked' ) {
				return '<div class="' + className + '"><strong>Runtime readiness: Blocked</strong><p>Preview is current, but runtime readiness is blocked. Resolve the listed runtime requirements before generating.</p></div>';
			}

			if ( readiness.key === 'review' ) {
				return '<div class="' + className + '"><strong>Runtime readiness: Review required</strong><p>Runtime evidence requires review. The Preview Bridge is evidence-only and does not authorize apply yet.</p></div>';
			}

			return '';
		}

		return [
			'<div class="' + className + '">',
				'<strong>Runtime readiness: ' + escapeHtml( readiness.label ) + '</strong>',
				'<p>' + escapeHtml( readiness.message ) + '</p>',
			'</div>',
		].join( '' );
	}

	function renderPreviewBridgePanel() {
		const data = state.bridgePreviewData;
		const applyGate = data && data.apply_gate && typeof data.apply_gate === 'object' ? data.apply_gate : {};
		const dryRun = data && data.plugin && data.plugin.dry_run && typeof data.plugin.dry_run === 'object'
			? data.plugin.dry_run
			: {};
		const ownership = data && data.ownership && typeof data.ownership === 'object' ? data.ownership : {};
		const dryRunSummary = dryRun.summary || null;
		const ownershipSummary = ownership.summary || null;
		const canApply = Boolean( applyGate.can_apply );
		const errors = [].concat(
			Array.isArray( data && data.errors ) ? data.errors : [],
			Array.isArray( applyGate.blocking_reasons ) ? applyGate.blocking_reasons : []
		);
		const warnings = [].concat(
			Array.isArray( data && data.warnings ) ? data.warnings : [],
			Array.isArray( applyGate.warnings ) ? applyGate.warnings : []
		);

		return [
			'<section class="factory-preview-bridge-panel">',
				'<div class="factory-preview-bridge-header">',
					'<div>',
						'<span>Read-only evidence</span>',
						'<h4>Runtime Preview Bridge</h4>',
						'<p>Read-only runtime evidence. No changes are applied. Bridge status may be error when runtime dependencies are missing.</p>',
					'</div>',
					'<button type="button" class="button button-secondary" data-factory-bridge-action="run"' + ( state.bridgePreviewLoading || state.betaAction ? ' disabled' : '' ) + '>',
						state.bridgePreviewLoading ? 'Checking runtime...' : 'Run read-only runtime preview',
					'</button>',
				'</div>',
				renderRuntimeReadinessNotice( 'bridge' ),
				state.bridgePreviewError ? '<div class="factory-wizard-notice factory-wizard-notice-warning">Preview Bridge request failed: ' + escapeHtml( state.bridgePreviewError ) + '</div>' : '',
				! data && ! state.bridgePreviewLoading && ! state.bridgePreviewError ? '<p class="factory-empty">Runtime Preview Bridge has not been run yet.</p>' : '',
				state.bridgePreviewLoading ? '<div class="factory-demo-progress" role="status" aria-live="polite"><span class="factory-demo-spinner" aria-hidden="true"></span><div><strong>Checking runtime evidence...</strong><span>No apply, generate, fix, reset, or manifest write is performed.</span></div></div>' : '',
				data ? [
					'<div class="factory-preview-bridge-status">',
						renderMetric( 'Bridge status', data.status || 'unknown' ),
						renderMetric( 'Applied', bridgeBooleanLabel( data.applied ) ),
						renderMetric( 'Runtime mutation', bridgeBooleanLabel( data.runtime_mutation ) ),
						renderMetric( 'Can apply', bridgeBooleanLabel( canApply ) ),
						renderMetric( 'Apply gate', applyGate.status || 'unknown' ),
						renderMetric( 'Next step', applyGate.next_required_step || '-' ),
					'</div>',
					'<div class="factory-preview-bridge-grid">',
						'<section>',
							'<div class="factory-card-heading"><h5>Dry-run summary</h5>' + bridgeStatusBadge( dryRun.status ) + '</div>',
							bridgeSummaryItems( dryRunSummary, [ 'create', 'update', 'delete', 'skip', 'warning', 'error' ] ),
						'</section>',
						'<section>',
							'<div class="factory-card-heading"><h5>Ownership summary</h5>' + bridgeStatusBadge( ownership.status ) + '</div>',
							bridgeSummaryItems( ownershipSummary, [ 'checked', 'safe', 'user_modified', 'locked', 'conflict', 'warning', 'error' ] ),
						'</section>',
					'</div>',
					bridgeMessageList( 'Errors', errors, 'error' ),
					bridgeMessageList( 'Warnings', warnings, 'warning' ),
					'<details class="factory-preview-bridge-raw"><summary>Raw Preview Bridge response</summary><pre></pre></details>',
				].join( '' ) : '',
			'</section>',
		].join( '' );
	}

	function renderFrontendLinks() {
		return [
			'<div class="factory-human-link-groups">',
				'<div>',
					'<h4>Primary pages</h4>',
					'<div class="factory-demo-links">',
						'<a href="' + escapeHtml( homeUrl( '/' ) ) + '" target="_blank" rel="noopener noreferrer">Open Home</a>',
						'<a href="' + escapeHtml( homeUrl( '/properties/' ) ) + '" target="_blank" rel="noopener noreferrer">Open Properties</a>',
						'<a href="' + escapeHtml( homeUrl( '/contact/' ) ) + '" target="_blank" rel="noopener noreferrer">Open Contact</a>',
					'</div>',
				'</div>',
				'<div>',
					'<h4>Proof links</h4>',
					'<div class="factory-demo-links factory-demo-links-secondary">',
						'<a class="factory-demo-link-experimental" href="' + escapeHtml( homeUrl( '/properties-native/' ) ) + '" target="_blank" rel="noopener noreferrer">Open Native Filters Proof</a>',
						'<a href="' + escapeHtml( homeUrl( '/property/turquoise-view-apartment-in-pechersk/' ) ) + '" target="_blank" rel="noopener noreferrer">Sample Apartment</a>',
						'<a href="' + escapeHtml( homeUrl( '/property/solomianskyi-business-office/' ) ) + '" target="_blank" rel="noopener noreferrer">Sample Commercial</a>',
					'</div>',
				'</div>',
			'</div>',
		].join( '' );
	}

	function renderHumanProofReport( run, validationOk, doctorOk, siteGenerated ) {
		const statusText = validationOk && doctorOk ? 'Validation passed' : 'Review validation status';
		const isBusy = Boolean( state.betaAction );

		if ( ! siteGenerated ) {
			return [
				'<div class="factory-human-report">',
					'<section class="factory-human-report-hero factory-human-report-hero-pending">',
						'<span>Proof pending</span>',
						'<h3>No generated site proof yet.</h3>',
						'<p>Generate the Real Estate demo to create pages, content, validation proof, and frontend links.</p>',
					'</section>',
					renderSafetyNotice( true ),
				'</div>',
			].join( '' );
		}

		return [
			'<div class="factory-human-report">',
				'<section class="factory-human-report-hero factory-human-report-hero-ready">',
					'<span>Your site is ready</span>',
					'<h3>Your Real Estate demo is ready.</h3>',
					'<p>' + escapeHtml( statusText ) + '. Latest generated proof: ' + escapeHtml( run.timestamp || run.file || '-' ) + '</p>',
				'</section>',
				'<div class="factory-human-proof-grid">',
					renderHumanReportCard(
						'Generated site summary',
						[
							'Home page ready',
							'Properties catalog ready',
							'Contact page ready',
							'Navigation menu ready',
							'Stable catalog filters and single property pages ready',
							'Request Viewing flow ready',
						],
						'generated'
					),
					renderHumanReportCard(
						'Visual setup',
						[
							styleContextSummary( run ),
							imageContextSummary( run ),
						],
						'inputs'
					),
				'</div>',
				renderFrontendLinks(),
				renderSafetyNotice( true ),
				'<div class="factory-human-secondary-actions">',
					'<button type="button" class="button" data-factory-beta-action="refresh"' + ( isBusy ? ' disabled' : '' ) + '>Refresh validation proof</button>',
					'<button type="button" class="button" data-factory-wizard-step="3"' + ( isBusy ? ' disabled' : '' ) + '>Back to edit setup</button>',
					'<button type="button" class="button" data-factory-toggle-advanced' + ( isBusy ? ' disabled' : '' ) + '>Show developer proof</button>',
				'</div>',
			'</div>',
		].join( '' );
	}

	function renderRawPlanDetails() {
		if ( ! state.betaPlan ) {
			return '';
		}

		const summary = state.betaPlan && state.betaPlan.summary ? state.betaPlan.summary : {};
		const items = state.betaPlan && Array.isArray( state.betaPlan.items ) ? state.betaPlan.items.slice( 0, 12 ) : [];

		return [
			'<details class="factory-raw-plan-details">',
				'<summary>Raw dry-run details</summary>',
				'<div class="factory-metric-grid factory-demo-metrics">',
					renderMetric( 'Create', summaryValue( summary, 'create' ) ),
					renderMetric( 'Update', summaryValue( summary, 'update' ) ),
					renderMetric( 'Skip', summaryValue( summary, 'skip' ) ),
					renderMetric( 'Warning', summaryValue( summary, 'warning' ) ),
					renderMetric( 'Error', summaryValue( summary, 'error' ) ),
				'</div>',
				items.length
					? '<ul class="factory-demo-plan-list">' + items.map( function ( item ) {
						return '<li><strong>' + escapeHtml( item.action || 'skip' ) + '</strong><span>' + escapeHtml( item.message || '' ) + '</span></li>';
					} ).join( '' ) + '</ul>'
					: '<p class="factory-empty">No raw plan items returned.</p>',
			'</details>',
		].join( '' );
	}

	function renderHeader() {
		const doctorStatus = doctorStatusValue();
		const latestStatus = runFromLatest().status || 'unknown';

		return [
			'<header class="factory-dashboard-header">',
				'<div>',
					'<h1>Crocoblock Site Factory</h1>',
					'<span class="factory-beta">Beta control panel</span>',
				'</div>',
				'<div class="factory-header-badges">',
					'<span>Doctor ' + badge( doctorStatus ) + '</span>',
					'<span>Latest run ' + badge( latestStatus ) + '</span>',
				'</div>',
			'</header>',
		].join( '' );
	}

	function renderErrors() {
		if ( ! state.errors.length ) {
			return '';
		}

		return '<section class="factory-card factory-card-error"><h2>Load Errors</h2><ul>' +
			state.errors.map( function ( error ) {
				return '<li>' + escapeHtml( error ) + '</li>';
			} ).join( '' ) +
			'</ul></section>';
	}

	function renderSystemStatus() {
		const doctor = state.doctor || {};
		const issues = Array.isArray( doctor.issues ) ? doctor.issues : [];
		const doctorStatus = doctorStatusValue();

		return [
			'<section class="factory-card">',
				'<div class="factory-card-heading"><h2>System Status</h2>' + badge( doctorStatus ) + '</div>',
				'<dl class="factory-definition-list">',
					'<dt>Latest run</dt><dd>' + escapeHtml( doctor.latest_run || '-' ) + '</dd>',
					'<dt>Prompt</dt><dd>' + escapeHtml( doctor.prompt || '-' ) + '</dd>',
				'</dl>',
				issues.length
					? '<ul class="factory-list">' + issues.map( function ( issue ) {
						return '<li>' + badge( issue.status ) + '<span>' + escapeHtml( issue.message || '' ) + '</span></li>';
					} ).join( '' ) + '</ul>'
					: '<p class="factory-empty">No drift issues reported.</p>',
			'</section>',
		].join( '' );
	}

	function renderFirstRunEmptyState() {
		if ( ! state.noRunsYet ) {
			return '';
		}

		return [
			'<section class="factory-card factory-card-wide factory-first-run-empty">',
				'<h2>No validation proof yet</h2>',
				'<p>No runs yet. Generate a demo to create the first validation proof.</p>',
			'</section>',
		].join( '' );
	}

	function requirementBadgeClass( status ) {
		if ( status === 'active' ) {
			return 'ok';
		}

		if ( status === 'inactive' ) {
			return 'warning';
		}

		if ( status === 'missing' ) {
			return 'error';
		}

		return 'unknown';
	}

	function requirementStatusLabel( status ) {
		const labels = {
			active: 'Active',
			missing: 'Missing',
			inactive: 'Inactive',
			optional_missing: 'Optional missing',
			unknown: 'Unknown',
		};

		return labels[ status ] || 'Unknown';
	}

	function requirementFallbackItems() {
		return [
			{
				key: 'kava',
				label: 'Kava theme',
				required: true,
				status: 'unknown',
				message: 'Kava theme status is unknown.',
			},
			{
				key: 'jet_engine',
				label: 'JetEngine',
				required: true,
				status: 'unknown',
				message: 'JetEngine status is unknown.',
			},
			{
				key: 'jetsmartfilters',
				label: 'JetSmartFilters',
				required: false,
				status: 'unknown',
				message: 'Stable /properties/ catalog still works. Native filters proof requires JetSmartFilters.',
			},
			{
				key: 'jetformbuilder',
				label: 'JetFormBuilder',
				required: false,
				status: 'unknown',
				message: 'Request Viewing form enhancements require JetFormBuilder.',
			},
		];
	}

	function renderDependencyRows() {
		const items = state.requirements && Array.isArray( state.requirements.items )
			? state.requirements.items
			: requirementFallbackItems();

		return '<div class="factory-wizard-requirements">' + items.map( function ( item ) {
			const status = item.status || 'unknown';
			const badgeClass = requirementBadgeClass( status );

			return [
				'<article class="factory-requirement-card factory-requirement-card-' + escapeHtml( badgeClass ) + '">',
					'<div>',
						'<div class="factory-requirement-meta">' + ( item.required ? 'Required' : 'Optional' ) + '</div>',
						'<strong>' + escapeHtml( item.label || item.key || 'Requirement' ) + '</strong>',
						'<p>' + escapeHtml( item.message || 'Status unknown.' ) + '</p>',
					'</div>',
					'<span class="factory-badge factory-badge-' + escapeHtml( badgeClass ) + '">' + escapeHtml( requirementStatusLabel( status ) ) + '</span>',
				'</article>',
			].join( '' );
		} ).join( '' ) + '</div>';
	}

	function aiModelLabel( key ) {
		const settings = state.aiSettings || {};
		const models = Array.isArray( settings.available_models ) ? settings.available_models : [];
		const model = models.find( function ( item ) {
			return item.key === key;
		} );

		return model ? model.label || model.key : ( key || 'Balanced' );
	}

	function aiKeySourceLabel( source ) {
		const labels = {
			constant: 'constant',
			env: 'env',
			option: 'saved',
			none: 'none',
		};

		return labels[ source ] || 'unknown';
	}

	function renderAIStatusCard() {
		const settings = state.aiSettings || {};
		const hasKey = Boolean( settings.has_key );
		const statusLabel = hasKey ? 'Configured' : 'Not configured';
		const statusClass = hasKey ? 'ok' : 'unknown';
		const provider = settings.provider === 'openai' ? 'OpenAI' : ( settings.provider || 'OpenAI' );
		const selectedModel = settings.selected_model || 'balanced';
		const maskedKey = settings.masked_key || '';
		const keySource = aiKeySourceLabel( settings.key_source || 'none' );

		if ( state.aiSettingsError ) {
			return [
				'<article class="factory-ai-status-card factory-ai-status-card-unknown">',
					'<div>',
						'<div class="factory-requirement-meta">Informational</div>',
						'<strong>AI assistance</strong>',
						'<p>Unable to verify AI settings. The deterministic Real Estate preset still works.</p>',
					'</div>',
					'<span class="factory-badge factory-badge-unknown">Unknown</span>',
				'</article>',
			].join( '' );
		}

		return [
			'<article class="factory-ai-status-card factory-ai-status-card-' + escapeHtml( statusClass ) + '">',
				'<div class="factory-ai-status-main">',
					'<div class="factory-requirement-meta">Informational only</div>',
					'<strong>AI assistance</strong>',
					'<p>' + ( hasKey ? 'Configured for future assisted generation. Current Real Estate generation is deterministic.' : 'Not configured. The deterministic Real Estate demo still works.' ) + '</p>',
					'<dl class="factory-ai-status-meta">',
						'<dt>Provider</dt><dd>' + escapeHtml( provider ) + '</dd>',
						'<dt>Model profile</dt><dd>' + escapeHtml( aiModelLabel( selectedModel ) ) + '</dd>',
						'<dt>Key source</dt><dd>' + escapeHtml( keySource ) + '</dd>',
						'<dt>External provider calls</dt><dd>Disabled in this beta</dd>',
						'<dt>Token spending risk during Generate</dt><dd>None</dd>',
						hasKey && maskedKey ? '<dt>Masked key</dt><dd><code>' + escapeHtml( maskedKey ) + '</code></dd>' : '',
					'</dl>',
					'<p class="factory-ai-status-note">Saved API keys are not used when generating the Real Estate demo in this beta.</p>',
				'</div>',
				'<div class="factory-ai-status-actions">',
					'<span class="factory-badge factory-badge-' + escapeHtml( statusClass ) + '">' + escapeHtml( statusLabel ) + '</span>',
					! hasKey ? '<a class="button button-secondary" href="admin.php?page=factory-ai-settings">AI Settings</a>' : '<a class="button button-secondary" href="admin.php?page=factory-ai-settings">Manage</a>',
				'</div>',
			'</article>',
		].join( '' );
	}

	function renderWizardStepper() {
		return [
			'<nav class="factory-wizard-stepper" aria-label="Generation wizard steps">',
				wizardSteps.map( function ( step, index ) {
					const isCurrent = index === state.wizardStep;
					const isDone = index < state.wizardStep || index <= state.maxWizardStep;
					const isReachable = canVisitWizardStep( index, false );
					const isNextAvailable = ! state.betaAction && ! isCurrent && index === state.wizardStep + 1 && canVisitWizardStep( index, true );
					const isLocked = ! isReachable && ! isNextAvailable;
					const classes = [
						'factory-wizard-step',
						isCurrent ? 'factory-wizard-step-current' : '',
						isDone && ! isCurrent ? 'factory-wizard-step-done' : '',
						isNextAvailable ? 'factory-wizard-step--next-available' : '',
						isLocked ? 'factory-wizard-step-locked' : '',
					].filter( Boolean ).join( ' ' );
					const label = isNextAvailable ? 'Continue to ' + step.title : 'Go to ' + step.title;

					return [
						'<button type="button" class="' + escapeHtml( classes ) + '" data-factory-wizard-step="' + escapeHtml( index ) + '"' + ( isNextAvailable ? ' data-factory-wizard-next-available="true"' : '' ) + ' aria-label="' + escapeHtml( label ) + '" title="' + escapeHtml( label ) + '"' + ( isLocked || state.betaAction ? ' disabled' : '' ) + '>',
							'<span>' + escapeHtml( index + 1 ) + '</span>',
							'<strong>' + escapeHtml( step.title ) + '</strong>',
							'<small>' + escapeHtml( step.subtitle ) + '</small>',
							isNextAvailable ? '<em>Next step</em>' : '',
						'</button>',
					].join( '' );
				} ).join( '' ),
			'</nav>',
		].join( '' );
	}

	function renderWizardControls() {
		const isBusy = Boolean( state.betaAction );
		const isLast = state.wizardStep >= wizardSteps.length - 1;
		const nextStep = state.wizardStep + 1;
		const nextDisabled = isBusy || ( ! isLast && ! canVisitWizardStep( nextStep, true ) );

		return [
			'<div class="factory-wizard-controls">',
				'<button type="button" class="button" data-factory-wizard-back' + ( state.wizardStep === 0 || isBusy ? ' disabled' : '' ) + '>Back</button>',
				isLast
					? ''
					: '<button type="button" class="button button-primary" data-factory-wizard-next' + ( nextDisabled ? ' disabled' : '' ) + '>Next</button>',
			'</div>',
		].join( '' );
	}

	function renderWizardNotice() {
		if ( isPreviewCurrent() ) {
			return '<div class="factory-wizard-notice factory-wizard-notice-ok">Preview is current for this prompt and safe variables.</div>';
		}

		if ( state.previewStale ) {
			return '<div class="factory-wizard-notice factory-wizard-notice-warning">Preview needs refresh.</div>';
		}

		return '<div class="factory-wizard-notice">Preview this setup before generating.</div>';
	}

	function renderWillChangeSummary() {
		return [
			'<div class="factory-wizard-change-grid">',
				'<section>',
					'<h4>Will change</h4>',
					'<ul>',
						'<li>Selected Home hero copy</li>',
						'<li>Selected Contact page copy</li>',
						'<li>Generated Factory component color tokens</li>',
						'<li>Bundled image pool proof context</li>',
						'<li>Run manifest prompt and safe variable proof</li>',
						'<li>Generated pages when Generate runs</li>',
					'</ul>',
				'</section>',
				'<section>',
					'<h4>Will not change</h4>',
					'<ul>',
						'<li>CPT, taxonomy, meta, Query Builder, filters, forms, listings, site-wide theme settings, and adapter order</li>',
						'<li>Property count, property titles, content, districts, terms, images, and native proof page behavior</li>',
						'<li>Image uploads, Media Library picker, ZIP import, AI generation, and external image APIs</li>',
						'<li>/properties/, /properties-native/, and /contact/ routing behavior</li>',
					'</ul>',
				'</section>',
			'</div>',
		].join( '' );
	}

	function renderVerticalSelector() {
		return [
			'<div class="factory-vertical-selector">',
				verticals.map( function ( vertical ) {
					const isAvailable = vertical.status === 'available';
					const isSelected = state.selectedVertical === vertical.id;
					const classes = [
						'factory-vertical-card',
						isAvailable ? 'factory-vertical-card-available' : 'factory-vertical-card-disabled',
						isSelected ? 'factory-vertical-card-selected' : '',
					].filter( Boolean ).join( ' ' );
					const statusLabel = isAvailable ? 'Available' : 'Coming soon';
					const ariaLabel = isAvailable ? 'Select ' + vertical.label : vertical.label + ' coming soon';

					return [
						'<button type="button" class="' + escapeHtml( classes ) + '" data-factory-vertical="' + escapeHtml( vertical.id ) + '" aria-pressed="' + ( isSelected ? 'true' : 'false' ) + '" aria-label="' + escapeHtml( ariaLabel ) + '">',
							'<span class="factory-vertical-badge factory-vertical-badge-' + escapeHtml( isAvailable ? 'available' : 'soon' ) + '">' + escapeHtml( statusLabel ) + '</span>',
							'<strong>' + escapeHtml( vertical.label ) + '</strong>',
							'<p>' + escapeHtml( vertical.description ) + '</p>',
						'</button>',
					].join( '' );
				} ).join( '' ),
			'</div>',
			state.verticalNotice ? '<div class="factory-wizard-notice">' + escapeHtml( state.verticalNotice ) + '</div>' : '',
		].join( '' );
	}

	function renderWizardStepContent() {
		const step = state.wizardStep;
		const run = runFromLatest();
		const plan = run.plan && run.plan.summary ? run.plan.summary : {};
		const results = run.results && run.results.summary ? run.results.summary : {};
		const siteGenerated = Boolean( run.file ) && executionCount( run ) > 0;
		const doctorOk = doctorStatusValue() === 'ok';
		const validationOk = latestValidationOk();
		const isBusy = Boolean( state.betaAction );

		if ( step === 0 ) {
			return [
				'<section class="factory-wizard-step-panel">',
					'<h3>Choose website type</h3>',
					'<p>Select the kind of site Site Factory should generate. Real Estate is available now; other verticals are shown for product direction only.</p>',
					renderVerticalSelector(),
				'</section>',
			].join( '' );
		}

		if ( step === 1 ) {
			const summary = state.requirements
				? state.requirements.summary || 'Requirements checked.'
				: ( state.requirementsError ? 'Unable to verify requirements.' : 'Checking requirements...' );

			return [
				'<section class="factory-wizard-step-panel">',
					'<h3>Required setup for Real Estate</h3>',
					'<p>Kava and JetEngine are required for this beta. JetSmartFilters and JetFormBuilder are optional; the generated site keeps working through safe fallbacks.</p>',
					'<div class="factory-requirements-summary ' + ( isRequirementsReady() ? 'factory-requirements-summary-ready' : 'factory-requirements-summary-attention' ) + '">',
						escapeHtml( summary ),
					'</div>',
					renderDependencyRows(),
					renderAIStatusCard(),
					state.requirementsError ? '<p class="factory-empty">Requirements check failed: ' + escapeHtml( state.requirementsError ) + '</p>' : '',
					'<p class="factory-empty">No install or activation actions are available in this beta. Install required dependencies in WordPress, then refresh this dashboard.</p>',
				'</section>',
			].join( '' );
		}

		if ( step === 2 ) {
			return [
				'<section class="factory-wizard-step-panel">',
					'<h3>Describe business</h3>',
					'<div class="factory-wizard-fixed-choice"><span>Selected website type</span><strong>Real Estate</strong><small>Deterministic Real Estate preset is used for this beta.</small></div>',
					renderPromptPreview(),
				'</section>',
			].join( '' );
		}

		if ( step === 3 ) {
			return [
				'<section class="factory-wizard-step-panel">',
					'<h3>Business info</h3>',
					'<p>These fields are the only copy variables applied in this phase.</p>',
					renderPresetVariables(),
				'</section>',
			].join( '' );
		}

		if ( step === 4 ) {
			return [
				'<section class="factory-wizard-step-panel">',
					renderStyleContext(),
				'</section>',
			].join( '' );
		}

		if ( step === 5 ) {
			return [
				'<section class="factory-wizard-step-panel">',
					renderImageContext(),
				'</section>',
			].join( '' );
		}

		if ( step === 6 ) {
			return [
				'<section class="factory-wizard-step-panel">',
					'<div class="factory-wizard-step-heading">',
						'<div><h3>Preview plan</h3><p>Review the prepared Real Estate preset, captured prompt, safe variables, and guardrails before generation.</p></div>',
						'<button type="button" class="button button-primary" data-factory-beta-action="plan"' + ( isBusy ? ' disabled' : '' ) + '>',
							state.betaAction === 'plan' ? 'Previewing...' : 'Preview plan',
						'</button>',
					'</div>',
					renderBetaMessage(),
					renderWizardNotice(),
					renderHumanPreviewReport(),
					renderPreviewBridgePanel(),
				'</section>',
			].join( '' );
		}

		return [
			'<section class="factory-wizard-step-panel">',
				'<div class="factory-wizard-step-heading">',
					'<div><h3>Generate / Proof</h3><p>Create the deterministic Real Estate demo, refresh validation proof, and open the generated frontend.</p></div>',
					'<div class="factory-demo-actions">',
						'<button type="button" class="button button-primary" data-factory-beta-action="apply"' + ( isBusy || ! isPreviewCurrent() || ! isRequirementsReady() ? ' disabled' : '' ) + '>',
							state.betaAction === 'apply' ? 'Generating...' : 'Generate Real Estate Demo',
						'</button>',
						'<button type="button" class="button" data-factory-beta-action="refresh"' + ( isBusy ? ' disabled' : '' ) + '>',
							state.betaAction === 'refresh' ? 'Refreshing...' : 'Refresh validation proof',
						'</button>',
					'</div>',
				'</div>',
				renderBetaMessage(),
				renderGenerationProgress(),
				! isRequirementsReady() ? '<div class="factory-wizard-notice factory-wizard-notice-warning">Required setup needed before generation.</div>' : '',
				renderWizardNotice(),
				renderRuntimeReadinessNotice( 'step6' ),
				'<div class="factory-demo-statuses factory-demo-statuses-inline">',
					renderDemoStatus( 'Site generated', siteGenerated ),
					renderDemoStatus( 'Validation OK', validationOk ),
					renderDemoStatus( 'Doctor OK', doctorOk ),
				'</div>',
				renderHumanProofReport( run, validationOk, doctorOk, siteGenerated ),
			'</section>',
		].join( '' );
	}

	function renderRealEstateDemo() {
		const run = runFromLatest();
		const siteGenerated = Boolean( run.file ) && executionCount( run ) > 0;
		const doctorOk = doctorStatusValue() === 'ok';
		const validationOk = latestValidationOk();

		return [
			'<section class="factory-card factory-card-wide factory-demo-panel">',
				'<div class="factory-demo-header">',
					'<div>',
						'<span class="factory-demo-kicker">Generation wizard</span>',
						'<h2>Real Estate Beta Demo</h2>',
						'<p>Create, preview, verify, and open the generated real estate catalog through a guided flow.</p>',
					'</div>',
					'<div class="factory-demo-statuses">',
						renderDemoStatus( 'Site generated', siteGenerated ),
						renderDemoStatus( 'Validation OK', validationOk ),
						renderDemoStatus( 'Doctor OK', doctorOk ),
					'</div>',
				'</div>',
				renderWizardStepper(),
				renderWizardStepContent(),
				renderWizardControls(),
			'</section>',
		].join( '' );
	}

	function renderLatestRun() {
		const run = runFromLatest();
		const plan = run.plan && run.plan.summary ? run.plan.summary : {};
		const execution = run.execution || {};
		const validation = run.validation || {};
		const results = run.results && run.results.summary ? run.results.summary : {};

		return [
			'<section class="factory-card">',
				'<div class="factory-card-heading"><h2>Latest Validation Summary</h2>' + badge( run.status ) + '</div>',
				'<dl class="factory-definition-list">',
					'<dt>File</dt><dd>' + escapeHtml( run.file || '-' ) + '</dd>',
					'<dt>Timestamp</dt><dd>' + escapeHtml( run.timestamp || '-' ) + '</dd>',
					'<dt>Prompt</dt><dd>' + escapeHtml( run.prompt || '-' ) + '</dd>',
					'<dt>Safe variables</dt><dd>' + escapeHtml( promptContextSummary( run ) ) + '</dd>',
				'</dl>',
				'<div class="factory-metric-grid">',
					renderMetric( 'Plan', planSummaryText( plan ) ),
					renderMetric( 'Execution', execution.count ?? count( execution.items ) ),
					renderMetric( 'Validation', validation.count ?? count( validation.checks ) ),
					renderMetric( 'Results', resultsSummaryText( results ) ),
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderRunsTable() {
		if ( ! state.runs.length ) {
			return '<section class="factory-card factory-card-wide"><h2>Run History</h2><p class="factory-empty">No runs found.</p></section>';
		}

		return [
			'<section class="factory-card factory-card-wide">',
				'<h2>Run History</h2>',
				'<div class="factory-table-wrap">',
					'<table class="factory-table">',
						'<thead><tr>',
							'<th>Status</th><th>Timestamp</th><th>Prompt</th><th>Plan</th><th>Execution</th><th>Validation</th><th>File</th>',
						'</tr></thead>',
						'<tbody>',
							state.runs.map( function ( run ) {
								const selected = run.file && run.file === state.selectedFile ? ' factory-row-selected' : '';
								return '<tr class="factory-run-row' + selected + '" data-file="' + escapeHtml( run.file || '' ) + '">' +
									'<td>' + badge( run.status ) + '</td>' +
									'<td>' + escapeHtml( run.timestamp || '-' ) + '</td>' +
									'<td>' + escapeHtml( run.prompt || '-' ) + '</td>' +
									'<td>' + escapeHtml( planSummaryText( run.plan_summary || {} ) ) + '</td>' +
									'<td>' + escapeHtml( run.execution_count ?? 0 ) + '</td>' +
									'<td>' + escapeHtml( run.validation_count ?? 0 ) + '</td>' +
									'<td><code>' + escapeHtml( run.file || '-' ) + '</code></td>' +
								'</tr>';
							} ).join( '' ),
						'</tbody>',
					'</table>',
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderExecutionItems( items ) {
		if ( ! Array.isArray( items ) || ! items.length ) {
			return '<p class="factory-empty">No execution items.</p>';
		}

		return '<ul class="factory-event-list">' + items.map( function ( item ) {
			const parts = [ item.action, item.type, item.entity ].filter( Boolean ).join( ' ' );
			return '<li>' + badge( item.status ) + '<div><strong>' + escapeHtml( parts || '-' ) + '</strong><span>' + escapeHtml( item.message || '' ) + '</span></div></li>';
		} ).join( '' ) + '</ul>';
	}

	function renderValidationItems( checks ) {
		if ( ! Array.isArray( checks ) || ! checks.length ) {
			return '<p class="factory-empty">No validation checks.</p>';
		}

		return '<ul class="factory-event-list">' + checks.map( function ( check ) {
			return '<li>' + badge( check.status ) + '<span>' + escapeHtml( check.message || '' ) + '</span></li>';
		} ).join( '' ) + '</ul>';
	}

	function renderSelectedRun() {
		if ( state.loadingDetails ) {
			return '<section class="factory-card factory-card-wide"><h2>Selected Run Details</h2><p class="factory-empty">Loading run details...</p></section>';
		}

		const run = state.selectedRun && state.selectedRun.run ? state.selectedRun.run : runFromLatest();

		if ( ! run || ! Object.keys( run ).length ) {
			return '<section class="factory-card factory-card-wide"><h2>Selected Run Details</h2><p class="factory-empty">Select a run to inspect details.</p></section>';
		}

		const plan = run.plan && run.plan.summary ? run.plan.summary : {};
		const executionItems = run.execution && Array.isArray( run.execution.items ) ? run.execution.items : [];
		const validationChecks = run.validation && Array.isArray( run.validation.checks ) ? run.validation.checks : [];
		const results = run.results && run.results.summary ? run.results.summary : {};
		const blueprint = run.blueprint ? JSON.stringify( run.blueprint, null, 2 ) : '';

		return [
			'<section class="factory-card factory-card-wide">',
				'<div class="factory-card-heading"><h2>Selected Run Details</h2>' + badge( run.status ) + '</div>',
				'<dl class="factory-definition-list factory-definition-list-wide">',
					'<dt>File</dt><dd>' + escapeHtml( run.file || '-' ) + '</dd>',
					'<dt>Prompt</dt><dd>' + escapeHtml( run.prompt || '-' ) + '</dd>',
					'<dt>Safe variables</dt><dd>' + escapeHtml( promptContextSummary( run ) ) + '</dd>',
					'<dt>Plan</dt><dd>' + escapeHtml( planSummaryText( plan ) ) + '</dd>',
					'<dt>Results</dt><dd>' + escapeHtml( resultsSummaryText( results ) ) + '</dd>',
				'</dl>',
				'<div class="factory-detail-grid">',
					'<div><h3>Execution Trace</h3>' + renderExecutionItems( executionItems ) + '</div>',
					'<div><h3>Validation Proof</h3>' + renderValidationItems( validationChecks ) + '</div>',
				'</div>',
				blueprint ? '<details class="factory-blueprint"><summary>Blueprint preview</summary><pre></pre></details>' : '',
			'</section>',
		].join( '' );
	}

	function renderAdapters() {
		if ( ! state.adapters.length ) {
			return '<section class="factory-card factory-card-wide"><h2>Adapter Overview</h2><p class="factory-empty">No adapter data available.</p></section>';
		}

		return [
			'<section class="factory-card factory-card-wide">',
				'<h2>Adapter Overview</h2>',
				'<div class="factory-adapter-grid">',
					state.adapters.map( function ( adapter ) {
						const key = adapter.key || adapter.adapter || adapter.class || 'adapter';
						return '<article class="factory-adapter">' +
							'<div class="factory-card-heading"><h3>' + escapeHtml( key ) + '</h3>' + badge( adapter.contract_ready ? 'ok' : 'warning' ) + '</div>' +
							'<code>' + escapeHtml( adapter.class || '-' ) + '</code>' +
							'<div class="factory-adapter-flags">' +
								'<span>register ' + badge( adapter.has_register ? 'ok' : 'unknown' ) + '</span>' +
								'<span>apply ' + badge( adapter.has_apply ? 'ok' : 'unknown' ) + '</span>' +
								'<span>validate ' + badge( adapter.has_validate ? 'ok' : 'unknown' ) + '</span>' +
								'<span>plan ' + badge( adapter.has_plan ? 'ok' : 'unknown' ) + '</span>' +
							'</div>' +
						'</article>';
					} ).join( '' ),
				'</div>',
			'</section>',
		].join( '' );
	}

	function renderAdvancedProof() {
		const expanded = Boolean( state.advancedOpen );

		return [
			'<section class="factory-advanced-panel">',
				'<div class="factory-advanced-header">',
					'<div>',
						'<span>Advanced</span>',
						'<h2>Developer proof</h2>',
						'<p>Execution trace, validation checks, blueprint data, run history, and adapter diagnostics.</p>',
					'</div>',
					'<button type="button" class="button factory-advanced-toggle" data-factory-toggle-advanced aria-expanded="' + ( expanded ? 'true' : 'false' ) + '">',
						expanded ? 'Hide developer proof' : 'Show developer proof',
					'</button>',
				'</div>',
				expanded
					? '<div class="factory-advanced-body">' +
						renderRawPlanDetails() +
						renderRunsTable() +
						renderSelectedRun() +
						renderAdapters() +
					'</div>'
					: '',
			'</section>',
		].join( '' );
	}

	function render() {
		root.innerHTML = [
			renderHeader(),
			renderErrors(),
			renderFirstRunEmptyState(),
			renderRealEstateDemo(),
			'<div class="factory-grid">',
				renderSystemStatus(),
				renderLatestRun(),
			'</div>',
			renderAdvancedProof(),
		].join( '' );

		const blueprintPre = root.querySelector( '.factory-blueprint pre' );
		const selected = state.selectedRun && state.selectedRun.run ? state.selectedRun.run : runFromLatest();

		if ( blueprintPre && selected && selected.blueprint ) {
			blueprintPre.textContent = JSON.stringify( selected.blueprint, null, 2 );
		}

		const bridgePre = root.querySelector( '.factory-preview-bridge-raw pre' );

		if ( bridgePre && state.bridgePreviewData ) {
			bridgePre.textContent = JSON.stringify( state.bridgePreviewData, null, 2 );
		}

		root.querySelectorAll( '.factory-run-row' ).forEach( function ( row ) {
			row.addEventListener( 'click', function () {
				const file = row.getAttribute( 'data-file' );

				if ( file ) {
					loadRunDetails( file );
				}
			} );
		} );

		root.querySelectorAll( '[data-factory-toggle-advanced]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				state.advancedOpen = ! state.advancedOpen;
				render();
			} );
		} );

		root.querySelectorAll( '[data-factory-vertical]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				const verticalId = button.getAttribute( 'data-factory-vertical' );
				const vertical = verticals.find( function ( item ) {
					return item.id === verticalId;
				} );

				if ( ! vertical || vertical.status !== 'available' ) {
					state.verticalNotice = vertical ? vertical.label + ' is coming soon. Real Estate is the available beta vertical.' : 'This vertical is coming soon.';
					render();
					return;
				}

				state.selectedVertical = vertical.id;
				state.verticalNotice = '';
				render();
			} );
		} );

		root.querySelectorAll( '[data-factory-wizard-step]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				const allowNext = button.getAttribute( 'data-factory-wizard-next-available' ) === 'true';
				goWizardStep( Number( button.getAttribute( 'data-factory-wizard-step' ) ), allowNext );
			} );
		} );

		root.querySelectorAll( '[data-factory-wizard-back]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				goWizardStep( state.wizardStep - 1 );
			} );
		} );

		root.querySelectorAll( '[data-factory-wizard-next]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				goWizardStep( state.wizardStep + 1, true );
			} );
		} );

		root.querySelectorAll( '[data-factory-prompt]' ).forEach( function ( textarea ) {
			textarea.addEventListener( 'input', function () {
				state.prompt = textarea.value;
				updatePreviewFreshness();
			} );
		} );

		root.querySelectorAll( '[data-factory-preset-variable]' ).forEach( function ( field ) {
			field.addEventListener( 'input', function () {
				const key = field.getAttribute( 'data-factory-preset-variable' );

				if ( key ) {
					state.presetVariables[ key ] = field.value;
					updatePreviewFreshness();
				}
			} );
		} );

		root.querySelectorAll( '[data-factory-style-context]' ).forEach( function ( field ) {
			field.addEventListener( 'change', function () {
				const key = field.getAttribute( 'data-factory-style-context' );

				if ( key ) {
					state.styleContext[ key ] = field.value;
					updatePreviewFreshness();
					render();
				}
			} );
		} );

		root.querySelectorAll( '[data-factory-ai-action]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				const action = button.getAttribute( 'data-factory-ai-action' );

				if ( action === 'interpret' ) {
					interpretPrompt();
				}
			} );
		} );

		root.querySelectorAll( '[data-factory-bridge-action]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				const action = button.getAttribute( 'data-factory-bridge-action' );

				if ( action === 'run' ) {
					runPreviewBridge();
				}
			} );
		} );

		root.querySelectorAll( '[data-factory-apply-interpretation]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				applyPromptInterpretation( button.getAttribute( 'data-factory-apply-interpretation' ) );
			} );
		} );

		root.querySelectorAll( '[data-factory-beta-action]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				const action = button.getAttribute( 'data-factory-beta-action' );

				if ( action === 'plan' ) {
					previewRealEstatePlan();
				} else if ( action === 'apply' ) {
					applyRealEstatePreset();
				} else if ( action === 'refresh' ) {
					refreshValidationProof();
				}
			} );
		} );
	}

	function loadRunDetails( file ) {
		const path = ( config.endpoints && config.endpoints.run ? config.endpoints.run : '/run/{file}' )
			.replace( '{file}', encodeURIComponent( file ) );

		state.selectedFile = file;
		state.loadingDetails = true;
		render();

		request( path )
			.then( function ( data ) {
				state.selectedRun = data;
			} )
			.catch( function ( error ) {
				state.errors.push( 'Run details: ' + error.message );
			} )
			.finally( function () {
				state.loadingDetails = false;
				render();
			} );
	}

	function setBetaMessage( status, message ) {
		state.betaMessage = {
			status: status,
			message: message,
		};
	}

	function markLastAction() {
		state.lastActionAt = new Date().toLocaleString();
	}

	function currentPrompt() {
		const field = root.querySelector( '[data-factory-prompt]' );
		const prompt = field ? field.value : state.prompt;
		state.prompt = String( prompt || '' );

		return state.prompt;
	}

	function currentPresetVariables() {
		const variables = Object.assign( {}, state.presetVariables );

		root.querySelectorAll( '[data-factory-preset-variable]' ).forEach( function ( field ) {
			const key = field.getAttribute( 'data-factory-preset-variable' );

			if ( key ) {
				variables[ key ] = field.value;
			}
		} );

		state.presetVariables = variables;

		return variables;
	}

	function currentStyleContext() {
		const context = Object.assign( {}, state.styleContext );

		root.querySelectorAll( '[data-factory-style-context]:checked' ).forEach( function ( field ) {
			const key = field.getAttribute( 'data-factory-style-context' );

			if ( key ) {
				context[ key ] = field.value;
			}
		} );

		state.styleContext = context;

		return context;
	}

	function currentImageContext() {
		state.imageContext = Object.assign( {}, defaultImageContext, state.imageContext );

		return state.imageContext;
	}

	function interpretPrompt() {
		const prompt = currentPrompt();
		const presetVariables = currentPresetVariables();
		const styleContext = currentStyleContext();
		const imageContext = currentImageContext();

		state.promptAnalyzing = true;
		state.promptInterpretationError = '';
		state.promptInterpretationWarnings = [];
		state.promptInterpretationNotices = [];
		render();

		request(
			config.endpoints?.aiInterpretPrompt || '/ai/interpret-prompt',
			{
				method: 'POST',
				body: {
					prompt: prompt,
					current_context: {
						preset: 'real-estate',
						preset_variables: presetVariables,
						style_context: styleContext,
						image_context: imageContext,
					},
					mode: 'local_mock',
				},
			}
		)
			.then( function ( data ) {
				state.promptInterpretation = data.interpretation || null;
				state.promptInterpretationWarnings = Array.isArray( data.warnings ) ? data.warnings : [];
				state.promptInterpretationNotices = Array.isArray( data.notices ) ? data.notices : [];
			} )
			.catch( function ( error ) {
				state.promptInterpretation = null;
				state.promptInterpretationError = error.message;
			} )
			.finally( function () {
				state.promptAnalyzing = false;
				render();
			} );
	}

	function applyPromptInterpretation( group ) {
		const interpretation = state.promptInterpretation;

		if ( ! interpretation ) {
			return;
		}

		if ( group === 'copy' ) {
			const suggestions = interpretation.safe_preset_variable_suggestions || {};
			[ 'agency_name', 'hero_title', 'hero_subtitle', 'contact_title', 'contact_intro' ].forEach( function ( key ) {
				const value = suggestionValue( suggestions[ key ] );

				if ( value ) {
					state.presetVariables[ key ] = value;
				}
			} );
		}

		if ( group === 'style' ) {
			const suggestions = interpretation.safe_style_context_suggestions || {};
			const tone = suggestionValue( suggestions.tone );
			const primaryPreset = suggestionValue( suggestions.primary_preset );

			if ( styleToneOverrides[ tone ] ) {
				state.styleContext.tone = tone;
			}

			if ( colorPresetTokens[ primaryPreset ] ) {
				state.styleContext.primary_preset = primaryPreset;
			}
		}

		updatePreviewFreshness();
		state.promptInterpretationNotices = [ 'Suggestions applied to dashboard fields. Run Preview before Generate.' ];
		render();
	}

	function runPreviewBridge() {
		state.bridgePreviewLoading = true;
		state.bridgePreviewError = '';
		render();

		request(
			config.endpoints?.previewBridge || '/preview-bridge',
			{
				method: 'POST',
				body: {
					preset: 'real-estate',
				},
			}
		)
			.then( function ( data ) {
				state.bridgePreviewData = data || null;
			} )
			.catch( function ( error ) {
				state.bridgePreviewError = error.message;
			} )
			.finally( function () {
				state.bridgePreviewLoading = false;
				render();
			} );
	}

	function previewRealEstatePlan() {
		const prompt = currentPrompt();
		const presetVariables = currentPresetVariables();
		const styleContext = currentStyleContext();
		const imageContext = currentImageContext();
		const payloadKey = currentPayloadKeyFromState();
		state.betaAction = 'plan';
		state.betaMessage = null;
		render();

		request(
			config.endpoints?.realEstatePlan || '/beta/real-estate/plan',
			{
				method: 'POST',
				body: {
					prompt: prompt,
					preset_variables: presetVariables,
					style_context: styleContext,
					image_context: imageContext,
				},
			}
		)
			.then( function ( data ) {
				state.betaPlan = data.plan || null;
				state.betaProductPlan = data.product_plan || null;
				state.previewPayloadKey = payloadKey;
				state.previewStale = false;
				markWizardProgress( 7 );
				markLastAction();
				setBetaMessage( 'ok', 'Preview plan generated.' );
			} )
			.catch( function ( error ) {
				setBetaMessage( 'error', 'Preview plan failed: ' + error.message );
			} )
			.finally( function () {
				state.betaAction = '';
				render();
			} );
	}

	function applyRealEstatePreset() {
		const prompt = currentPrompt();
		const presetVariables = currentPresetVariables();
		const styleContext = currentStyleContext();
		const imageContext = currentImageContext();

		if ( ! isPreviewCurrent() ) {
			state.betaMessage = {
				status: 'warning',
				message: 'Preview needs refresh.',
			};
			render();
			return;
		}

		if ( ! isRequirementsReady() ) {
			state.betaMessage = {
				status: 'warning',
				message: 'Required setup needed before generation.',
			};
			render();
			return;
		}

		state.betaAction = 'apply';
		state.betaMessage = null;
		render();

		request(
			config.endpoints?.realEstateApply || '/beta/real-estate/apply',
			{
				method: 'POST',
				body: {
					prompt: prompt,
					preset_variables: presetVariables,
					style_context: styleContext,
					image_context: imageContext,
				},
			}
		)
			.then( function ( data ) {
				state.betaPlan = data.plan_summary
					? {
						summary: data.plan_summary,
						items: [],
					}
					: state.betaPlan;
				markLastAction();
				if ( statusValue( data.status ) === 'error' ) {
					setBetaMessage( 'error', data.message || 'Real Estate demo generation failed.' );
				} else {
					setBetaMessage( 'ok', 'Real Estate demo generated successfully.' );
				}
				state.wizardStep = 7;
				markWizardProgress( 7 );
				return refreshDashboardData();
			} )
			.catch( function ( error ) {
				setBetaMessage( 'error', 'Apply preset failed: ' + error.message );
			} )
			.finally( function () {
				state.betaAction = '';
				render();
			} );
	}

	function refreshValidationProof() {
		state.betaAction = 'refresh';
		state.betaMessage = null;
		render();

		refreshDashboardData()
			.then( function () {
				markLastAction();
				setBetaMessage( 'ok', 'Validation proof refreshed.' );
			} )
			.catch( function ( error ) {
				setBetaMessage( 'error', 'Refresh failed: ' + error.message );
			} )
			.finally( function () {
				state.betaAction = '';
				render();
			} );
	}

	function refreshDashboardData() {
		return Promise.allSettled( [
			request( config.endpoints?.doctor || '/doctor' ),
			request( config.endpoints?.runs || '/runs?limit=20' ),
			request( config.endpoints?.latest || '/run/latest' ),
			request( config.endpoints?.adapters || '/adapters' ),
			request( config.endpoints?.realEstateRequirements || '/beta/real-estate/requirements' ),
			request( config.endpoints?.aiSettings || '/ai/settings' ),
		] ).then( function ( results ) {
			const labels = [ 'Doctor', 'Runs', 'Latest run', 'Adapters', 'Requirements', 'AI settings' ];
			const failures = [];

			state.noRunsYet = false;
			state.requirementsError = '';
			state.aiSettingsError = '';

			results.forEach( function ( result, index ) {
				if ( isFirstRunEmptyResult( labels[ index ], result ) ) {
					state.noRunsYet = true;
					return;
				}

				if ( result.status === 'rejected' ) {
					if ( 'AI settings' === labels[ index ] ) {
						return;
					}

					failures.push( labels[ index ] + ': ' + result.reason.message );
				}
			} );

			if ( failures.length ) {
				throw new Error( failures.join( '; ' ) );
			}

			state.errors = [];

			if ( results[0].status === 'fulfilled' && ! isFirstRunEmptyResult( labels[0], results[0] ) ) {
				state.doctor = results[0].value;
			}

			if ( results[1].status === 'fulfilled' && ! isFirstRunEmptyResult( labels[1], results[1] ) ) {
				state.runs = Array.isArray( results[1].value.runs ) ? results[1].value.runs : [];
			}

			if ( results[2].status === 'fulfilled' && ! isFirstRunEmptyResult( labels[2], results[2] ) ) {
				state.latest = results[2].value;
				state.selectedRun = results[2].value;
				state.selectedFile = results[2].value.run?.file || '';
			}

			if ( state.noRunsYet ) {
				state.doctor = null;
				state.runs = [];
				state.latest = null;
				state.selectedRun = null;
				state.selectedFile = '';
			}

			if ( results[3].status === 'fulfilled' ) {
				state.adapters = Array.isArray( results[3].value.adapters ) ? results[3].value.adapters : [];
			}

			if ( results[4].status === 'fulfilled' ) {
				state.requirements = results[4].value;
			} else {
				state.requirements = null;
				state.requirementsError = results[4].reason ? results[4].reason.message : 'Unable to verify requirements.';
			}

			if ( results[5].status === 'fulfilled' ) {
				state.aiSettings = results[5].value;
			} else {
				state.aiSettings = null;
				state.aiSettingsError = results[5].reason ? results[5].reason.message : 'Unable to verify AI settings.';
			}
		} );
	}

	function loadDashboard() {
		root.innerHTML = '<div class="factory-dashboard-loading">Loading Factory dashboard...</div>';

		Promise.allSettled( [
			request( config.endpoints?.doctor || '/doctor' ),
			request( config.endpoints?.runs || '/runs?limit=20' ),
			request( config.endpoints?.latest || '/run/latest' ),
			request( config.endpoints?.adapters || '/adapters' ),
			request( config.endpoints?.realEstateRequirements || '/beta/real-estate/requirements' ),
			request( config.endpoints?.aiSettings || '/ai/settings' ),
		] ).then( function ( results ) {
			const labels = [ 'Doctor', 'Runs', 'Latest run', 'Adapters', 'Requirements', 'AI settings' ];

			state.errors = [];
			state.noRunsYet = false;
			state.requirementsError = '';
			state.aiSettingsError = '';

			results.forEach( function ( result, index ) {
				if ( isFirstRunEmptyResult( labels[ index ], result ) ) {
					state.noRunsYet = true;
					return;
				}

				if ( result.status === 'rejected' ) {
					if ( 'AI settings' === labels[ index ] ) {
						return;
					}

					state.errors.push( labels[ index ] + ': ' + result.reason.message );
				}
			} );

			if ( results[0].status === 'fulfilled' && ! isFirstRunEmptyResult( labels[0], results[0] ) ) {
				state.doctor = results[0].value;
			}

			if ( results[1].status === 'fulfilled' && ! isFirstRunEmptyResult( labels[1], results[1] ) ) {
				state.runs = Array.isArray( results[1].value.runs ) ? results[1].value.runs : [];
			}

			if ( results[2].status === 'fulfilled' && ! isFirstRunEmptyResult( labels[2], results[2] ) ) {
				state.latest = results[2].value;
				state.selectedRun = results[2].value;
				state.selectedFile = results[2].value.run?.file || '';
			}

			if ( state.noRunsYet ) {
				state.doctor = null;
				state.runs = [];
				state.latest = null;
				state.selectedRun = null;
				state.selectedFile = '';
			}

			if ( results[3].status === 'fulfilled' ) {
				state.adapters = Array.isArray( results[3].value.adapters ) ? results[3].value.adapters : [];
			}

			if ( results[4].status === 'fulfilled' ) {
				state.requirements = results[4].value;
			} else {
				state.requirements = null;
				state.requirementsError = results[4].reason ? results[4].reason.message : 'Unable to verify requirements.';
			}

			if ( results[5].status === 'fulfilled' ) {
				state.aiSettings = results[5].value;
			} else {
				state.aiSettings = null;
				state.aiSettingsError = results[5].reason ? results[5].reason.message : 'Unable to verify AI settings.';
			}

			render();
		} );
	}

	document.addEventListener( 'DOMContentLoaded', loadDashboard );
}() );
