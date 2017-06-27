/* Copyright (C) 2016 NooBaa */

import { makeArray, isNumber, isString } from './core-utils';
import { timeShortFormat as defaultFormat } from 'config';
import moment from 'moment-timezone';

export const digits = '123456789';
export const letters = 'abcdefghijklmnopqrstuvwxyz';
export const symbols = ')!@#$%^&*(';

export function toCammelCase(str) {
    return str.replace(/-\w/g, match => match[1].toUpperCase());
}

export function toDashedCase(str) {
    return str.replace(/[A-Z]+/g, match => `-${match.toLowerCase()}`);
}

export function formatTime(target, params) {
    const naked = params || {};
    const {
        format = isString(naked) ? naked : defaultFormat,
        timezone = '',
        notAvailableText  = 'N/A'
    } = naked;

    const value = target;
    if (!isNumber(value)) {
        return notAvailableText;
    }

    const time = timezone ? moment.tz(value, timezone) : moment(value);
    return time.format(format);
}

export function formatDuration(minutes) {
    let hours = minutes / 60 | 0;
    let days = hours / 24 | 0;
    hours %= 24;
    minutes %= 60;

    return [
        days > 0 ? `${days} day${days > 1 ? 's' : ''}` : null,
        hours > 0 ? `${hours} hour${hours > 1 ? 's' : ''}` : null,
        minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''}` : null
    ]
        .filter(
            part => part
        )
        .reduce(
            (str, part, i, parts) =>
                str + (i === parts.length - 1 ? ' and ' : ', ') + parts
        );
}

export function randomString(len = 8) {
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    return makeArray(
        len,
        () => possible.charAt(Math.random() * possible.length | 0)
    ).join('');
}

export function equalNoCase(str1, str2) {
    return str1.toLowerCase() === str2.toLowerCase();
}

export function lastSegment(str = '', delimiter) {
    return str.substr(str.lastIndexOf(delimiter) + 1);
}

export function shortString(str, maxLength = 25, suffixLengh = 5) {
    if (str.length <= maxLength){
        return str;
    }

    return `${
        str.substr(0, maxLength - (suffixLengh + 3))
    }...${
        str.substr(-suffixLengh)
    }`;
}

export function pad(str, size, char = '0') {
    return (char.repeat(size) + str).substr(-size);
}

export function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

export function isLowerCase(str) {
    return str.toLowerCase() === str;
}

export function isUpperCase(str) {
    return str.toUpperCase() === str;
}

export function isLetter(str) {
    return letters.includes(str.toLowerCase());
}

export function isDigit(str) {
    return !isNaN(Number(str)) && str.length === 1;
}

export function pluralize(word, amount) {
    return `${word}${amount === 1 ? '' : 's'}`;
}

export function stringifyAmount(subject, amount, zeroMoniker = '0') {
    return `${
        amount > 0 ? amount : zeroMoniker
    } ${
        pluralize(subject, amount)
    }`;
}

export function splice(str, start, end, replacement = '') {
    return `${str.substr(0, start)}${replacement}${str.substr(end)}`;
}
