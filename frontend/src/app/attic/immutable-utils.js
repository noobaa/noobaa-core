/* Copyright (C) 2016 NooBaa */

import { isDefined, hasOwn } from 'utils/core-utils';

export function getDeep(state, path) {
    return _getDeep(state, path, 0);
}

function _getDeep(state, path, i) {
    if (!isDefined(state) || i === path.length) {
        return state;
    }

    const key = path[i];
    return _getDeep(state[key], path, i + 1);
}

export function setDeep(state, path, value) {
    return _setDeep(state, path, value, 0);
}

function _setDeep(state, path, value, i) {
    if (i >= path.length) {
        return value;
    }

    const key = path[i];
    const newState = isDefined(state) ?
        (Array.isArray(state) ? [ ...state ] : { ...state }) :
        (Number.isInteger(key) ? [] : {});

    newState[key] = _setDeep(state && state[key], path, value, i + 1);
    return newState;
}

export function deleteDeep(state, path) {
    return _deleteDeep(state, path, 0);
}

function _deleteDeep(state, path, i) {
    const key = path[i];
    if (!isDefined(state) || !hasOwn(state, key)) {
        return state;

    } else if (i === path.length - 1) {
        if (Array.isArray(state)) {
            return Number.isInteger(key) ?
                state.filter((_, i) => i !== key) :
                state;

        } else {
            const { [key]: t, ...newState } = state;
            return newState;
        }

    } else {
        const newState = Array.isArray(state) ? [...state] : {...state};
        newState[key] = _deleteDeep(state[key], path, i + 1);
        return newState;

    }
}

export function hasKeyDeep(state, path) {
    return isDefined(_getDeep(state, path, 0));
}
