( function () {
	'use strict';

	const config = window.FactoryFrontendSafeEditConfig;

	if ( ! config || ! config.endpoints || ! config.restNonce ) {
		return;
	}

	const markers = Array.from( document.querySelectorAll( '[data-factory-safe-field]' ) );

	if ( ! markers.length ) {
		return;
	}

	const state = {
		context: null,
		currentValues: {},
		draftValues: {},
		selectedField: null,
		panel: null,
		form: null,
		fieldLabel: null,
		fieldInput: null,
		fieldHint: null,
		status: null,
		summary: null,
		warnings: null,
		previewButton: null,
		resetButton: null,
	};

	function apiFetch( url, options ) {
		const requestOptions = Object.assign(
			{
				headers: {
					'X-WP-Nonce': config.restNonce,
				},
				credentials: 'same-origin',
			},
			options || {}
		);

		requestOptions.headers = Object.assign(
			{
				'X-WP-Nonce': config.restNonce,
			},
			requestOptions.headers || {}
		);

		return window.fetch( url, requestOptions ).then( async ( response ) => {
			const data = await response.json().catch( function () {
				return null;
			} );

			if ( ! response.ok ) {
				const message = data && data.message ? data.message : 'Request failed.';
				throw new Error( message );
			}

			return data;
		} );
	}

	function createPanel() {
		const panel = document.createElement( 'aside' );
		panel.className = 'factory-frontend-safe-edit-panel';
		panel.innerHTML =
			'<div class="factory-frontend-safe-edit-panel__header">' +
				'<div>' +
					'<div class="factory-frontend-safe-edit-panel__eyebrow">Factory safe edit preview</div>' +
					'<h2 class="factory-frontend-safe-edit-panel__title">Review safe copy fields</h2>' +
				'</div>' +
				'<span class="factory-frontend-safe-edit-panel__badge">Preview only</span>' +
			'</div>' +
			'<p class="factory-frontend-safe-edit-panel__intro">Select a highlighted field on the page, edit the safe value here, and preview the result without saving.</p>' +
			'<div class="factory-frontend-safe-edit-panel__status" data-role="status"></div>' +
			'<div class="factory-frontend-safe-edit-panel__summary" data-role="summary"></div>' +
			'<form class="factory-frontend-safe-edit-panel__form" data-role="form">' +
				'<label class="factory-frontend-safe-edit-panel__label" data-role="field-label" for="factory-frontend-safe-edit-input">Safe field</label>' +
				'<textarea id="factory-frontend-safe-edit-input" class="factory-frontend-safe-edit-panel__input" rows="3" data-role="field-input"></textarea>' +
				'<div class="factory-frontend-safe-edit-panel__hint" data-role="field-hint"></div>' +
				'<div class="factory-frontend-safe-edit-panel__actions">' +
					'<button type="submit" class="factory-frontend-safe-edit-panel__button factory-frontend-safe-edit-panel__button--primary" data-role="preview">Preview</button>' +
					'<button type="button" class="factory-frontend-safe-edit-panel__button" data-role="reset">Reset</button>' +
				'</div>' +
			'</form>' +
			'<div class="factory-frontend-safe-edit-panel__warnings" data-role="warnings"></div>';

		document.body.appendChild( panel );

		state.panel = panel;
		state.form = panel.querySelector( '[data-role="form"]' );
		state.fieldLabel = panel.querySelector( '[data-role="field-label"]' );
		state.fieldInput = panel.querySelector( '[data-role="field-input"]' );
		state.fieldHint = panel.querySelector( '[data-role="field-hint"]' );
		state.status = panel.querySelector( '[data-role="status"]' );
		state.summary = panel.querySelector( '[data-role="summary"]' );
		state.warnings = panel.querySelector( '[data-role="warnings"]' );
		state.previewButton = panel.querySelector( '[data-role="preview"]' );
		state.resetButton = panel.querySelector( '[data-role="reset"]' );

		state.form.addEventListener( 'submit', function ( event ) {
			event.preventDefault();
			void runPreview();
		} );

		state.resetButton.addEventListener( 'click', function () {
			resetPreview();
		} );

		state.fieldInput.addEventListener( 'input', function () {
			if ( ! state.selectedField ) {
				return;
			}

			state.draftValues[ state.selectedField ] = state.fieldInput.value;
		} );
	}

	function updatePanelStatus( message, tone ) {
		if ( ! state.status ) {
			return;
		}

		state.status.textContent = message || '';
		state.status.dataset.tone = tone || 'neutral';
	}

	function updateSummary( context, previewResponse ) {
		if ( ! state.summary ) {
			return;
		}

		const ownership = context && context.ownership ? context.ownership : null;
		const diffSummary = previewResponse && previewResponse.diff_summary ? previewResponse.diff_summary : null;
		const lines = [];

		lines.push( 'Page: ' + ( config.pageType === 'contact' ? 'Contact' : 'Home' ) );
		lines.push( 'Safe fields: ' + markers.length );

		if ( ownership ) {
			lines.push( 'Ownership: ' + ( ownership.blocked ? 'Review required' : 'Ready for preview' ) );
		}

		if ( diffSummary ) {
			lines.push( 'Preview changes: ' + diffSummary.changed_count );
		}

		state.summary.innerHTML = lines
			.map( function ( line ) {
				return '<div>' + escapeHtml( line ) + '</div>';
			} )
			.join( '' );
	}

	function updateWarnings( warnings ) {
		if ( ! state.warnings ) {
			return;
		}

		if ( ! warnings || ! warnings.length ) {
			state.warnings.innerHTML = '';
			return;
		}

		state.warnings.innerHTML =
			'<ul>' +
			warnings
				.slice( 0, 3 )
				.map( function ( warning ) {
					return '<li>' + escapeHtml( warning ) + '</li>';
				} )
				.join( '' ) +
			'</ul>';
	}

	function configureInputForField( field ) {
		if ( ! field || ! state.context || ! state.context.safe_fields || ! state.context.safe_fields[ field ] ) {
			state.fieldInput.value = '';
			state.fieldInput.disabled = true;
			state.previewButton.disabled = true;
			return;
		}

		const meta = state.context.safe_fields[ field ];
		const value = Object.prototype.hasOwnProperty.call( state.draftValues, field )
			? state.draftValues[ field ]
			: '';
		const isTextarea = meta.sanitizer === 'textarea';

		state.fieldLabel.textContent = meta.label || field;
		state.fieldHint.textContent = 'Sanitizer: ' + ( meta.sanitizer || 'text' ) + ' | Max: ' + ( meta.max || '' );
		state.fieldInput.disabled = ! state.context.can_edit;
		state.fieldInput.rows = isTextarea ? 4 : 2;
		state.fieldInput.value = value;
		state.previewButton.disabled = ! state.context.can_edit;
	}

	function selectField( field ) {
		state.selectedField = field;

		markers.forEach( function ( marker ) {
			const isActive = marker.dataset.factorySafeField === field;
			marker.classList.toggle( 'is-active', isActive );
		} );

		configureInputForField( field );
	}

	function initializeMarkers() {
		markers.forEach( function ( marker ) {
			marker.classList.add( 'is-safe-edit-ready' );
			marker.setAttribute( 'tabindex', '0' );
			marker.setAttribute( 'role', 'button' );

			const select = function () {
				selectField( marker.dataset.factorySafeField );
			};

			marker.addEventListener( 'click', select );
			marker.addEventListener( 'keydown', function ( event ) {
				if ( event.key === 'Enter' || event.key === ' ' ) {
					event.preventDefault();
					select();
				}
			} );
		} );
	}

	function applyPreviewValues( values ) {
		markers.forEach( function ( marker ) {
			const field = marker.dataset.factorySafeField;

			if ( ! Object.prototype.hasOwnProperty.call( values, field ) ) {
				return;
			}

			marker.textContent = values[ field ];
		} );
	}

	function resetPreview() {
		state.draftValues = Object.assign( {}, state.currentValues );
		applyPreviewValues( state.currentValues );
		updatePanelStatus( 'Preview reset to current stored values.', 'neutral' );
		updateWarnings( state.context && state.context.warnings ? state.context.warnings : [] );

		if ( state.selectedField ) {
			configureInputForField( state.selectedField );
		}

		updateSummary( state.context, null );
	}

	function runPreview() {
		if ( ! state.context || ! state.context.can_edit ) {
			updatePanelStatus( 'Preview is blocked until ownership is safe.', 'warning' );
			return Promise.resolve();
		}

		updatePanelStatus( 'Building preview...', 'loading' );
		state.previewButton.disabled = true;

		return apiFetch( config.endpoints.preview, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( {
				safe_values: state.draftValues,
			} ),
		} ).then( function ( response ) {
			state.draftValues = Object.assign( {}, response.preview_values || {} );
			applyPreviewValues( state.draftValues );
			updateSummary( state.context, response );
			updateWarnings( response.warnings || [] );
			updatePanelStatus(
				response.diff_summary && response.diff_summary.changed_count
					? 'Preview updated. No site changes were made.'
					: 'No preview changes detected.',
				response.status === 'warning' ? 'warning' : 'success'
			);

			if ( state.selectedField ) {
				configureInputForField( state.selectedField );
			}
		} ).catch( function ( error ) {
			updatePanelStatus( error.message || 'Preview request failed.', 'error' );
		} ).finally( function () {
			state.previewButton.disabled = ! state.selectedField;
		} );
	}

	function escapeHtml( value ) {
		return String( value )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#039;' );
	}

	function boot() {
		createPanel();
		initializeMarkers();
		updatePanelStatus( 'Loading safe edit context...', 'loading' );

		apiFetch( config.endpoints.context, {
			method: 'GET',
		} ).then( function ( response ) {
			state.context = response;
			state.currentValues = Object.assign( {}, response.current_values || {} );
			state.draftValues = Object.assign( {}, response.current_values || {} );

			updateSummary( response, null );
			updateWarnings( response.warnings || [] );
			updatePanelStatus(
				response.can_edit
					? 'Safe copy preview is ready. Nothing will be saved from this panel.'
					: 'Preview is available, but ownership review is required before any future save flow.',
				response.can_edit ? 'success' : 'warning'
			);

			const firstField = markers[ 0 ] ? markers[ 0 ].dataset.factorySafeField : null;

			if ( firstField ) {
				selectField( firstField );
			}

			if ( ! response.can_edit ) {
				state.fieldInput.disabled = true;
				state.previewButton.disabled = true;
			}
		} ).catch( function ( error ) {
			updatePanelStatus( error.message || 'Unable to load safe edit context.', 'error' );
			state.previewButton.disabled = true;
			state.fieldInput.disabled = true;
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
}() );
