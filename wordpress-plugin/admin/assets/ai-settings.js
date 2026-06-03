( function () {
	'use strict';

	const config = window.FactoryAISettingsConfig || {};
	const root = document.getElementById( 'factory-ai-settings-root' );
	const defaultEstimateText = 'Create a Kyiv real estate agency website with a homepage, property catalog, contact page, validation proof, style tokens, and bundled image pools.';
	let state = {
		settings: null,
		estimate: null,
		message: null,
		loading: false,
		saving: false,
		estimating: false,
	};

	if ( ! root ) {
		return;
	}

	function endpoint( path ) {
		if ( /^https?:\/\//i.test( path ) ) {
			return path;
		}

		return ( config.restBase || '' ).replace( /\/$/, '' ) + path;
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
					throw new Error( data && data.message ? data.message : 'Request failed: ' + response.status );
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
		return '<span class="factory-ai-badge factory-ai-badge-' + escapeHtml( tone || 'neutral' ) + '">' + escapeHtml( label ) + '</span>';
	}

	function renderMessages() {
		const settings = state.settings || {};
		const warnings = Array.isArray( settings.warnings ) ? settings.warnings : [];
		const notices = Array.isArray( settings.notices ) ? settings.notices : [];
		const messages = [];

		if ( state.message ) {
			messages.push( '<div class="factory-ai-message factory-ai-message-' + escapeHtml( state.message.type ) + '">' + escapeHtml( state.message.text ) + '</div>' );
		}

		warnings.forEach( function ( warning ) {
			messages.push( '<div class="factory-ai-message factory-ai-message-warning">' + escapeHtml( warning ) + '</div>' );
		} );

		notices.forEach( function ( notice ) {
			messages.push( '<div class="factory-ai-message factory-ai-message-info">' + escapeHtml( notice ) + '</div>' );
		} );

		return messages.join( '' );
	}

	function renderModelSelector() {
		const settings = state.settings || {};
		const models = Array.isArray( settings.available_models ) ? settings.available_models : [];
		const selected = settings.selected_model || 'balanced';

		return [
			'<label class="factory-ai-field">',
				'<span>Model profile</span>',
				'<select data-factory-ai-model>',
					models.map( function ( model ) {
						return '<option value="' + escapeHtml( model.key ) + '"' + ( model.key === selected ? ' selected' : '' ) + '>' + escapeHtml( model.label || model.key ) + '</option>';
					} ).join( '' ),
				'</select>',
			'</label>',
			'<div class="factory-ai-model-notes">',
				models.map( function ( model ) {
					return '<p><strong>' + escapeHtml( model.label || model.key ) + ':</strong> ' + escapeHtml( model.description || '' ) + '</p>';
				} ).join( '' ),
			'</div>',
		].join( '' );
	}

	function renderEstimate() {
		if ( ! state.estimate ) {
			return '<p class="factory-ai-empty">Run a local estimate to see approximate token usage. No external API call is made.</p>';
		}

		return [
			'<dl class="factory-ai-estimate-result">',
				'<dt>Prompt tokens</dt><dd>' + escapeHtml( state.estimate.estimated_prompt_tokens ) + '</dd>',
				'<dt>Output allowance</dt><dd>' + escapeHtml( state.estimate.estimated_output_tokens ) + '</dd>',
				'<dt>Total estimate</dt><dd>' + escapeHtml( state.estimate.estimated_total_tokens ) + '</dd>',
				'<dt>Method</dt><dd>Approximate character count / 4</dd>',
			'</dl>',
		].join( '' );
	}

	function render() {
		const settings = state.settings || {};
		const keyStatus = settings.has_key
			? badge( 'Configured for future AI', 'ok' )
			: badge( 'No key configured', 'warning' );
		const storageStatus = settings.storage_available
			? badge( 'Encrypted storage available', 'ok' )
			: badge( 'Saved key storage unavailable', 'warning' );
		const keyMessage = settings.has_key
			? 'API key configured for future AI assistance.'
			: 'No API key configured. The deterministic Real Estate demo still works.';

		root.innerHTML = [
			'<header class="factory-ai-header">',
				'<div>',
					'<h1>AI Settings</h1>',
					'<p>AI foundation for future assisted generation. The current Real Estate beta uses deterministic generation only.</p>',
				'</div>',
				'<div class="factory-ai-header-badges">',
					badge( 'OpenAI', 'neutral' ),
					keyStatus,
				'</div>',
			'</header>',
			renderMessages(),
			'<section class="factory-ai-card">',
				'<div class="factory-ai-card-heading">',
					'<h2>Provider and API key</h2>',
					storageStatus,
				'</div>',
				'<dl class="factory-ai-definition-list">',
					'<dt>Provider</dt><dd>OpenAI</dd>',
					'<dt>Current generator</dt><dd>Deterministic Real Estate preset</dd>',
					'<dt>External provider calls</dt><dd>Disabled in this beta</dd>',
					'<dt>Token spending risk during Generate</dt><dd>None</dd>',
					'<dt>Key source</dt><dd>' + escapeHtml( settings.key_source || 'none' ) + '</dd>',
					'<dt>Saved key</dt><dd>' + escapeHtml( settings.masked_key || 'Not configured' ) + '</dd>',
				'</dl>',
				'<p class="factory-ai-help">' + escapeHtml( keyMessage ) + '</p>',
				'<label class="factory-ai-field">',
					'<span>New API key</span>',
					'<input type="password" data-factory-ai-key autocomplete="off" placeholder="Paste a key to save a new encrypted value">',
				'</label>',
				'<p class="factory-ai-help">Your API key can be saved for future AI-assisted workflows, but it is not used when generating the Real Estate demo in this beta. The full key is never returned to the browser after save. Constants and environment variables take priority over saved keys.</p>',
				renderModelSelector(),
				'<div class="factory-ai-actions">',
					'<button type="button" class="button button-primary" data-factory-ai-save' + ( state.saving ? ' disabled' : '' ) + '>' + ( state.saving ? 'Saving...' : 'Save settings' ) + '</button>',
					'<button type="button" class="button" data-factory-ai-remove' + ( state.saving ? ' disabled' : '' ) + '>Remove saved key</button>',
				'</div>',
			'</section>',
			'<section class="factory-ai-card">',
				'<h2>Local token estimate</h2>',
				'<p>This is a local planning estimate only. It does not call OpenAI and cannot spend tokens.</p>',
				'<textarea rows="5" data-factory-ai-estimate-text>' + escapeHtml( defaultEstimateText ) + '</textarea>',
				'<div class="factory-ai-actions">',
					'<button type="button" class="button" data-factory-ai-estimate' + ( state.estimating ? ' disabled' : '' ) + '>' + ( state.estimating ? 'Estimating...' : 'Estimate tokens' ) + '</button>',
				'</div>',
				renderEstimate(),
			'</section>',
			'<section class="factory-ai-card factory-ai-card-muted">',
				'<h2>Current beta behavior</h2>',
				'<ul>',
					'<li>Real Estate generation is deterministic.</li>',
					'<li>Preview and Generate do not call external AI providers.</li>',
					'<li>Saved API keys are not used during Real Estate demo generation.</li>',
					'<li>Prompt interpretation is local/mock and applies nothing automatically.</li>',
				'</ul>',
				'<h2>Coming next</h2>',
				'<ul>',
					'<li>AI prompt-to-site planning.</li>',
					'<li>Blueprint suggestions.</li>',
					'<li>Token estimate before provider calls.</li>',
					'<li>Review before applying AI-assisted changes.</li>',
				'</ul>',
			'</section>',
		].join( '' );

		bindEvents();
	}

	function bindEvents() {
		const saveButton = root.querySelector( '[data-factory-ai-save]' );
		const removeButton = root.querySelector( '[data-factory-ai-remove]' );
		const estimateButton = root.querySelector( '[data-factory-ai-estimate]' );

		if ( saveButton ) {
			saveButton.addEventListener( 'click', saveSettings );
		}

		if ( removeButton ) {
			removeButton.addEventListener( 'click', removeKey );
		}

		if ( estimateButton ) {
			estimateButton.addEventListener( 'click', estimateTokens );
		}
	}

	function selectedModel() {
		const field = root.querySelector( '[data-factory-ai-model]' );

		return field ? field.value : ( state.settings?.selected_model || 'balanced' );
	}

	function saveSettings() {
		const keyField = root.querySelector( '[data-factory-ai-key]' );
		const apiKey = keyField ? keyField.value : '';
		const model = selectedModel();
		state.saving = true;
		state.message = null;
		render();

		request(
			config.endpoints?.settings || '/ai/settings',
			{
				method: 'POST',
				body: {
					provider: 'openai',
					selected_model: model,
					api_key: apiKey,
				},
			}
		).then( function ( data ) {
			state.settings = data;
			state.message = { type: 'success', text: 'AI settings saved.' };
		} ).catch( function ( error ) {
			state.message = { type: 'error', text: error.message };
		} ).finally( function () {
			state.saving = false;
			render();
		} );
	}

	function removeKey() {
		const model = selectedModel();
		state.saving = true;
		state.message = null;
		render();

		request(
			config.endpoints?.settings || '/ai/settings',
			{
				method: 'POST',
				body: {
					provider: 'openai',
					selected_model: model,
					remove_key: true,
				},
			}
		).then( function ( data ) {
			state.settings = data;
			state.message = { type: 'success', text: 'Saved API key removed.' };
		} ).catch( function ( error ) {
			state.message = { type: 'error', text: error.message };
		} ).finally( function () {
			state.saving = false;
			render();
		} );
	}

	function estimateTokens() {
		const textarea = root.querySelector( '[data-factory-ai-estimate-text]' );
		const text = textarea ? textarea.value : '';
		const model = selectedModel();
		state.estimating = true;
		state.message = null;
		render();

		request(
			config.endpoints?.estimate || '/ai/estimate',
			{
				method: 'POST',
				body: {
					text: text,
					selected_model: model,
				},
			}
		).then( function ( data ) {
			state.estimate = data;
		} ).catch( function ( error ) {
			state.message = { type: 'error', text: error.message };
		} ).finally( function () {
			state.estimating = false;
			render();
		} );
	}

	function load() {
		state.loading = true;

		request( config.endpoints?.settings || '/ai/settings' )
			.then( function ( data ) {
				state.settings = data;
			} )
			.catch( function ( error ) {
				state.message = { type: 'error', text: error.message };
			} )
			.finally( function () {
				state.loading = false;
				render();
			} );
	}

	load();
}() );
