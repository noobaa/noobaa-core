/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import prism from 'prism';

const contentSizeLimit = 500000;
const toLargeMessageHtml = '<p class="empty-message">Content too be large to be displayed</p>';

function _addLineNumbers(html) {
    return html
        .split('\n')
        .map(line => `<span class="codeline">${line}</span>`)
        .join('\n');
}

ko.bindingHandlers.codeviewer = {
    update(element, valueAccessor) {
        const { code, lang } = ko.deepUnwrap(valueAccessor());
        if (element.textContent !== code) {
            if (!code) {
                element.innerHTML = '';

            } else {
                if (code.length > contentSizeLimit) {
                    element.innerHTML = toLargeMessageHtml;

                } else if (lang === 'none') {
                    element.innerHTML = _addLineNumbers(code);

                } else {
                    element.innerHTML = _addLineNumbers(
                        prism.highlight(code, prism.languages[lang])
                    );
                }
            }
        }
    }
};
