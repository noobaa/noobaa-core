import StateListener from 'state-listener';
import { isString } from 'utils/core-utils';
import { initializeForm, updateForm, disposeForm, resetForm } from 'dispatchers';

const formNameSym = Symbol('formNameSym');
const initializedSym = Symbol('initializedSym');

export default class FormViewModel extends StateListener {
    get formName() {
        return this[formNameSym];
    }

    get initialized() {
        return this[initializedSym];
    }

    constructor(formName) {
        if (!isString(formName)) {
            throw TypeError('Invalid formName, formName must be a valid string');
        }

        super();
        this[formNameSym] = formName;
        this[initializedSym] = false;
    }

    selectForm({ forms }) {
        return forms[this.formName];
    }

    selectState(state) {
        return [ this.selectForm(state) ];
    }

    updateForm(field, value) {
        updateForm(this.formName, field, value);
    }

    initializeForm(values = {}) {
        if (this[initializedSym]) {
            console.warn('Form already initialized, ignoring');
            return;
        }

        initializeForm(this.formName, values);
        this[initializedSym] = true;
    }

    resetForm() {
        resetForm(this.formName);
    }

    dispose() {
        // super.dispose() must be called first in order to dispose of
        // the state subscription before initiating the dispose from
        // action.
        super.dispose();
        disposeForm(this.formName);
    }
}
