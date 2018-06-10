/* Copyright (C) 2016 NooBaa */

import template from './managed-form.html';
import Observer from 'observer';
import { isFunction, mapValues, noop, pick } from 'utils/core-utils';
import { getFormValues, isFormValid, isFormDirty } from 'utils/form-utils';
import { get } from 'rx-extensions';
import ko from 'knockout';
import { state$, action$ } from 'state';
import {
    initializeForm,
    updateForm,
    resetForm,
    setFormValidity,
    submitForm,
    completeSubmitForm,
    dropForm
} from 'action-creators';

class ManagedFormViewModel extends Observer {
    constructor({
        name,
        fields = {},
        onWarn,
        onValidate,
        onValidateAsync,
        onValidateSubmit,
        asyncTriggers,
        onSubmit = noop
    }, owner) {
        super();

        this._name = name;
        this._submitHandler = onSubmit && onSubmit.bind(owner);
        this._warnHandler = onWarn && onWarn.bind(owner);
        this._validateHandler = onValidate && onValidate.bind(owner);
        this._validateAsyncHandler = onValidateAsync && onValidateAsync.bind(owner);
        this._validateSubmitHandler = onValidateSubmit && onValidateSubmit.bind(owner);
        this._asyncTriggers = asyncTriggers;
        this._asyncValidationHandle = null;

        // Create an observable to hold the loaded form state.
        const state = this._state = ko.observable();

        this.isInitialized = ko.pureComputed(
            () => Boolean(state())
        );

        this.isValidating = ko.pureComputed(
            () => Boolean(state() && state().validatingAsync)
        );

        this.isValid = ko.pureComputed(
            () => Boolean(state()) && isFormValid(state())
        );

        this.isDirty = ko.pureComputed(
            () => Boolean(state()) && isFormDirty(state())
        );

        this.isSubmitting = ko.pureComputed(
            () => Boolean(state()) && state().submitting
        );

        this.isSubmitted = ko.pureComputed(
            () => Boolean(state()) && state().submitted
        );

        this.warnings = ko.pureComputed(
            () => state() ? state().warnings : {}
        );

        this.errors = ko.pureComputed(
            () => state() ? {
                ...state().syncErrors,
                ...state().asyncErrors,
                ...state().submitErrors
            }: {}
        );

        // Bind form action to the form view model.
        for (const method of ['submit', 'reset']) {
            this[method] = this[method].bind(this);
        }

        if (ko.isObservable(fields) && !fields()) {
            fields.once(fields => this._initialize(fields));
        } else {
            this._initialize(ko.unwrap(fields));
        }

        // listen for state changes.
        this.observe(
            state$.pipe(get('forms', name)),
            this._onState
        );
    }

    get name() {
        return this._name;
    }

    submit() {
        action$.next(submitForm(this.name));
    }

    reset() {
        action$.next(resetForm(this.name));
    }

    dispose() {
        action$.next(dropForm(this.name));
        super.dispose();
    }

    _initialize(fields) {
        // Create the fields observables.
        for (const fieldName of Object.keys(fields)) {
            this[fieldName] = this._createFieldObservable(fieldName);
        }

        // Initialze the form.
        action$.next(initializeForm(this.name, fields));
    }

    _createFieldObservable(fieldName) {
        const { _state, name: formName } = this;

        const field = ko.pureComputed(
            () =>  _state() ? _state().fields[fieldName] : {}
        );

        const set = function(value, touch = true) {
            if (_state() && field().value !== value) {
                action$.next(updateForm(formName, { [fieldName]: value }, touch));
            }
        };

        const obs = ko.pureComputed({
            read: () => field().value,
            write: set
        });

        return Object.assign(obs, {
            set: (value, touch = false) => {
                if (field().value !== value) {
                    set(value, touch);
                }
            },

            isDirty: ko.pureComputed(
                () => field().value !== field().initial
            ),

            wasTouched: ko.pureComputed(
                () => field().touched
            ),

            isValidating: ko.pureComputed(
                () => Boolean(
                    _state() &&
                    _state().validatingAsync &&
                    _state().validatingAsync.includes(fieldName)
                )
            ),

            isValid: ko.pureComputed(
                () => field().validity === 'VALID'
            ),

            isInvalid: ko.pureComputed(
                () => field().validity === 'INVALID'
            ),

            isInvalidTouched: ko.pureComputed(
                () => obs.isInvalid() && obs.wasTouched()
            ),

            warning: ko.pureComputed(
                () => (_state() && _state().warnings[fieldName]) || ''
            ),

            error: ko.pureComputed(
                () => {
                    if (!_state()) return '';
                    return _state().syncErrors[fieldName] ||
                        _state().asyncErrors[fieldName] ||
                        _state().submitErrors[fieldName] ||
                        '';
                }
            )
        });
    }

    _onState(state){
        if (!state) return;

        const prevValues = this._state() && getFormValues(this._state());
        const values = getFormValues(state);
        const changes = prevValues ?
            Object.keys(prevValues).filter(name =>  prevValues[name] !== values[name]) :
            Object.keys(values);

        this._state(state);

        if (changes.length > 0) {
            this._validate(values, changes);

        } else if (state.submitting) {
            this._handleSubmitting(values);

        } else if (state.submitted) {
            this._submitHandler(values);
        }
    }

    _validate(values, changed) {
        const {
            _warnHandler,
            _validateHandler,
            _validateAsyncHandler,
            _asyncTriggers
        } = this;

        const warnings = _warnHandler && _warnHandler(values);
        const syncErrors = _validateHandler && _validateHandler(values);

        const shouldValidateAsync =
            _validateAsyncHandler &&
            _asyncTriggers &&
            _asyncTriggers.some(field => changed.includes(field));

        const canValidateAsync =
            shouldValidateAsync &&
            Object.keys(syncErrors || {}).every(field => !_asyncTriggers.includes(field));

        const fieldsValidity = mapValues(values, (_, field) => {
            if (syncErrors && syncErrors.hasOwnProperty(field)) {
                return 'INVALID';
            }

            if ((_asyncTriggers || []).includes(field)) {
                return shouldValidateAsync ? 'UNKNOWN' : undefined;
            }

            return 'VALID';
        });

        // Dispatching while running inside a handler of subscribe
        // need to be asynchronous. (to prevent a recursive behavior)
        action$.next(setFormValidity(
            this.name,
            {
                values,
                fieldsValidity,
                warnings,
                syncErrors,
                asyncErrors: shouldValidateAsync ? {} : undefined,
                validatingAsync: canValidateAsync ? _asyncTriggers : undefined,
                confirmValidity: true
            }
        ));

        if (canValidateAsync) {
            const asyncValidatedValues = pick(values, _asyncTriggers);
            this._validateAsync(asyncValidatedValues);

        } else if (shouldValidateAsync) {
            this._asyncValidationHandle = null;
        }
    }

    async _validateAsync(values, retries = 2) {
        const { _validateAsyncHandler } = this;
        const handle = this._asyncValidationHandle = {};

        // Try running the async validation 3 time before forfit.
        for (let i = 1 + retries ; i > 0; --i) {
            try {
                // Gard the store update against stale validation state.
                const asyncErrors = await _validateAsyncHandler(values);
                if (this._asyncValidationHandle !== handle) return;

                const fieldsValidity = Object.keys(asyncErrors).length > 0 ?
                    mapValues(values, (_, name) => asyncErrors.hasOwnProperty(name) ? 'INVALID' : 'UNKNOWN') :
                    mapValues(values, () => 'VALID');

                action$.next(setFormValidity(
                    this.name,
                    {
                        values,
                        fieldsValidity,
                        asyncErrors,
                        validatingAsync: null,
                        touch: true
                    }
                ));
                break;

            } catch (error) {
                if (this._asyncValidationHandle !== handle) break;
                if (i === 0) throw error;
            }
        }
    }

    async _handleSubmitting(values) {
        if (isFunction(this._validateSubmitHandler)) {
            const errors = await this._validateSubmitHandler(values);
            action$.next(completeSubmitForm(this.name, errors));

        } else {
            action$.next(completeSubmitForm(this.name));
        }
    }
}

function viewModelFactory(params, info) {
    const owner = ko.dataFor(info.element);
    return new ManagedFormViewModel(params, owner);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};
