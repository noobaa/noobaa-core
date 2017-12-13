import { mapValues } from './core-utils';

function _getFieldProp(form, fieldName, propName) {
    const { [fieldName]: field } = form.fields;
    return field && field[propName];
}

export function getFieldValue(form, field) {
    return _getFieldProp(form, field, 'value');
}

export function getFieldInitialValue(form, field) {
    return _getFieldProp(form, field, 'initial');
}

export function getFieldError(form, name) {
    const { syncErrors, asyncErrors } = form;
    return syncErrors[name] || asyncErrors[name];
}

export function getFieldWarning(form, name) {
    return form.warnings[name];
}

export function isFieldTouched(form, field) {
    return _getFieldProp(form, field, 'touched');
}

export function isFieldValid(form, field) {
    return _getFieldProp(form, field, 'validity') === 'VALID';
}

export function isFieldDirty(form, field) {
    return getFieldValue(form, field) === getFieldInitialValue(form, field);
}

export function getFormValues(form) {

    return mapValues(form.fields, field => field.value, false);
}

export function isFormValid(form) {
    return form.validated && Object.values(form.fields)
        .every(field => field.validity === 'VALID');
}
