/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { domFromHtml } from 'utils/browser-utils';
import {
    isDefined,
    isObject,
    isString,
    deepFreeze,
    runAsync
} from 'utils/core-utils';

const hiddenTooltipData = {
    template: null,
    css: '',
    style: { display: 'none'}
};

function _compareTargets(t1, t2) {
    const { element: e1, params: p1 } = t1 || {};
    const { element: e2, params: p2 } = t2 || {};
    return e1 === e2 && p1 === p2;
}

const delay = 350;
const hoveringTooltip = ko.observable();
const currTarget = ko.observable().extend({ compareUsing: _compareTargets });
const vm = ko.observable(hiddenTooltipData);

currTarget.subscribe(target => {
    if (target) {
        const { element, params } = target;
        const { template, position, align, breakWords, maxWidth } = params;
        const winSize = { width: global.innerWidth, height: global.innerHeight };
        const pos = _calcScreenPosition(position, element.getBoundingClientRect(), winSize);
        const style = { display: 'block', ...pos, maxWidth };
        const css = [
            position,
            align,
            breakWords ? 'break-words' : '',
            style.right !== 'auto' ? 'right-pos' : 'left-pos'
        ].join(' ');

        vm({ template, css, style });

    } else {
        vm(hiddenTooltipData);
    }
});

// Top level element used with applyBinding cannot support the new binding
// syntax for some reason. Falling back to data-bind syntax.
const tooltipHtml = `
    <div class="tooltip" data-bind="
        style: style,
        css: css,
        with: template
    ">
        <div class="tooltip-box">
            <section class="tooltip-content" ko.template="$data"></section>
        </div>
    </div>
`;

const templates = deepFreeze({
    text: `
        <span class="highlight" ko.text="$data"></span>
    `,
    list: `
        <ul class="bullet-list highlight" ko.foreach="$data">
            <li ko.text="$data"></ul>
        </ul>
    `,
    listWithCaption: `
        <p class="highlight" ko.text="$data.title"></p>
        <ul class="bullet-list highlight" ko.foreach="$data.list">
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

function _toPx(val) {
    return `${Math.ceil(val)}px`;
}

function _normalizeValue(value) {
    const {
        text = value,
        position,
        align,
        breakWords,
        template,
        maxWidth
    } = value || {};

    return {
        template: _getTemplate(template, text),
        position: positions.includes(position) ? position : 'below',
        align: alignments.includes(align) ? align : 'center',
        breakWords: Boolean(breakWords),
        maxWidth: maxWidth && `${maxWidth}px`
    };
}

function _calcScreenPosition(position, boundingRect, winSize) {
    const { top, right, bottom, left } = boundingRect;
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const leftSideOfScreen = centerX <= winSize.width / 2;

    switch (position) {
        case 'above': {
            if (leftSideOfScreen) {
                return {
                    top: _toPx(top),
                    right: 'auto',
                    bottom: 'auto',
                    left: _toPx(centerX)
                };
            } else {
                return {
                    top: _toPx(top),
                    right: _toPx(winSize.width - centerX),
                    bottom: 'auto',
                    left: 'auto'
                };
            }
        }
        case 'after': {
            return {
                top: _toPx(centerY),
                right: 'auto',
                bottom: 'auto',
                left: _toPx(right)
            };
        }
        case 'below': {
            if (leftSideOfScreen) {
                return {
                    top: _toPx(bottom),
                    right: 'auto',
                    bottom: 'auto',
                    left: _toPx(centerX)
                };
            } else {
                return {
                    top: _toPx(bottom),
                    right: _toPx(winSize.width - centerX),
                    bottom: 'auto',
                    left: 'auto'
                };
            }
        }
        case 'before': {
            return {
                top: _toPx(centerY),
                right: 'auto',
                bottom: 'auto',
                left: _toPx(left)
            };
        }
    }
}

// Attaching the element to the body in async menner to prevent the element from being mount
// during the main applyBinding (creating a double binding on the element).

runAsync(() => {
    const [element] = domFromHtml(tooltipHtml.trim());

    // Need to throttle only the leave event in order to allow the
    // user a little margin of mistake when with the mouse cursor
    // when working inside the tooltip.
    let handle = -1;
    ko.utils.registerEventHandler(element,'mouseenter', () => {
        clearTimeout(handle);
        hoveringTooltip(true);
    });
    ko.utils.registerEventHandler(element, 'mouseleave', () => {
        handle = setTimeout(() => hoveringTooltip(false), delay);
    });

    document.body.appendChild(element);
    ko.applyBindings(vm, element);
});

export default {
    init: function(element, valueAccessor) {
        const params = ko.pureComputed(() =>
            _normalizeValue(ko.deepUnwrap(valueAccessor()))
        );

        const hover = ko.observable(false);

        const computed = ko.computed(() => {
            if (hover() && params().template) {
                currTarget({ element, params: params() });

            } else if (!hoveringTooltip()) {
                const { element: currElement } = currTarget.peek() || {};
                if (currElement && currElement === element) currTarget(null);
            }
        });

        // Handle element enter/leave events (simulate hover)
        let handle = -1;
        ko.utils.registerEventHandler(element, 'mouseenter', () => {
            clearTimeout(handle);

            // Throttle the hover enter event only if the tooltip does not
            // already opened for current element.
            const { element: currElement } = currTarget.peek() || {};
            if (currElement !== element) {
                handle = setTimeout(() => hover(true), delay);
            } else {
                hover(true);
            }
        });
        ko.utils.registerEventHandler(element, 'mouseleave', () => {
            // Throttle the leave event to give the user some grace time.
            handle = setTimeout(() => hover(false), delay);
        });

        // Cleanup code.
        ko.utils.domNodeDisposal.addDisposeCallback(element, () => {
            // If tooltip is shown for the element discard it.
            const { element: currElement } = currTarget.peek() || {};
            if (currElement && currElement === element) currTarget(null);
            computed.dispose();
        });
    }
};

