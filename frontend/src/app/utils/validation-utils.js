/* Copyright (C) 2016 NooBaa */

export function validateName(name = '', existing, options = {}) {
    const {
        disallowPeriods = false,
        minLength = 3, 
        maxLength = 63
    } = options;
    const symbolsRule = disallowPeriods ? {
        valid: name && /^[a-z0-9-]*$/.test(name) &&
            !name.includes(' ') &&
            !name.includes('--'),
        message: 'Only lowercase letters, numbers and nonconsecutive hyphens'
    } : {
        valid: name && /^[a-z0-9.-]*$/.test(name) &&
            !name.includes(' ') &&
            !name.includes('..') &&
            !name.includes('.-') &&
            !name.includes('-.') &&
            !name.includes('--'),
        message: 'Only lowercase letters, numbers, nonconsecutive periods or hyphens'
    };

    return [
        {
            valid: minLength <= name.length && name.length <= maxLength,
            message: `${minLength}-${maxLength} characters`
        },
        {
            valid: /^[a-z0-9](.*[a-z0-9])?$/.test(name),
            message: 'Starts and ends with a lowercase letter or number'
        },
        symbolsRule,
        {
            valid: name && !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Avoid using the form of an IP address'
        },
        {
            valid: name && !existing.includes(name),
            message: 'Globally unique name'
        }
    ];
}

export function validatePassword(password = '') {
    return [
        {
            valid: password.length >= 5,
            message: 'At least 5 characters'
        },
        {
            valid: /[A-Z]/.test(password),
            message: 'At least one uppercased letter'
        },
        {
            valid: /[a-z]/.test(password),
            message: 'At least one lowercase letter'
        },
        {
            valid: /[0-9]/.test(password),
            message: 'At least one digit'
        }
    ];
}
