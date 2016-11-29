/*global setImmediate */
import { isUndefined, entries } from './core-utils';
import { toCammelCase, toDashedCase } from './string-utils';
import { sleep } from './promise-utils';

export function parseQueryString(str) {
    return decodeURIComponent(str)
        .replace(/(^\?)/,'')
        .split('&')
        .filter(part => part)
        .reduce( (result, part) => {
            let [name, value] = part.split('=');
            result[toCammelCase(name)] = value || true;
            return result;
        }, {});
}

export function stringifyQueryString(query) {
    return Object.keys(query)
        .reduce((list, key) => {
            if (!isUndefined(query[key])) {
                let encodedName = encodeURIComponent(toDashedCase(key));
                let value = query[key] === true ?
                    encodedName :
                    `${encodedName}=${encodeURIComponent(query[key])}`;

                list.push(value);
            }

            return list;
        }, [])
        .join('&');
}

export function realizeUri(template, params = {}, query = {}) {
    let search = stringifyQueryString(query);
    let base = template
        .split('/')
        .map(
            part => {
                let isParam = part[0] === ':';
                let isOptional = part.substr(-1) === '?';

                if (isParam) {
                    let name = part.substr(1, part.length - 1 - Number(isOptional));
                    let value = params[name ];

                    if (value) {
                        return encodeURIComponent(value);
                    } else if (isOptional) {
                        return null;
                    } else {
                        throw new Error(`Cannot satisfy mandatory parameter: ${name}`);
                    }
                } else {
                    return part;
                }
            }
        )
        .filter(
            part => part !== null
        )
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

export function downloadFile(url) {
    let body = window.document.body;

    let link = window.document.createElement('a');
    link.download = '';
    link.href = url;
    body.appendChild(link);
    link.click();

    setImmediate(
        () => body.removeChild(link)
    );
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
    return entries(payload).reduce(
        (formData, { key, value }) => {
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
            xhr.onabort = reject;
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
