/* Copyright (C) 2016 NooBaa */

function _makeId(len = 8) {
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    return new Array(len)
        .fill('')
        .map(() => possible.charAt(Math.random() * possible.length | 0))
        .join('');
}

function _encode(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function _isObject(value) {
    return typeof value === 'object' && value !== null;
}

function _buildHtmlTreeNode(value, prefix, indent) {
    const type = typeof value;

    if (type === 'string') {
        return wrap(`"${_encode(value)}"`, 'string');
    }

    if (type !== 'object') {
        return wrap(value, type);
    }

    if (value === null) {
        return wrap(value, 'null');
    }

    const isArray = Array.isArray(value);
    const props = [];
    for (const [key, val] of Object.entries(value)) {
        const prop = [ wrap(_encode(prefix), 'prefix') ];

        if (_isObject(val)) {
            const id = _makeId();
            prop.push(
                `<input type="checkbox" id="${id}"/>`,
                `<label for="${id}" class="key i${indent}">${_encode(key)}</label>`,
            );
        } else {
            prop.push(wrap(_encode(key), `key i${indent}`));
        }

        prop.push(':', _buildHtmlTreeNode(val, prefix, indent + 1));

        props.push(wrap(prop.join(' '), 'prop'));
    }

    const summary = isArray ? `[${props.length}]` : `{${props.length}}`;
    if (props.length > 0) {
        const content = wrap(props.join(''), 'obj');
        return `${summary}${content}`;

    } else {
        const content = wrap(
            [
                wrap(_encode(prefix), 'prefix'),
                wrap(`(empty ${isArray ? 'array' : 'objcet'})`, `i${indent}`)
            ].join(' '),
            'obj'
        );

        return `${summary} ${content}`;
    }
}

export function noop() {
}

export function wrap(value, cls) {
    return `<span class="${cls}">${value}</span>`;
}

export function buildHtmlTree(value, prefix = '') {
    const parts = [
        wrap(prefix, 'prefix')
    ];

    if (value !== null && typeof value === 'object') {
        parts.push(Array.isArray(value) ? 'array' : 'object');
    }

    parts.push(_buildHtmlTreeNode(value, prefix, 0));
    return parts.join(' ');
}

export function diff(curr, prev, diffs = [], path = '') {
    if (Array.isArray(curr)) {
        if (Array.isArray(prev)) {
            const len = Math.max(curr.length, prev.length);
            for (let i = 0; i < len; ++i) {
                diff(curr[i], prev[i], diffs, `${path}[${i}]`);
            }

        } else {
            diffs.push({
                path: path,
                toValue: curr,
                form: prev
            });
        }

    } else if (curr === null) {
        if (prev !== null) {
            diffs.push({
                path: path || '.',
                fromValue: prev,
                toValue: curr
            });
        }

    } else if (typeof curr === 'object'){
        if (typeof prev === 'object') {
            const keys = new Set([
                ...Object.keys(curr),
                ...Object.keys(prev)
            ]);

            for (const key of keys) {
                diff(curr[key], prev[key], diffs, `${path}.${key}`);
            }

        } else {
            diffs.push({
                path: path || '.',
                formValue: prev,
                toValue: curr
            });
        }

    } else if (curr !== prev) {
        diffs.push({
            path: path || '.',
            fromValue: prev,
            toValue: curr
        });
    }

    return diffs;
}
