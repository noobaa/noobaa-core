/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default function ruleset(entityName, existing, onlyIf = () => true) {
    return [
        {
            onlyIf: onlyIf,
            validator: (name) => {
                return name && name.length >= 3 && name.length <= 63;
            },
            message: '3-63 characters'
        },
        {
            onlyIf: onlyIf,
            validator: name => name && !name.includes('..')
                && !name.includes('.-')
                && !name.includes('-.')
                && !name.includes('--')
                && !/\s/.test(name)
                && /^[a-z0-9.-]*$/.test(name),
            message: 'Only lowercase letters, numbers, nonconsecutive periods or hyphens'
        },
        {
            onlyIf: onlyIf,
            validator: name => name && /^[a-z0-9]$|^[a-z0-9].*[a-z0-9]$/.test(name),
            message: 'Starts and ends with a lowercase letter or number'
        },
        {
            onlyIf: onlyIf,
            validator: name => name && !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Avoid the form of an IP address'
        },
        {
            onlyIf: onlyIf,
            validator: name => name && !ko.unwrap(existing).includes(name),
            message: 'Globally unique name'
        }
    ];
}
