'use strict';

exports.encode_xml = encode_xml;
exports.encode_xml_str = encode_xml_str;

/**
 *
 * fast object to xml encoding, optimized for speed.
 *
 * the object will be traveresed recursively:
 *  - any object will be encoded such that keys are xml tags.
 *  - any array will be encode without introducing new keys, meaning items are flattened.
 *  - string/number/boolean/date will be converted to strings.
 *  - {key: null} will encode an empty tag - <key></key>
 *  - {key: undefined} will not encode the tag at all.
 *  - {key: {_attr:{k1=v1,k2=v2,...}} will encode xml attributes on the tag (_attr can be set on array values too)
 *
 * for example:
 *   { root: [{a:1,b:2}, {a:3}, {b:4}, [[[[{z:42}]]]], {c:{_attr:{d:5}}} ] }
 * will be encoded as (spaces are only for clarity):
 *   <root> <a>1</a> <b>2</b> <a>3</a> <b>4</b> <z>42</z> <c d="5"></c> </root>
 *
 */
function encode_xml(object) {
    var output = '<?xml version="1.0" encoding="UTF-8"?>';
    var append = function(s) {
        output += s;
    };
    append_object(append, object);
    return output;
}

function append_object(append, object) {
    if (Array.isArray(object)) {
        // arrays are encoded without adding new tags
        // which allows repeating keys with the same name
        for (let i = 0; i < object.length; ++i) {
            append_object(append, object[i]);
        }
    } else {
        for (let key in object) {
            // skip any keys from the prototype
            if (!object.hasOwnProperty(key)) continue;
            // skip any internal key
            if (key[0] === '_') continue;
            let val = object[key];
            let type = typeof(val);
            // undefined values will skip encoding the key tag altogether
            if (type === 'undefined') continue;
            if (type === 'object') {
                if (val && val._attr) {
                    append('<' + key);
                    for (let k in val._attr) {
                        if (!val._attr.hasOwnProperty(k)) continue;
                        append(' ' + k + '="' + encode_xml_str(val._attr[k]) + '"');
                    }
                    append('>');
                } else {
                    append('<' + key + '>');
                }
                if (val) {
                    append_object(append, val);
                }
                append('</' + key + '>');
            } else {
                append('<' + key + '>');
                append(encode_xml_str(val));
                append('</' + key + '>');
            }
        }
    }
}

// see https://en.wikipedia.org/wiki/List_of_XML_and_HTML_character_entity_references#Predefined_entities_in_XML
const XML_CHAR_ENTITY_MAP = Object.freeze({
    '"': '&quot;',
    '&': '&amp;',
    '\'': '&apos;',
    '<': '&lt;',
    '>': '&gt;'
});

function encode_xml_str(s) {
    return String(s).replace(/(["&'<>])/g, (str, ch) => XML_CHAR_ENTITY_MAP[ch]);
}
