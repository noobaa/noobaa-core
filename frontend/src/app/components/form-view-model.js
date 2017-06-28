/* Copyright (C) 2016 NooBaa */
import { isDefined, mapValues, noop, keyBy, echo } from 'utils/core-utils';
import Observer from 'observer';
import ko from 'knockout';
import { state$, dispatch } from 'state';
import {
    initializeForm,
    updateForm,
    touchForm,
    resetForm,
    setFormValidity,
    lockForm,
    unlockForm,
    dropForm,
} from 'action-creators';

function _selectValues(state) {
    return state && mapValues(state.fields, field => field.value, false);
}

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
        onSubmit = noop,
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
            // state().validated &&
            Object.values(state().fields).every(
                field => field.validity === 'VALID'
            )
        );

        this.isDirty = ko.pureComputed(
            () => Boolean(state()) && Object.values(state().fields).some(
                field => field.value === field.initial
            )
        );

        this.isLocked = ko.pureComputed(
            () => Boolean(state()) && state().locked
        );

        this.warnings = ko.pureComputed(
            () => state() ? state().warnings : {}
        );

        this.errors = ko.pureComputed(
            () => state() ? { ...state().errors, ...state().asyncErrors }: {}
        );

        // Bind form action to the form view model.
        ['submit', 'reset', 'lock', 'unlock'].forEach(
            method => this[method] = this[method].bind(this)
        );

        // Create the fields observables.
        for (const fieldName of Object.keys(fields)) {
            this[fieldName] = this._createFieldObservable(fieldName);
        }

        // Initialze the form.
        dispatch(initializeForm(name, fields));

        // listen for state changes.
        this.observe(state$.get('forms', name), this._onState);
    }

    get name() {
        return this._name;
    }

    submit() {
        if (!this.isValid()) {
            dispatch(touchForm(this.name));
            return;
        }

        const values = _selectValues(this._state());
        this._submitHandler(values);
    }

    reset() {
        dispatch(resetForm(this.name));
    }

    lock() {
        dispatch(lockForm(this.name));
    }

    unlock() {
        dispatch(unlockForm(this.name));
    }

    touch(group) {
        if (isDefined(group)) {
            const fields = this._groups[group];
            if (!fields) throw new Error(`Invalid group name ${group}`);
            dispatch(touchForm(this.name, fields));

        } else {
            dispatch(touchForm(this.name));
        }
    }

    dispose() {
        dispatch(dropForm(this.name));
        super.dispose();
    }

    _createFieldObservable(fieldName) {
        const { _state } = this;

        const field = this[fieldName] = ko.pureComputed(
            () => _state() ? _state().fields[fieldName] : {}
        );

        const obs = ko.pureComputed({
            read: () => field().value,
            write: value => {
                if (_state() && !_state.locked) {
                    dispatch(updateForm(this.name, { [fieldName]: value }));
                }
            }
        });

        obs.isDirty = ko.pureComputed(
            () => field().value !== field().initial
        );

        obs.wasTouched = ko.pureComputed(
            () => field().touched
        );

        obs.isValidating = ko.pureComputed(
            () => Boolean(
                _state() &&
                _state().validatingAsync &&
                _state().validatingAsync.includes(fieldName)
            )
        );

        obs.isValid = ko.pureComputed(
            () => field().validity === 'VALID'
        );

        obs.isInvalid = ko.pureComputed(
            () => field().validity === 'INVALID'
        );

        obs.isInvalidTouched = ko.pureComputed(
            () => obs.isInvalid() && obs.wasTouched()
        );

        obs.warning = ko.pureComputed(
            () => (_state() && _state().warnings[fieldName]) || ''
        );

        obs.error = ko.pureComputed(
            () => (_state() && (
                _state().syncErrors[fieldName] || _state().asyncErrors[fieldName]
            )) || ''
        );

        return obs;
    }

    _onState(state){
        if (!state) return;

        const prevValues =_selectValues(this._state());
        const values = _selectValues(state);
        const changes = prevValues ?
            Object.keys(prevValues).filter(name =>  prevValues[name] !== values[name]) :
            Object.keys(values);

        this._state(state);
        if (changes.length > 0) {
            this._validate(values, changes);
        }

        this._formCallback(state);
    }

    _validate(values, changed) {
        const {
            _warnHandler,
            _validateHandler,
            _validateAsyncHandler,
            _asyncTriggers,
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
        dispatch(setFormValidity(
            this.name,
            {
                fieldsValidity,
                warnings,
                syncErrors,
                asyncErrors: shouldValidateAsync ? {} : undefined,
                validatingAsync: canValidateAsync ? _asyncTriggers : undefined
            }
        ));

        if (canValidateAsync) {
            this._validateAsync(values);

        } else if (shouldValidateAsync) {
            this._asyncValidationHandle = null;
        }
    }

    async _validateAsync(values) {
        const { _validateAsyncHandler, _asyncTriggers } = this;

        // Gard the store update against stale validation state.
        const handle = this._asyncValidationHandle = {};
        const asyncErrors = await _validateAsyncHandler(values);
        if (this._asyncValidationHandle !== handle) return;

        const fieldsValidity = keyBy(
            _asyncTriggers,
            echo,
            name => asyncErrors.hasOwnProperty(name) ? 'INVALID' : 'VALID'
        );

        dispatch(setFormValidity(
            this.name,
            {
                fieldsValidity,
                asyncErrors,
                validatingAsync: null
            }
        ));
    }
}
