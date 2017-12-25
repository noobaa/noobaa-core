/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isDefined, isObject, isString, deepFreeze, runAsync } from 'utils/core-utils';
import { domFromHtml } from 'utils/browser-utils';

const data = ko.observable({});
const [elm] = domFromHtml(
    // Top level element used with applyBinding cannot support the new binding
    // syntax for some reason. Falling back to data-bind syntax.
    `<div class="tooltip" data-bind="
        style: $data.style,
        css: $data.css,
        with: $data.template
    ">
        <section class="tooltip-content" ko.template="$data"></section>
    </div>`
);

// Attaching the element to the body in async menner to prevent the element from being mount
// during the main applyBinding (creating a double binding on the element).
runAsync(() => {
    document.body.appendChild(elm);
    ko.applyBindings(data, elm);
});

const delay = 350;
const templates = deepFreeze({
    text: '{{$data}}',
    list: `
        <ul class="bullet-list" ko.foreach="$data">
            <li ko.text="$data"></ul>
        </ul>
    `,
    listWithCaption: `
        <p ko.text="$data.title"></p>
        <ul class="bullet-list" ko.foreach="$data.list">
            <li ko.text="$data"></ul>
        </ul>
    `
});
const positions = deepFreeze([
    'above',
    'after',
    'below',
    'before'
]);
const alignments = deepFreeze([
    'start',
    'center',
    'end'
]);

function _getTemplate(template, data) {
    if (template) {
        return {
            html: template,
            data: data
        };
    }

    if (!data) {
        return null;
    }

    if (isString(data)) {
        return {
            html: templates.text,
            data: data
        };
    }

    if (Array.isArray(data)) {
        const list = data.filter(isDefined);
        if (list.length < 2) {
            return {
                html: templates.text,
                data: list[0] || ''
            };

        } else {
            return {
                html: templates.list,
                data: list
            };
        }
    }

    if (isObject(data)) {
        let { title, list = [] } = data;
        if (!Array.isArray(list)) list = [list];
        list = list.filter(isDefined);

        if (title) {
            return {
                html: templates.listWithCaption,
                data: { title, list }
            };

        } else if (list.length < 2) {
            return {
                html: templates.text,
                data: list[0] || ''
            };

        } else {
            return {
                html: template.list,
                data: list
            };
        }
    }

    return ko.renderToString(templates.text, data.toString());
}

function _normalizeValue(value) {
    const {
        text = value,
        position,
        align,
        breakWords,
        template
    } = value || {};

    return {
        template: _getTemplate(template, text),
        position: positions.includes(position) ? position : 'below',
        align: alignments.includes(align) ? align : 'center',
        breakWords: Boolean(breakWords)
    };
}

function _calcScreenPosition(position, boundingRect) {
    const { top, right, bottom, left } = boundingRect;
    const width = right - left;
    const height = bottom - top;

    switch (position) {
        case 'above': {
            return {
                top: top,
                left: left + (width / 2)
            };
        }
        case 'after': {
            return {
                top: top + (height / 2),
                left: right
            };
        }
        case 'below': {
            return {
                top: bottom,
                left: left + (width / 2)
            };
        }
        case 'before': {
            return {
                top: top + (height / 2),
                left: left
            };
        }
    }
}

function _showTooltip(target, params) {
    const { template, position, align, breakWords } = params;
    const css = `${position} ${align} ${breakWords ? 'break-words' : ''}`;
    const { top, left } = _calcScreenPosition(position, target.getBoundingClientRect());
    const style = {
        display: 'block',
        top: `${Math.ceil(top)}px`,
        left: `${Math.ceil(left)}px`
    };

    data({ template, css, style });
}

function _hideTooltip() {
    data({
        style: {
            display: 'none'
        }
    });
}

export default {
    init: function(target, valueAccessor) {
        const params = ko.pureComputed(
            () => _normalizeValue(ko.deepUnwrap(valueAccessor()))
        );

        const hover = ko.observable(false);
        const paramsSub = params.subscribe(
            params => hover() && (
                params.template ? _showTooltip(target, params) : _hideTooltip()
            )
        );

        const hoverSub = hover
            .extend({
                rateLimit: {
                    timeout: delay,
                    method: 'notifyWhenChangesStop'
                }
            })
            .subscribe(
                hovered => (hovered && params().template) ?
                    _showTooltip(target, params()) :
                    _hideTooltip()
            );

        // Handle delyed hover state.
        ko.utils.registerEventHandler(target, 'mouseenter', () => hover(true));
        ko.utils.registerEventHandler(target, 'mouseleave', () => hover(false));

        // Cleanup code.
        ko.utils.domNodeDisposal.addDisposeCallback(
            target,
            () => {
                _hideTooltip();
                paramsSub.dispose();
                hoverSub.dispose();
            }
        );
    }
};
