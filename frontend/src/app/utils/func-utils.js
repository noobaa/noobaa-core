/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from './core-utils';

export const memorySizeOptions = deepFreeze([
    {
        value: 128,
        label: '128 MB'
    },
    {
        value: 256,
        label: '256 MB'
    },
    {
        value: 512,
        label: '512 MB'
    }
]);

export function getFunctionOption(func, accounts, bucket) {
    const { name, version } = func;
    const value = { name, version };
    const icon = { name: 'healthy', css: 'success' };
    const label = name;
    const executor = accounts[func.executor];
    const disabled = !executor.hasAccessToAllBuckets &&
        !executor.allowedBuckets.includes(bucket);

    let tooltip = '';
    if (disabled) {
        tooltip = `This function was created by ${executor.name},
            This account doesn’t have permissions for this bucket and the function
            cannot be selected until access is granted.`;
    }

    return { value, icon, label, disabled, tooltip };
}
