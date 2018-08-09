/* Copyright (C) 2016 NooBaa */

import { deepFreeze, echo, isFunction } from './core-utils';
import { formatSize } from './size-utils';
import numeral from 'numeral';

const namedFormatter = deepFreeze({
    none: echo,
    size: formatSize,
    number: value => numeral(value).format(','),
    percentage: value => numeral(value).format('%')
});


export function getFormatter(format = 'none') {
    return isFunction(format) ? format : namedFormatter[format];
}
