/* Copyright (C) 2016 NooBaa */

export default function formatNumber(target, compareOp) {
    target.equalityComparer = compareOp;
    return target;
}
