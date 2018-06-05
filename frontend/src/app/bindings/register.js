/* Copyright (C) 2016 NooBaa */

/* Copyright (C) 2016 NooBaa */

// Import extended existing handlers
import template from './template-ex';
import value from './value-ex';

// Import new handlers
import _let from './let';
import visibility from './visibility';
import href from './href';
import scroll from './scroll';
import canvas from './canvas';
import expand from './expand';
import tooltip from './tooltip';
import scrollTo from './scroll-to';
import hover from './hover';
import shakeOnClick from './shake-on-click';
import childEvent from './child-event';
import globalEvent from './global-event';
import selection from './selection';
import preventBubble from './prevent-bubble';
import validationCss from './validation-css';
import bubbleEvents from './bubble-events';
import trapFocus from './trap-focus';
import keysToClicks from './keys-to-clicks';
import keyboardNavigation from './keyboard-navigation';
import hidden from './hidden';

export default function register(ko) {
    function registerHandler([name, handler]) {
        ko.bindingHandlers[name] = handler;
        ko.bindingHandlers[name.toLowerCase()] = handler;

        if (handler.allowOnVirtualElements) {
            ko.virtualElements.allowedBindings[name] = true;
            ko.virtualElements.allowedBindings[name.toLowerCase()] = true;
        }
    }

    // Register the bindings.
    Object.entries({
        template,
        value,
        let: _let,
        visibility,
        href,
        scroll,
        canvas,
        expand,
        tooltip,
        scrollTo,
        hover,
        shakeOnClick,
        childEvent,
        globalEvent,
        selection,
        preventBubble,
        validationCss,
        bubbleEvents,
        trapFocus,
        keysToClicks,
        keyboardNavigation,
        hidden
    }).forEach(registerHandler);
}
