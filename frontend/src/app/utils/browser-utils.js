/* Copyright (C) 2016 NooBaa */

import { isUndefined, runAsync } from './core-utils';
import { toCammelCase, toDashedCase, randomString } from './string-utils';
import { sleep } from './promise-utils';

export function parseQueryString(str) {
    return str
        .replace(/(^\?)/,'')
        .split('&')
        .map(part => decodeURIComponent(part))
        .filter(part => part)
        .reduce( (result, part) => {
            const [name, value] = part.split('=');
            result[toCammelCase(name)] = value || true;
            return result;
        }, {});
}

export function stringifyQueryString(query) {
    return Object.keys(query)
        .reduce((list, key) => {
            if (!isUndefined(query[key])) {
                const encodedName = encodeURIComponent(toDashedCase(key));
                const value = query[key] === true ?
                    encodedName :
                    `${encodedName}=${encodeURIComponent(query[key])}`;

                list.push(value);
            }

            return list;
        }, [])
        .join('&');
}

export function realizeUri(template, params = {}, query = {}, partial = false) {
    const search = stringifyQueryString(query);
    const base = template
        .split('/')
        .map(part => {
            const isParam = part.startsWith(':');
            const isOptional = part.endsWith('?');

            if (isParam) {
                const name = part.slice(1, isOptional ? -1 : undefined);
                const value = params[name];

                if (value) {
                    return encodeURIComponent(encodeURIComponent(value));
                } else if (partial) {
                    return part;
                } else if (isOptional) {
                    return null;
                } else {
                    throw new Error(`Cannot satisfy mandatory parameter: ${name}`);
                }
            } else {
                return part;
            }
        })
        .filter(part => part !== null)
        .join('/');

    return search ? `${base}?${search}` : base;
}

export function copyTextToClipboard(text) {
    // Prevent XSS attacks.
    let doc = new DOMParser().parseFromString(text, 'text/html');
    text = doc.body.textContent;

    let input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = text;
    input.focus();
    input.select();
    document.execCommand('Copy');
    input.remove();
}

export function downloadFile(url, name = '') {
    let body = window.document.body;

    let link = window.document.createElement('a');
    link.download = name;
    link.href = url;
    body.appendChild(link);
    link.click();

    runAsync(() => body.removeChild(link));
}

export function domFromHtml(html) {
    // Switched to template element because DOMParser did not parsed
    // <tr>, <td>, <option> and <li> elements as root elements.
    let template = document.createElement('template');
    template.innerHTML = html;
    return template.content.childNodes;
}

export function encodeBase64(obj) {
    return btoa(JSON.stringify(obj));
}

export function recognizeBrowser() {
    const userAgentTokens = [
        'chrome', 'chromium', 'firefox', 'edge', 'msie', 'safari', 'opr'
    ];

    let userAgent = navigator.userAgent.toLowerCase();
    return  userAgentTokens.find(
        token => userAgent.includes(token)
    );
}

export function toFormData(payload) {
    return Object.entries(payload).reduce(
        (formData, [ key, value ]) => {
            formData.append(key, value);
            return formData;
        },
        new FormData()
    );
}

export function httpRequest(url, options = {}) {
    const { verb = 'GET', payload, xhr = new XMLHttpRequest() } = options;
    return new Promise(
        (resolve, reject) =>  {
            xhr.open(verb, url, true);
            xhr.onerror = reject;
            xhr.onabort = resolve;
            xhr.onload = resolve;

            if (payload) {
                xhr.send(payload);
            } else {
                xhr.send();
            }

        }
    );
}

export function httpWaitForResponse(url, status, retryDelay = 3000) {
    return (function tryGet() {
        // Try GET on url, if failed wait for retryDelay seconds and then try again.
        return httpRequest(url)
            .then(
                evt => {
                    if (!status || evt.target.status === status) {
                        return evt;
                    } else {
                        throw evt;
                    }
                }
            )
            .catch(
                () => sleep(retryDelay).then(tryGet)
            );
    })();
}

export function formatEmailUri(uri, subject) {
    const query = stringifyQueryString({ subject });
    return `mailto:${uri}${query ? `?${query}` : ''}`;
}

export function isUri(str) {
    const value = str.replace(/^\s+|\s+$/, ''); //Strip whitespace

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

    return regExp.test(value);
}

export function reloadBrowser(url) {
    if (url) {
        global.location.href = url;
    } else {
        global.location.reload();
    }
}

export function toObjectUrl(data) {
    const json = JSON.stringify(data, undefined, 2);
    const blob = new Blob([json], { type: 'text/json' });
    return global.URL.createObjectURL(blob);
}

export function openInNewTab(url, name) {
    if (name) {
        global.open(url, name);
    } else {
        global.open(url);
    }
}

export function createBroadcastChannel(name) {
    return new BroadcastChannel(name);
}

export function getDocumentMetaTag(name) {
    const metaElm = document.querySelector(`meta[name=${name}]`);
    return metaElm && metaElm.content;
}

export function getWindowName() {
    return global.name || (global.name = `NooBaa:${randomString()}`);
}

export function readFileAsText(file) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
        reader.onload = evt => resolve(evt.target.result);
        reader.onerror = err => reject(err);
        reader.readAsText(file);
    });
}

export function readFileAsArrayBuffer(file) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
        reader.onload = evt => resolve(evt.target.result);
        reader.onerror = err => reject(err);
        reader.readAsArrayBuffer(file);
    });
}
