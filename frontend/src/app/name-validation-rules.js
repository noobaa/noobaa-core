/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default function ruleset(entityName, existing, onlyIf = () => true) {
    return [
        {
            onlyIf: onlyIf,
            validator: (name, params) => {
                return name && name.length >= params.minLength && name.length <= params.maxLength;
            },
            message: '3-63 characters',
            params: { minLength: 3, maxLength: 63 }
        },
        {
            onlyIf: onlyIf,
            validator: name => name && !name.includes('..')
                && !name.includes('.-')
                && !name.includes('-.')
                && !/\s/.test(name)
                && /^[a-z0-9.-]*$/.test(name),
            message: 'Only lowercase letters, numbers, nonconsecutive periods or hyphens'
        },
        {
            onlyIf: onlyIf,
            validator: name => /^[a-z0-9].*[a-z0-9]$/.test(name),
            message: 'Starts and ends with a lowercase letter or number'
        },
        {
            onlyIf: onlyIf,
            validator: name => !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Avoid the form of an IP address'
        },
        {
            onlyIf: onlyIf,
            validator: name => !ko.unwrap(existing).includes(name),
            message: 'Globally unique name'
        }
    ];
}
