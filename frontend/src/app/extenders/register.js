/* Copyright (C) 2016 NooBaa */

import tween from './tween';
import formatSize from './format-size';
import formatNumber from './format-number';
import formatTime from './format-time';
import isModified from './is-modified';
import compareUsing from './compare-using';

export default function register(ko) {
    Object.assign(ko.extenders, {
        tween,
        formatSize,
        formatNumber,
        formatTime,
        isModified,
        compareUsing
    });
}
