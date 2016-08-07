import ko from 'knockout';
import { isObject, isString } from 'utils';

const tooltip = document.createElement('p');
const delay = 350;
const alignments = Object.freeze({
    left: 0,
    center: .5,
    right: 1
});

function toHtmlList(arr) {
    return `<ul>${
        arr.map(
            item => `<li>${item}</li>`
        ).join('')
    }</ul>`;
}

function normalizeParams(params) {
    return ko.pureComputed(
        () => {
            let naked = ko.unwrap(params);
            if (isString(naked)) {
                return {
                    text: naked,
                    css: 'center',
                    align: alignments.center
                };

            } else if (naked instanceof Array) {
                return {
                    text: naked.length === 1 ? naked : toHtmlList(naked),
                    css: 'center',
                    align: alignments.center
                };

            } else if (isObject(naked)) {
                let text = ko.unwrap(naked.text);
                if (text instanceof Array) {
                    text = naked.length === 1 ? naked : toHtmlList(naked);
                }

                let pos = ko.unwrap(naked.align);
                if (!Object.keys(alignments).includes(pos)) {
                    pos = 'center';
                }

                return {
                    text: text,
                    css: pos,
                    align: alignments[pos]
                };
            } else {
                return {};
            }
        }
    );
}

function showTooltip(target, { text, css, align }) {
    tooltip.innerHTML = text;
    tooltip.className = `tooltip ${css}`;
    document.body.appendChild(tooltip);

    let { left, top } = target.getBoundingClientRect();
    top += target.offsetHeight;
    left += target.offsetWidth / 2 - tooltip.offsetWidth * align;
    tooltip.style.top = `${Math.ceil(top)}px`;
    tooltip.style.left = `${Math.ceil(left)}px`;
}

function hideTooltip() {
    if (tooltip.parentElement) {
        document.body.removeChild(tooltip);
        tooltip.innerHTML = '';
    }
}

export default {
    init: function(target, valueAccessor) {
        let params = normalizeParams(valueAccessor());
        let hover = ko.observable(false);

        let sub = ko.pureComputed(
            () => Boolean(hover() && params().text)
        ).extend({
            rateLimit: {
                timeout: delay,
                method: 'notifyWhenChangesStop'
            }
        }).subscribe(
            visible => visible ?
                showTooltip(target, params()) :
                hideTooltip()
        );

        // Handle delyed hover state.
        let handle = -1;
        ko.utils.registerEventHandler(target, 'mouseenter', () => hover(true));
        ko.utils.registerEventHandler(target, 'mouseleave', () => hover(false));

        // Cleanup code.
        ko.utils.domNodeDisposal.addDisposeCallback(
            target,
            () => {
                clearTimeout(handle);
                hover(false);
                sub.dispose();
            }
        );
    }
};
