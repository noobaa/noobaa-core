    import ko from 'knockout';

function notIn(value, params) {
    params = ko.unwrap(params);
    if (params instanceof Array) {
        params = { list: params };
    }

    let { list = [], compareFunc = (a,b) => a === b } = params;

    return ko.unwrap(list).every(
        item => !compareFunc(value, item)
    );
}

function hasNoLeadingOrTrailingSpaces(value) {
    return value.trim() === value;
}

function isIP(value) {
    return !value || (
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value)
    );
}

function isDNSName(value) {
    return !value || (
        value.length < 63 && /^[A-Za-z0-9][A-Za-z0-9-\.]*[A-Za-z0-9]$/.test(value)
    );
}

function isIPOrDNSName(value) {
    return isIP(value) || isDNSName(value);
}

function isURI(value) {
    if (!value) {
        return true;
    }

    value = value.replace(/^\s+|\s+$/, ''); //Strip whitespace
    //Regex by Diego Perini from: http://mathiasbynens.be/demo/url-regex
    //Modified regex - removed the restrictions for private ip ranges
    var uriRegExp = new RegExp(
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

    return uriRegExp.test(value);
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
            validator: isDNSName,
            message: 'Please enter a valid DNS name'
        },

        isIP: {
            validator: isIP,
            message: 'Please enter a valid IP'
        },

        isIPOrDNSName: {
            validator: isIPOrDNSName,
            message: 'Please enter a valid IP or DNS name'
        },

        isURI:{
            validator: isURI,
            message: 'Please enter a valid URI'
        }
    });

    ko.validation.registerExtenders();
}
