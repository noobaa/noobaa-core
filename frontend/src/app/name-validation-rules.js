/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default function ruleset(entityName, existing, onlyIf = () => true) {
    return [
        {
            onlyIf: onlyIf,
            validator: ko.validation.rules.required.validator,
            message: `Please enter a name for the ${entityName}`
        },
        {
            onlyIf: onlyIf,
            validator: ko.validation.rules.minLength.validator,
            message: 'Name must be between 3 and 63 characters',
            params: 3
        },
        {
            onlyIf: onlyIf,
            validator: ko.validation.rules.maxLength.validator,
            message: 'Name must be between 3 and 63 characters',
            params: 63
        },
        {
            onlyIf: onlyIf,
            validator: name => !name.includes('..'),
            message: 'Name cannot contain two adjacent periods'
        },
        {
            onlyIf: onlyIf,
            validator: name => !name.includes('.-') && !name.includes('-.'),
            message: 'Name cannot contain dashes next to periods'
        },
        {
            onlyIf: onlyIf,
            validator: name => !/\s/.test(name),
            message: 'Name cannot contain a whitespace'
        },
        {
            onlyIf: onlyIf,
            validator: name => /^[a-z0-9].*[a-z0-9]$/.test(name),
            message: 'Name must start and end with a lowercased letter or a number'
        },
        {
            onlyIf: onlyIf,
            validator: name => !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Name cannot be in the form of an IP address'
        },
        {
            onlyIf: onlyIf,
            validator: name => /^[a-z0-9.-]*$/.test(name),
            message: 'Name can contain only lowercase letters, numbers, dashes and dots'
        },
        {
            onlyIf: onlyIf,
            validator: name => !ko.unwrap(existing).includes(name),
            message: `A ${entityName} with the same name already exist`
        }
    ];
}
