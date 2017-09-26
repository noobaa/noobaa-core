/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isIP, isDNSName, isIPOrDNSName } from 'utils/net-utils';

export function matchPattern(value, regExp) {
    return !value || regExp.test(value);
}

export function notIn(value, params) {
    params = ko.unwrap(params);
    if (Array.isArray(params)) {
        params = { list: params };
    }

    let { list = [], compareFunc = (a,b) => a === b } = params;

    return ko.unwrap(list).every(
        item => !compareFunc(value, item)
    );
}

export function hasNoLeadingOrTrailingSpaces(value) {
    return value.trim() === value;
}

export function isURI(value) {
    value = value.replace(/^\s+|\s+$/, ''); //Strip whitespace

    //Regex by Diego Perini from: http://mathiasbynens.be/demo/url-regex
    //Modified regex - removed the restrictions for private ip ranges
    const regExp = new RegExp(
        '^' +
            // protocol identifier
            '(?:(?:https?|ftp)://)' +
            // user:pass authentication
            '(?:\\S+(?::\\S*)?@)?' +
            '(?:' +
                  // IP address dotted notation octets
                  // excludes loopback network 0.0.0.0
                  // excludes reserved space >= 224.0.0.0
                  // excludes network & broacast addresses
                  // (first & last IP address of each class)
                  '(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])' +
                  '(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}' +
                  '(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))' +
            '|' +
                  // host name
                  '(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)' +
                  // domain name
                  '(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*' +
                  // TLD identifier
                  '(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))' +
                  // TLD may end with dot
                  '\\.?' +
            ')' +
            // port number
            '(?::\\d{2,5})?' +
            // resource path
            '(?:[/?#]\\S*)?' +
        '$', 'i'
    );

    return matchPattern(value, regExp);
}

export function includesUppercase(value) {
    return matchPattern(value, /[A-Z]/);
}

export function includesLowercase(value) {
    return matchPattern(value, /[a-z]/);
}

export function includesDigit(value) {
    return matchPattern(value, /[0-9]/);
}

export function isJSON(value) {
    try {
        JSON.parse(value);
        return true;
    } catch (err) {
        return false;
    }
}

export function isHostname(value) {
    const regExp = /^[a-zA-Z0-9]+(\-[a-zA-Z0-9]+)*(\.[a-zA-Z0-9]+(\-[a-zA-Z0-9]+)*)*$/;
    return matchPattern(value, regExp);
}

export function exactLength(value, len) {
    return value.length === len;
}

export function inRange(value, { min, max, inclusive = true }) {
    if (min > max) {
        throw new Error ('Max value must be bigger then min value');
    }

    return inclusive ?
        (min <= value && value <= max) :
        (min < value && value < max);
}

export function isEmail(value) {
    const regExp = /^((([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+(\.([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))$/i;
    return matchPattern(value, regExp);
}

export default function register(ko) {
    Object.assign(ko.validation.rules, {
        notIn: {
            validator: notIn,
            message: 'Value already exists'
        },

        hasNoLeadingOrTrailingSpaces: {
            validator: hasNoLeadingOrTrailingSpaces,
            message: 'Value cannot start or end with spaces'
        },

        isDNSName: {
            validator: val => !val || isDNSName(val),
            message: 'Please enter a valid DNS name'
        },

        isIP: {
            validator: val => !val || isIP(val),
            message: 'Please enter a valid IP address'
        },

        isIPOrDNSName: {
            validator: val => !val || isIPOrDNSName(val),
            message: 'Please enter a valid IP or DNS name'
        },

        isURI:{
            validator: isURI,
            message: 'Please enter a valid URI'
        },
        isHostname: {
            validator: isHostname,
            message: 'Please enter a valid hostname'
        },

        includesUppercase:{
            validator: includesUppercase,
            message: 'At least one uppercased letter'
        },

        includesLowercase:{
            validator: includesLowercase,
            message: 'At least one lowercased letter'
        },

        includesDigit:{
            validator: includesDigit,
            message: 'At least one digit'
        },

        isJSON: {
            validator: isJSON,
            message: 'Please enter a valid JSON string'
        },

        exactLength: {
            validator: exactLength,
            message: 'Must be exactly {0} characters'
        },
        inRange: {
            validator: inRange,
            message: ({ params }) => `Must be bewteen ${params.min} and ${params.max}`
        }
    });

    ko.validation.registerExtenders();
}
