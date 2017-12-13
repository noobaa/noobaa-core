/* Copyright (C) 2016 NooBaa */

import { isDefined, mapValues, noop, pick } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import Observer from 'observer';
import ko from 'knockout';
import { state$, action$ } from 'state';
import {
    initializeForm,
    updateForm,
    touchForm,
    resetForm,
    setFormValidity,
    submitForm,
    dropForm
} from 'action-creators';


export default class FormViewModel extends Observer {
    constructor({
        name,
        fields = {},
        groups = {},
        onForm = noop,
        onWarn,
        onValidate,
        onValidateAsync,
        asyncTriggers,
        onSubmit = noop
    }) {
        super();

        this._name = name;
        this._groups = groups;
        this._submitHandler = onSubmit;
        this._formCallback = onForm;
        this._warnHandler = onWarn;
        this._validateHandler = onValidate;
        this._validateAsyncHandler = onValidateAsync;
        this._asyncTriggers = asyncTriggers;
        this._asyncValidationHandle = null;

        // Create an observable to hold the loaded form state.
        const state = this._state = ko.observable();

        this.isValidating = ko.pureComputed(
            () => Boolean(state() && state().validatingAsync)
        );

        this.isValid = ko.pureComputed(() =>
            Boolean(state()) &&
            state().validated &&
            Object.values(state().fields).every(
                field => field.validity === 'VALID'
            )
        );

        this.isDirty = ko.pureComputed(
            () => Boolean(state()) && Object.values(state().fields).some(
                field => field.value === field.initial
            )
        );

        this.isSubmitted = ko.pureComputed(
            () => Boolean(state()) && state().submitted
        );

        this.warnings = ko.pureComputed(
            () => state() ? state().warnings : {}
        );

        this.errors = ko.pureComputed(
            () => state() ? { ...state().errors, ...state().asyncErrors }: {}
        );

        // Bind form action to the form view model.
        ['submit', 'reset'].forEach(
            method => this[method] = this[method].bind(this)
        );

        // Create the fields observables.
        for (const fieldName of Object.keys(fields)) {
            this[fieldName] = this._createFieldObservable(fieldName);
        }

        // Initialze the form.
        action$.onNext(initializeForm(name, fields));

        // listen for state changes.
        this.observe(state$.get('forms', name), this._onState);
    }

    get name() {
        return this._name;
    }

    submit() {
        action$.onNext(submitForm(this.name));
    }

    reset() {
        action$.onNext(resetForm(this.name));
    }

    touch(group) {
        if (isDefined(group)) {
            const fields = this._groups[group];
            if (!fields) throw new Error(`Invalid group name ${group}`);
            action$.onNext(touchForm(this.name, fields));

        } else {
            action$.onNext(touchForm(this.name));
        }
    }

    dispose() {
        action$.onNext(dropForm(this.name));
        super.dispose();
    }

    _createFieldObservable(fieldName) {
        const { _state, name: formName } = this;

        const field = ko.pureComputed(
            () =>  _state() ? _state().fields[fieldName] : {}
        );

        const set = function(value, touch = true) {
            if (_state() && field().value !== value) {
                action$.onNext(updateForm(formName, { [fieldName]: value }, touch));
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
        this._formCallback(state);

        if (changes.length > 0) {
            this._validate(values, changes);

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
        action$.onNext(setFormValidity(
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

    async _validateAsync(values) {
        const { _validateAsyncHandler } = this;

        // Gard the store update against stale validation state.
        const handle = this._asyncValidationHandle = {};
        const asyncErrors = await _validateAsyncHandler(values);
        if (this._asyncValidationHandle !== handle) return;

        const fieldsValidity = Object.keys(asyncErrors).length > 0 ?
            mapValues(values, (_, name) => asyncErrors.hasOwnProperty(name) ? 'INVALID' : 'UNKNOWN') :
            mapValues(values, () => 'VALID');

        action$.onNext(setFormValidity(
            this.name,
            {
                values,
                fieldsValidity,
                asyncErrors,
                validatingAsync: null,
                touch: true
            }
        ));
    }
}
