/* Copyright (C) 2016 NooBaa */

const query = [
    'input',
    'select',
    'textarea',
    'a',
    'button',
    '[tabindex]'
].join(',');

function _compareFocusOrder(p1, p2) {
    return false ||
        (p1[0] === p2[0] && p1[1] - p2[1]) ||
        (p1[0] === 0 && 1) ||
        (p2[0] === 0 && -1) ||
        (p1[0] - p2[0]);
}

function _listFocusable(container) {
    const focusables = Array.from(container.querySelectorAll(query));
    return focusables
        .map((elm, i) => [elm.tabIndex, i])
        .sort(_compareFocusOrder)
        .map(([,i]) => focusables[i]);
}

function _canBeFocused(elm) {
    const { tabIndex, disabled, offsetParent } = elm;
    return Boolean(offsetParent) &&
        tabIndex !== null &&
        tabIndex >= 0 &&
        !disabled;
}

function _findFocusableIn(container, fromElm, dir, n, cyclic) {
    const focusables = _listFocusable(container);
    const count = focusables.length;
    let index = focusables.findIndex(other => fromElm === other);
    let candidate = null;
    let last = null;

    do {
        index = cyclic ? (count + index + dir) % count : index + dir;
        candidate = focusables[index];

        if (candidate && _canBeFocused(candidate)) {
            last = candidate;
            --n;
        }

    } while (candidate && candidate !== fromElm && n > 0);

    return last;
}

export function findFirstFocusableIn(container) {
    return _listFocusable(container)
        .find(_canBeFocused);
}

export function findLastFocusableIn(container) {
    return _listFocusable(container)
        .reverse()
        .find(_canBeFocused);
}

export function findPrevFocusableIn(container, fromElm, cyclic = false) {
    return _findFocusableIn(container, fromElm, -1, 1, cyclic);
}

export function findNextFocusableIn(container, fromElm, cyclic = false) {
    return _findFocusableIn(container, fromElm, 1, 1, cyclic);
}

export function findNthPrevFocusableIn(container, fromElm, n, cyclic = false) {
    return _findFocusableIn(container, fromElm, -1, n, cyclic);
}

export function findNthNextFocusableIn(container, fromElm, n, cyclic = false) {
    return _findFocusableIn(container, fromElm, 1, n, cyclic);
}
