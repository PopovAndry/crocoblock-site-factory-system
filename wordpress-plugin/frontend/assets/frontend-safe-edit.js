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

	if ( ! config.endpoints.save && config.restBase ) {
		config.endpoints.save = String( config.restBase ).replace( /\/$/, '' ) + '/frontend-safe-edit/save';
	}

	const state = {
		context: null,
		currentValues: {},
		draftValues: {},
		selectedField: null,
		previewBlocked: false,
		lastPreviewResponse: null,
		saveReady: false,
		saveBlocked: false,
		panel: null,
		form: null,
		fieldLabel: null,
		fieldInput: null,
		fieldHint: null,
		status: null,
		summary: null,
		warnings: null,
		previewButton: null,
		saveButton: null,
		resetButton: null,
		saveProof: null,
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
				const error = new Error( message );
				error.status = response.status;
				error.data = data;
				throw error;
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
			'<div class="factory-frontend-safe-edit-panel__save-proof" data-role="save-proof"></div>' +
			'<form class="factory-frontend-safe-edit-panel__form" data-role="form">' +
				'<label class="factory-frontend-safe-edit-panel__label" data-role="field-label" for="factory-frontend-safe-edit-input">Safe field</label>' +
				'<textarea id="factory-frontend-safe-edit-input" class="factory-frontend-safe-edit-panel__input" rows="3" data-role="field-input"></textarea>' +
				'<div class="factory-frontend-safe-edit-panel__hint" data-role="field-hint"></div>' +
				'<div class="factory-frontend-safe-edit-panel__actions">' +
					'<button type="submit" class="factory-frontend-safe-edit-panel__button factory-frontend-safe-edit-panel__button--primary" data-role="preview">Preview</button>' +
					'<button type="button" class="factory-frontend-safe-edit-panel__button factory-frontend-safe-edit-panel__button--accent" data-role="save" hidden>Save</button>' +
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
		state.saveButton = panel.querySelector( '[data-role="save"]' );
		state.resetButton = panel.querySelector( '[data-role="reset"]' );
		state.saveProof = panel.querySelector( '[data-role="save-proof"]' );

		state.form.addEventListener( 'submit', function ( event ) {
			event.preventDefault();
			void runPreview();
		} );

		state.resetButton.addEventListener( 'click', function () {
			resetPreview();
		} );

		state.saveButton.addEventListener( 'click', function () {
			void runSave();
		} );

		state.fieldInput.addEventListener( 'input', function () {
			if ( ! state.selectedField ) {
				return;
			}

			state.draftValues[ state.selectedField ] = state.fieldInput.value;
			state.lastPreviewResponse = null;
			state.saveReady = false;
			updateSaveControl();
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

	function updateSaveProof( proof ) {
		if ( ! state.saveProof ) {
			return;
		}

		if ( ! proof ) {
			state.saveProof.innerHTML = '';
			state.saveProof.hidden = true;
			return;
		}

		const lines = [];
		const beforeTitle = proof.before_values && proof.before_values.hero_title ? proof.before_values.hero_title : '';
		const afterTitle = proof.after_values && proof.after_values.hero_title ? proof.after_values.hero_title : '';
		const beforeSubtitle = proof.before_values && proof.before_values.hero_subtitle ? proof.before_values.hero_subtitle : '';
		const afterSubtitle = proof.after_values && proof.after_values.hero_subtitle ? proof.after_values.hero_subtitle : '';
		const changedFields = Array.isArray( proof.changed_fields ) ? proof.changed_fields : [];

		lines.push( 'Save proof: Hero title and Hero subtitle beta' );

		if ( changedFields.indexOf( 'hero_title' ) !== -1 && ( beforeTitle || afterTitle ) ) {
			lines.push( 'Title: ' + beforeTitle + ' -> ' + afterTitle );
		}

		if ( changedFields.indexOf( 'hero_subtitle' ) !== -1 && ( beforeSubtitle || afterSubtitle ) ) {
			lines.push( 'Subtitle: ' + beforeSubtitle + ' -> ' + afterSubtitle );
		}

		if ( typeof proof.validation_count === 'number' ) {
			lines.push( 'Validation checks: ' + proof.validation_count );
		}

		if ( typeof proof.execution_count === 'number' ) {
			lines.push( 'Execution steps: ' + proof.execution_count );
		}

		if ( proof.manifest_file ) {
			lines.push( 'Manifest: ' + proof.manifest_file );
		}

		state.saveProof.hidden = false;
		state.saveProof.innerHTML = lines
			.map( function ( line ) {
				return '<div>' + escapeHtml( line ) + '</div>';
			} )
			.join( '' );
	}

	function fieldSupportsSave( field ) {
		return field === 'hero_title' || field === 'hero_subtitle';
	}

	function getSaveEnabledFieldLabel( field ) {
		if ( field === 'hero_subtitle' ) {
			return 'Hero subtitle';
		}

		return 'Hero title';
	}

	function hasDraftChange( field ) {
		if ( ! field ) {
			return false;
		}

		return String( state.draftValues[ field ] || '' ) !== String( state.currentValues[ field ] || '' );
	}

	function updateSaveControl() {
		if ( ! state.saveButton ) {
			return;
		}

		const supported = fieldSupportsSave( state.selectedField );
		const changed = hasDraftChange( state.selectedField );
		const canShow = supported && changed;
		const canSave = canShow && state.saveReady && ! state.previewBlocked && ! state.saveBlocked && !! state.context && !! state.context.can_edit;

		state.saveButton.hidden = ! canShow;
		state.saveButton.disabled = ! canSave;
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
		const canPreview = !! state.context.can_edit && ! state.previewBlocked;
		const saveHint = fieldSupportsSave( field )
			? 'Save is available for ' + getSaveEnabledFieldLabel( field ) + ' after a successful preview.'
			: 'Preview only in this beta. Save currently supports Hero title and Hero subtitle only.';

		state.fieldLabel.textContent = meta.label || field;
		state.fieldHint.textContent = 'Sanitizer: ' + ( meta.sanitizer || 'text' ) + ' | Max: ' + ( meta.max || '' ) + ' | ' + saveHint;
		state.fieldInput.disabled = ! canPreview;
		state.fieldInput.rows = isTextarea ? 4 : 2;
		state.fieldInput.value = value;
		state.previewButton.disabled = ! canPreview;
		updateSaveControl();
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
			const isNestedInteractive = !! marker.closest( 'a, button, [role="button"], input, select, textarea, label' );

			if ( ! isNestedInteractive ) {
				marker.setAttribute( 'tabindex', '0' );
				marker.setAttribute( 'role', 'button' );
			}

			const select = function ( event ) {
				if ( event ) {
					event.preventDefault();
					event.stopPropagation();
				}

				selectField( marker.dataset.factorySafeField );
			};

			marker.addEventListener( 'click', select );

			if ( ! isNestedInteractive ) {
				marker.addEventListener( 'keydown', function ( event ) {
					if ( event.key === 'Enter' || event.key === ' ' ) {
						event.preventDefault();
						select( event );
					}
				} );
			}
		} );
	}

	function updatePreviewLockState( blocked ) {
		state.previewBlocked = !! blocked;
		state.saveReady = false;
		state.saveBlocked = !! blocked;

		if ( state.previewBlocked ) {
			updatePanelStatus( 'Preview is blocked until ownership is safe.', 'warning' );
			updateWarnings(
				( state.context && state.context.warnings ? state.context.warnings.slice() : [] ).concat( [
					'Preview remains disabled until ownership state is safe again.',
				] )
			);
		}

		if ( state.selectedField ) {
			configureInputForField( state.selectedField );
		}
	}

	function clearPreviewLockState() {
		state.previewBlocked = false;
		state.saveBlocked = false;

		if ( state.selectedField ) {
			configureInputForField( state.selectedField );
		}
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
		state.lastPreviewResponse = null;
		state.saveReady = false;
		applyPreviewValues( state.currentValues );
		updatePanelStatus( 'Preview reset to current stored values.', 'neutral' );
		updateWarnings( state.context && state.context.warnings ? state.context.warnings : [] );
		updateSaveProof( null );

		if ( state.selectedField ) {
			configureInputForField( state.selectedField );
		}

		updateSummary( state.context, null );
	}

	function runPreview() {
		if ( ! state.context || ! state.context.can_edit || state.previewBlocked ) {
			updatePanelStatus( 'Preview is blocked until ownership is safe.', 'warning' );
			return Promise.resolve();
		}

		updatePanelStatus( 'Building preview...', 'loading' );
		state.previewButton.disabled = true;
		state.saveReady = false;
		updateSaveControl();

		return apiFetch( config.endpoints.preview, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( {
				safe_values: state.draftValues,
			} ),
		} ).then( function ( response ) {
			if ( response && response.can_edit === false ) {
				updatePreviewLockState( true );
				return;
			}

			clearPreviewLockState();
			state.lastPreviewResponse = response;
			state.draftValues = Object.assign( {}, response.preview_values || {} );
			applyPreviewValues( state.draftValues );
			updateSummary( state.context, response );
			updateWarnings( response.warnings || [] );
			updateSaveProof( null );
			state.saveReady = fieldSupportsSave( state.selectedField ) && hasDraftChange( state.selectedField );
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
			if ( error && ( error.status === 409 || ( error.data && error.data.can_edit === false ) || ( error.data && 'frontend_safe_edit_preview_blocked' === error.data.code ) ) ) {
				updatePreviewLockState( true );
				return;
			}

			state.saveReady = false;
			updatePanelStatus( error.message || 'Preview request failed.', 'error' );
		} ).finally( function () {
			if ( state.selectedField ) {
				configureInputForField( state.selectedField );
			} else {
				state.previewButton.disabled = true;
			}
		} );
	}

	function refreshContextAfterSave() {
		return apiFetch( config.endpoints.context, {
			method: 'GET',
		} ).then( function ( response ) {
			state.context = response;
			state.currentValues = Object.assign( {}, response.current_values || {} );
			state.draftValues = Object.assign( {}, response.current_values || {} );
			state.previewBlocked = ! response.can_edit;
			state.lastPreviewResponse = null;
			state.saveReady = false;
			state.saveBlocked = ! response.can_edit;
			applyPreviewValues( state.currentValues );
			updateSummary( response, null );
			updateWarnings( response.warnings || [] );

			if ( state.selectedField ) {
				configureInputForField( state.selectedField );
			}
		} );
	}

	function runSave() {
		if ( ! fieldSupportsSave( state.selectedField ) ) {
			updatePanelStatus( 'Save is only enabled for Hero title and Hero subtitle in this beta.', 'warning' );
			return Promise.resolve();
		}

		if ( ! state.saveReady || ! hasDraftChange( state.selectedField ) ) {
			updatePanelStatus( 'Preview ' + getSaveEnabledFieldLabel( state.selectedField ) + ' before saving.', 'warning' );
			return Promise.resolve();
		}

		updatePanelStatus( 'Saving ' + getSaveEnabledFieldLabel( state.selectedField ) + ' through the controlled Factory path...', 'loading' );
		state.saveButton.disabled = true;

		return apiFetch( config.endpoints.save, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( {
				safe_values: {
					[ state.selectedField ]: state.draftValues[ state.selectedField ],
				},
				expected_values: {
					[ state.selectedField ]: state.currentValues[ state.selectedField ],
				},
			} ),
		} ).then( function ( response ) {
			state.saveReady = false;
			updateSaveProof( response );
			updatePanelStatus( getSaveEnabledFieldLabel( state.selectedField ) + ' saved. Generated Home copy was refreshed through Factory.', 'success' );
			return refreshContextAfterSave().then( function () {
				updateSaveProof( response );
				selectField( state.selectedField );
			} );
		} ).catch( function ( error ) {
			state.saveReady = false;
			state.saveBlocked = !! ( error && error.status === 409 );
			updateSaveControl();
			updatePanelStatus( error.message || 'Save request failed.', 'error' );

			if ( error && error.data ) {
				updateSaveProof( error.data );
				if ( error.data.code === 'frontend_safe_edit_ownership_blocked' ) {
					updateWarnings( [ 'Save is blocked until ownership is safe again.' ] );
				}
			}
		} ).finally( function () {
			if ( state.selectedField ) {
				configureInputForField( state.selectedField );
			}
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
			state.previewBlocked = ! response.can_edit;
			state.saveReady = false;
			state.saveBlocked = ! response.can_edit;

			updateSummary( response, null );
			updateWarnings( response.warnings || [] );
			updateSaveProof( null );
			updatePanelStatus(
				response.can_edit
					? 'Safe copy preview is ready. Hero title and Hero subtitle can be saved in this beta after preview.'
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
